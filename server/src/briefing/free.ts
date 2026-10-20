// Zero-cost daily briefing generator. Replaces the Claude + paid web_search run
// so the briefing doesn't depend on prepaid API credits.
//
// Pipeline:
//   1. Levels  — official closes pulled directly from free, keyless sources:
//                FRED (S&P 500, Dow, VIX, 10Y) and Nasdaq.com (Nasdaq 100, which
//                FRED publishes a day late). Numbers never pass through an LLM.
//   2. News    — free RSS feeds (CNBC, Investing.com, Seeking Alpha), filtered
//                to items published on/after the session date.
//   3. Writing — Google Gemini free tier (GEMINI_API_KEY from aistudio.google.com,
//                no billing needed) picks the drivers and writes the prose. With
//                no key, or if Gemini fails, a deterministic template writes it.
//
// The output is the same GenerationResult the eight-gate freshness check in
// freshness.ts already validates. "searchUrls" here are the pages we actually
// fetched, so FABRICATED_CITATION still catches any URL the writer invents.

import { getUpcomingMacroEvents } from "../macroEvents.js";
import { etParts } from "./calendar.js";
import type { BriefingPayload, GenerationResult, Level } from "./types.js";

const FETCH_TIMEOUT_MS = 15_000;
const UA = "Mozilla/5.0 (compatible; VoyanceBriefing/1.0)";

// The "-latest" aliases track Google's current free-tier models, so this doesn't
// break when a pinned version is retired. Tried in order: free-tier Flash is often
// overloaded (503 "high demand"), so Flash-Lite backs it up before the template.
// Override with GEMINI_MODEL (comma-separated for a custom fallback order).
const GEMINI_MODELS = (process.env.GEMINI_MODEL || "gemini-flash-latest,gemini-flash-lite-latest")
  .split(",")
  .map((m) => m.trim())
  .filter(Boolean);
const GEMINI_TIMEOUT_MS = 45_000;

/** Thrown when the session's closes aren't published yet. Not a gate failure — just early. */
export class LevelsNotReadyError extends Error {}

function geminiKey(): string {
  return (process.env.GEMINI_API_KEY ?? "").trim().replace(/^["']|["']$/g, "");
}

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "*/*" },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
  return res.text();
}

function etDate(d: Date): string {
  return etParts(d).date;
}

// ---------- levels ----------

interface Close {
  date: string; // YYYY-MM-DD
  value: number;
}

interface FetchedLevel {
  level: Level;
  date: string;
}

/** Pick the session's close and compute % change vs the prior close. */
function levelFor(closes: Close[], session: string, sourceUrl: string): FetchedLevel | null {
  const sorted = closes.filter((c) => Number.isFinite(c.value)).sort((a, b) => a.date.localeCompare(b.date));
  const i = sorted.findIndex((c) => c.date === session);
  if (i < 0) return null;
  const prev = i > 0 ? sorted[i - 1].value : null;
  const value = round(sorted[i].value, 2);
  const change_pct = prev ? round((sorted[i].value / prev - 1) * 100, 2) : null;
  return { level: { value, change_pct, source_url: sourceUrl }, date: session };
}

function round(n: number, dp: number): number {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}

async function fredCloses(series: string, session: string): Promise<Close[]> {
  // Two weeks back is enough to find the prior close across any holiday run.
  const from = new Date(`${session}T12:00:00Z`);
  from.setUTCDate(from.getUTCDate() - 14);
  const csv = await fetchText(
    `https://fred.stlouisfed.org/graph/fredgraph.csv?id=${series}&cosd=${from.toISOString().slice(0, 10)}`,
  );
  const out: Close[] = [];
  for (const line of csv.trim().split(/\r?\n/).slice(1)) {
    const [date, raw] = line.split(",");
    const value = Number(raw); // FRED writes "." for no-trade days -> NaN, dropped later
    if (/^\d{4}-\d{2}-\d{2}$/.test(date)) out.push({ date, value });
  }
  return out;
}

async function nasdaqCloses(symbol: string, session: string): Promise<Close[]> {
  const from = new Date(`${session}T12:00:00Z`);
  from.setUTCDate(from.getUTCDate() - 14);
  const body = JSON.parse(
    await fetchText(
      `https://api.nasdaq.com/api/quote/${symbol}/historical?assetclass=index&fromdate=${from
        .toISOString()
        .slice(0, 10)}&limit=20`,
    ),
  ) as { data?: { tradesTable?: { rows?: Array<{ date?: string; close?: string }> } } };
  const rows = body.data?.tradesTable?.rows ?? [];
  return rows.flatMap((r) => {
    const m = r.date?.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (!m) return [];
    return [{ date: `${m[3]}-${m[1]}-${m[2]}`, value: Number((r.close ?? "").replace(/,/g, "")) }];
  });
}

/**
 * Nasdaq's live quote endpoint. Its daily-history endpoint (and FRED) can take
 * until around midnight ET to post a session's close; this one has the final
 * print minutes after 4pm. Only accepted once Nasdaq reports the market as
 * after-hours/closed and the last trade is from the requested session. During
 * the day the timestamp reads "Oct 20, 2026 3:51 PM ET"; after the close it
 * drops the time ("Oct 20, 2026").
 */
async function nasdaqLiveClose(symbol: string, session: string, url: string): Promise<FetchedLevel | null> {
  const body = JSON.parse(
    await fetchText(`https://api.nasdaq.com/api/quote/${symbol}/info?assetclass=index`),
  ) as {
    data?: {
      marketStatus?: string;
      primaryData?: { lastSalePrice?: string; percentageChange?: string; lastTradeTimestamp?: string };
    };
  };
  const d = body.data;
  const ts = d?.primaryData?.lastTradeTimestamp
    ?.trim()
    .match(/^(\w{3}) (\d{1,2}), (\d{4})(?: (\d{1,2}):(\d{2}) (AM|PM) ET)?$/);
  if (!d || !ts || !/after|closed/i.test(d.marketStatus ?? "")) return null;
  const month = "JanFebMarAprMayJunJulAugSepOctNovDec".indexOf(ts[1]) / 3 + 1;
  const date = `${ts[3]}-${String(month).padStart(2, "0")}-${ts[2].padStart(2, "0")}`;
  if (date !== session) return null;
  if (ts[4]) {
    const hour24 = (Number(ts[4]) % 12) + (ts[6] === "PM" ? 12 : 0);
    if (hour24 < 16) return null;
  }
  const value = Number((d.primaryData?.lastSalePrice ?? "").replace(/[$,]/g, ""));
  const pct = Number((d.primaryData?.percentageChange ?? "").replace(/[%+]/g, ""));
  if (!Number.isFinite(value) || value <= 0) return null;
  return {
    level: { value: round(value, 2), change_pct: Number.isFinite(pct) ? round(pct, 2) : null, source_url: url },
    date: session,
  };
}

interface LevelSource {
  key: keyof BriefingPayload["levels"];
  /** Tried in order; first one that has the session's close wins. */
  tries: Array<{ url: string; load: (session: string) => Promise<FetchedLevel | null> }>;
}

const fred = (series: string) => {
  const url = `https://fred.stlouisfed.org/series/${series}`;
  return { url, load: async (s: string) => levelFor(await fredCloses(series, s), s, url) };
};

const NDX_URL = "https://www.nasdaq.com/market-activity/index/ndx/historical";

const LEVEL_SOURCES: LevelSource[] = [
  { key: "spx", tries: [fred("SP500")] },
  {
    key: "ndx",
    tries: [
      { url: NDX_URL, load: async (s) => levelFor(await nasdaqCloses("NDX", s), s, NDX_URL) },
      { url: NDX_URL, load: (s) => nasdaqLiveClose("NDX", s, NDX_URL) },
      fred("NASDAQ100"),
    ],
  },
  { key: "dji", tries: [fred("DJIA")] },
  { key: "vix", tries: [fred("VIXCLS")] },
  { key: "ust10y", tries: [fred("DGS10")] },
];

async function fetchLevels(
  session: string,
): Promise<{ levels: Partial<BriefingPayload["levels"]>; urls: string[]; dates: string[] }> {
  const results = await Promise.all(
    LEVEL_SOURCES.map(async (src) => {
      for (const t of src.tries) {
        try {
          const lvl = await t.load(session);
          if (lvl) return { key: src.key, ...lvl };
        } catch (e) {
          console.warn(`[briefing] ${src.key} source failed (${t.url}):`, e instanceof Error ? e.message : e);
        }
      }
      return null;
    }),
  );
  const levels: Partial<BriefingPayload["levels"]> = {};
  const urls: string[] = [];
  const dates: string[] = [];
  for (const r of results) {
    if (!r) continue;
    // VIX and yields routinely move >15% in a day, which the gate's index-sized
    // IMPLAUSIBLE_MOVE check would reject. Report their level only.
    if (r.key === "vix" || r.key === "ust10y") r.level.change_pct = null;
    levels[r.key] = r.level;
    urls.push(r.level.source_url);
    dates.push(r.date);
  }
  return { levels, urls, dates };
}

// ---------- news ----------

interface Article {
  title: string;
  description: string;
  url: string;
  date: string; // ET YYYY-MM-DD
  publishedAt: number;
  source: string;
}

const FEEDS: Array<{ source: string; url: string }> = [
  { source: "CNBC Markets", url: "https://www.cnbc.com/id/10000664/device/rss/rss.html" },
  { source: "CNBC Economy", url: "https://www.cnbc.com/id/20910258/device/rss/rss.html" },
  { source: "Investing.com", url: "https://www.investing.com/rss/news_25.rss" },
  { source: "Seeking Alpha", url: "https://seekingalpha.com/market_currents.xml" },
];

function decode(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&(apos|#39);/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tag(item: string, name: string): string {
  const m = item.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, "i"));
  return m ? decode(m[1]) : "";
}

function parsePubDate(raw: string): number {
  // Investing.com writes "2026-10-19 18:48:37" with no zone; it's UTC.
  const iso = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(raw) ? raw.replace(" ", "T") + "Z" : raw;
  return Date.parse(iso);
}

async function fetchFeed(feed: { source: string; url: string }): Promise<Article[]> {
  const xml = await fetchText(feed.url);
  const items = xml.match(/<item[\s>][\s\S]*?<\/item>/gi) ?? [];
  return items.flatMap((item) => {
    const title = tag(item, "title");
    const url = tag(item, "link");
    const publishedAt = parsePubDate(tag(item, "pubDate"));
    if (!title || !/^https?:\/\//.test(url) || !Number.isFinite(publishedAt)) return [];
    return [{
      title,
      description: tag(item, "description").slice(0, 300),
      url,
      publishedAt,
      date: etDate(new Date(publishedAt)),
      source: feed.source,
    }];
  });
}

async function fetchNews(session: string): Promise<{ articles: Article[]; feedsOk: number }> {
  const settled = await Promise.allSettled(FEEDS.map(fetchFeed));
  const now = Date.now();
  const seen = new Set<string>();
  const articles: Article[] = [];
  let feedsOk = 0;
  settled.forEach((r, i) => {
    if (r.status === "rejected") {
      console.warn(`[briefing] feed ${FEEDS[i].source} failed:`, r.reason instanceof Error ? r.reason.message : r.reason);
      return;
    }
    feedsOk++;
    for (const a of r.value) {
      // Only what was published on/after the session — older items describe older sessions.
      if (a.date < session || a.publishedAt > now + 5 * 60_000) continue;
      const k = a.title.toLowerCase();
      if (seen.has(k)) continue;
      seen.add(k);
      articles.push(a);
    }
  });
  articles.sort((a, b) => a.publishedAt - b.publishedAt);
  return { articles, feedsOk };
}

// ---------- writing ----------

interface Written {
  headline: string;
  summary: string;
  drivers: Array<{ title: string; detail: string; source_url: string }>;
}

const NAMES: Record<string, string> = { spx: "S&P 500", ndx: "Nasdaq 100", dji: "Dow" };

function fmt(n: number): string {
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Template ranking: headlines about the tape itself first, then macro drivers.
const TAPE_WORDS = /\b(stocks|S&P|Dow|Nasdaq|Wall Street|equities|sell-?off|rally)\b/i;
const MACRO_WORDS =
  /\b(Fed|rates?|Treasury|yields?|inflation|CPI|PPI|jobs|payrolls|oil|tariffs?|dollar|recession)\b/i;

// Same pattern the gate uses for index-magnitude numbers in prose (GATE 8).
const BIG_NUMBER = /\b\d{1,3}(?:,\d{3})+(?:\.\d+)?\b|\b\d{4,6}\.\d{1,2}\b/g;

/**
 * Drop any sentence carrying a big figure (e.g. "1,200 jobs") that isn't one of
 * the declared levels. The gate would reject the whole brief for it; losing one
 * sentence is the better trade.
 */
function dropUnbackedNumbers(text: string, levels: BriefingPayload["levels"]): string {
  const declared = Object.values(levels).filter(Boolean).map((l) => l!.value);
  return sentencesOf(text)
    .filter((s) =>
      (s.match(BIG_NUMBER) ?? []).every((m) => {
        const n = Number(m.replace(/,/g, ""));
        return n < 1000 || declared.some((d) => Math.abs(d - n) < 0.51);
      }),
    )
    .join(" ");
}

/**
 * Split on sentence-ending punctuation followed by whitespace and a capital or
 * quote, so "U.S. housing" and "6.43%" stay intact.
 */
function sentencesOf(text: string): string[] {
  return text
    .replace(/\s+/g, " ")
    .trim()
    .split(/(?<=[.!?]["”’)]?)\s+(?=["“‘(]?[A-Z0-9])/)
    .filter(Boolean);
}

/**
 * Body text of an article, so driver write-ups can go beyond the one-line RSS
 * blurb. CNBC serves full pages; Investing.com and Seeking Alpha return 403 to
 * servers, in which case we fall back to the RSS description.
 */
async function articleText(url: string): Promise<string> {
  try {
    const html = await fetchText(url);
    const paras = (html.match(/<p[^>]*>([\s\S]*?)<\/p>/gi) ?? [])
      .map((p) => decode(p))
      .filter(
        (p) =>
          p.length >= 60 &&
          !/cookie|subscribe|newsletter|sign up|all rights reserved/i.test(p) &&
          // Site menus flatten into glued words ("LivestreamMenuMake It"); prose doesn't.
          (p.match(/[a-z][A-Z]/g) ?? []).length < 3,
      );
    return paras.join(" ").slice(0, 3500);
  } catch {
    return "";
  }
}

function firstSentences(text: string, max: number): string {
  return sentencesOf(text).slice(0, max).join(" ");
}

function templateWrite(
  levels: BriefingPayload["levels"],
  articles: Article[],
  bodies: Map<string, string>,
  session: string,
): Written {
  const core = (["spx", "ndx", "dji"] as const).map((k) => ({ k, l: levels[k] }));
  const chg = core.map((c) => c.l.change_pct ?? 0);
  const up = chg.filter((c) => c > 0.05).length;
  const down = chg.filter((c) => c < -0.05).length;
  const leader = core.reduce((a, b) => (Math.abs(b.l.change_pct ?? 0) > Math.abs(a.l.change_pct ?? 0) ? b : a));
  const headline =
    up === 3 ? `Stocks rise, led by the ${NAMES[leader.k]}`
    : down === 3 ? `Stocks fall, led by the ${NAMES[leader.k]}`
    : up === 0 && down === 0 ? "Stocks finish little changed"
    : "Stocks finish mixed";

  const phrase = (k: string, l: Level) => {
    const c = l.change_pct;
    if (c == null) return `the ${NAMES[k]} closed at ${fmt(l.value)}`;
    return `the ${NAMES[k]} ${c >= 0 ? "rose" : "fell"} ${Math.abs(c).toFixed(2)}% to ${fmt(l.value)}`;
  };
  const parts = core.map((c) => phrase(c.k, c.l));
  let summary = `In the ${session} session, ${parts[0]}, ${parts[1]} and ${parts[2]}.`;
  if (levels.vix) summary += ` The VIX ended at ${levels.vix.value.toFixed(2)}.`;
  if (levels.ust10y) summary += ` The 10-year Treasury yield was ${levels.ust10y.value.toFixed(2)}%.`;

  const picks = rankForTemplate(articles);
  return {
    headline,
    summary,
    drivers: picks.map((a) => {
      const body = dropUnbackedNumbers(firstSentences(bodies.get(a.url) ?? "", 4), levels);
      const blurb = dropUnbackedNumbers(a.description, levels);
      return {
        title: a.title,
        detail: body || blurb || `Reported by ${a.source}.`,
        source_url: a.url,
      };
    }),
  };
}

function rankForTemplate(articles: Article[]): Article[] {
  const score = (a: Article) => (TAPE_WORDS.test(a.title) ? 2 : 0) + (MACRO_WORDS.test(a.title) ? 1 : 0);
  // Stable sort keeps chronological order (closest to the session first) within a tier.
  const ranked = [...articles].sort((a, b) => score(b) - score(a));
  const picks = ranked.filter((a) => score(a) > 0).slice(0, 4);
  // Top up to three with the stories published closest to the session.
  for (const a of articles) {
    if (picks.length >= 3) break;
    if (!picks.includes(a)) picks.push(a);
  }
  return picks;
}

async function callGemini(model: string, system: string, user: string): Promise<unknown> {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": geminiKey() },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: "user", parts: [{ text: user }] }],
        generationConfig: { responseMimeType: "application/json", temperature: 0.3 },
      }),
      signal: AbortSignal.timeout(GEMINI_TIMEOUT_MS),
    },
  );
  if (!res.ok) throw new Error(`Gemini HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const body = (await res.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  const text = body.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
  return JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, ""));
}

const PROMPT_NAMES: Record<string, string> = {
  spx: "S&P 500",
  ndx: "Nasdaq 100",
  dji: "Dow Jones Industrial Average",
  vix: "VIX volatility index",
  ust10y: "10-year Treasury yield (%)",
};

// Full names so the writer doesn't guess (e.g. "Nasdaq Composite" for ndx).
function levelsForPrompt(levels: BriefingPayload["levels"]) {
  return Object.entries(levels).map(([k, l]) => ({
    name: PROMPT_NAMES[k] ?? k,
    close: l!.value,
    change_pct: l!.change_pct,
  }));
}

/** Step 1: choose which 3-4 stories explain the session, from headlines alone. */
async function geminiPick(model: string, levels: BriefingPayload["levels"], articles: Article[], session: string) {
  const system = [
    "You are the markets editor for Voyance, an equity-research app.",
    `From the article list, pick the 3-4 stories that best explain why US stocks moved in the ${session} session`,
    "(Fed/rates, inflation and economic data, geopolitics, big sector, commodity or mega-cap moves).",
    "Skip single-stock analyst notes and stories unrelated to that session.",
    'Return ONLY JSON: { "ids": [number, ...] }',
  ].join("\n");
  const user = JSON.stringify({
    session,
    levels: levelsForPrompt(levels),
    articles: articles.map((a, id) => ({ id, source: a.source, published: a.date, title: a.title, summary: a.description })),
  });
  const out = (await callGemini(model, system, user)) as { ids?: unknown[] };
  const picks = (out.ids ?? []).flatMap((id) => (typeof id === "number" && articles[id] ? [articles[id]] : []));
  if (!picks.length) throw new Error("Gemini picked no articles");
  return [...new Set(picks)].slice(0, 4);
}

/** Step 2: write the brief from the picked stories' full text. */
async function geminiWrite(
  model: string,
  levels: BriefingPayload["levels"],
  picks: Article[],
  bodies: Map<string, string>,
  session: string,
): Promise<Written> {
  const system = [
    "You are the markets editor for Voyance, an equity-research app. You write the daily briefing",
    `for the US trading session dated ${session}, using ONLY the closing levels and articles provided.`,
    "Rules, all non-negotiable:",
    "1. Never state facts or figures that are not in the provided material. No outside knowledge.",
    "2. Do NOT write index levels (e.g. 7,659.44) or any number of 1,000 or more written with commas",
    '   or decimals. Use percentages, or words like "$2 trillion" or "about 1.2 million".',
    "3. Each driver must reference one article by its numeric `id`, and its detail must come from that article.",
    "4. Write for an investor: what happened, why it happened, and why it matters for stocks.",
    "Return ONLY JSON matching:",
    '{ "headline": "one line, no figures",',
    '  "summary": "4-6 sentences: how the major indexes moved (name each index exactly as given, with its percent change) and the main reasons why",',
    '  "drivers": [{ "id": number, "title": "short, specific headline",',
    '                "detail": "3-5 sentences (60-110 words) explaining the story, the key facts and why it moved markets" }] }',
    "Write one driver per article provided.",
  ].join("\n");
  const user = JSON.stringify({
    session,
    levels: levelsForPrompt(levels),
    articles: picks.map((a, id) => ({
      id,
      source: a.source,
      published: a.date,
      title: a.title,
      text: bodies.get(a.url) || a.description,
    })),
  });
  const out = (await callGemini(model, system, user)) as {
    headline?: string;
    summary?: string;
    drivers?: Array<{ id?: number; title?: string; detail?: string }>;
  };
  const drivers = (out.drivers ?? []).flatMap((d) => {
    const a = typeof d.id === "number" ? picks[d.id] : undefined;
    const detail = dropUnbackedNumbers(d.detail ?? "", levels);
    if (!a || !d.title || !detail) return [];
    return [{ title: d.title, detail, source_url: a.url }];
  });
  const summary = dropUnbackedNumbers(out.summary ?? "", levels);
  if (!out.headline || summary.length < 40 || drivers.length === 0) {
    throw new Error("Gemini returned an incomplete briefing");
  }
  return { headline: dropUnbackedNumbers(out.headline, levels) || out.headline, summary, drivers };
}

async function fetchBodies(picks: Article[]): Promise<Map<string, string>> {
  const texts = await Promise.all(picks.map((a) => articleText(a.url)));
  return new Map(picks.map((a, i) => [a.url, texts[i]]));
}

// ---------- entry point ----------

export async function generateFreeBriefing(session: string): Promise<GenerationResult> {
  const [lv, news] = await Promise.all([fetchLevels(session), fetchNews(session)]);

  const missing = (["spx", "ndx", "dji"] as const).filter((k) => !lv.levels[k]);
  if (missing.length) {
    throw new LevelsNotReadyError(`${session} close not published yet for ${missing.join(", ")}`);
  }
  const levels = lv.levels as BriefingPayload["levels"];
  // Feature only stories that come with real text to write from. Investing.com
  // and Seeking Alpha feeds carry titles only (and block article fetches), so a
  // write-up for them would have to be invented from the headline.
  const withText = news.articles.filter((a) => a.description.length >= 40);
  const candidates = (withText.length >= 3 ? withText : news.articles).slice(-60);

  let written: Written | null = null;
  let model = "template";
  if (geminiKey() && candidates.length) {
    for (const m of GEMINI_MODELS) {
      try {
        const picks = await geminiPick(m, levels, candidates, session);
        const bodies = await fetchBodies(picks);
        written = await geminiWrite(m, levels, picks, bodies, session);
        model = m;
        break;
      } catch (e) {
        console.warn(`[briefing] ${m} failed:`, e instanceof Error ? e.message : e);
      }
    }
  }
  if (!written) {
    if (geminiKey()) console.warn("[briefing] all Gemini models failed; using template");
    written = templateWrite(levels, candidates, await fetchBodies(rankForTemplate(candidates)), session);
  }

  const used = new Set(written.drivers.map((d) => d.source_url));
  const sourceDates = [
    ...lv.dates,
    ...news.articles.filter((a) => used.has(a.url)).map((a) => a.date),
  ].sort();

  const today = etDate(new Date());
  const ahead = getUpcomingMacroEvents(today, 10).map((e) => ({
    when: e.date,
    event: e.title,
    why: e.detail ?? "",
  }));

  const payload: BriefingPayload = {
    session_date: session,
    latest_source_date: sourceDates[sourceDates.length - 1],
    headline: written.headline,
    summary: written.summary,
    levels,
    drivers: written.drivers,
    ahead,
  };

  return {
    payload,
    searchUrls: [...new Set([...lv.urls, ...news.articles.map((a) => a.url)])],
    searchCount: lv.urls.length + news.feedsOk,
    model,
  };
}
