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

interface LevelSource {
  key: keyof BriefingPayload["levels"];
  /** Tried in order; first one that has the session's close wins. */
  tries: Array<{ url: string; load: (session: string) => Promise<Close[]> }>;
}

const fred = (series: string) => ({
  url: `https://fred.stlouisfed.org/series/${series}`,
  load: (s: string) => fredCloses(series, s),
});

const LEVEL_SOURCES: LevelSource[] = [
  { key: "spx", tries: [fred("SP500")] },
  {
    key: "ndx",
    tries: [
      {
        url: "https://www.nasdaq.com/market-activity/index/ndx/historical",
        load: (s) => nasdaqCloses("NDX", s),
      },
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
          const lvl = levelFor(await t.load(session), session, t.url);
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

function templateWrite(levels: BriefingPayload["levels"], articles: Article[], session: string): Written {
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

  const score = (a: Article) => (TAPE_WORDS.test(a.title) ? 2 : 0) + (MACRO_WORDS.test(a.title) ? 1 : 0);
  // Stable sort keeps chronological order (closest to the session first) within a tier.
  const ranked = [...articles].sort((a, b) => score(b) - score(a));
  const picks = ranked.filter((a) => score(a) > 0).slice(0, 4);
  if (picks.length === 0) picks.push(...articles.slice(0, 3));
  return {
    headline,
    summary,
    drivers: picks.map((a) => ({
      title: a.title,
      detail: a.description || `Reported by ${a.source}.`,
      source_url: a.url,
    })),
  };
}

async function geminiWrite(
  model: string,
  levels: BriefingPayload["levels"],
  articles: Article[],
  session: string,
): Promise<Written> {
  const list = articles.slice(-60);
  const system = [
    "You are the markets editor for Voyance, an equity-research app. You write the daily briefing",
    `for the US trading session dated ${session}, using ONLY the closing levels and articles provided.`,
    "Rules, all non-negotiable:",
    "1. Never state facts or figures that are not in the provided material. No outside knowledge.",
    "2. Do NOT write index levels (e.g. 7,659.44) anywhere in prose. Percent moves from the levels block are fine.",
    "3. Each driver must reference one article by its numeric `id` from the list.",
    `4. Prefer articles that explain why markets moved in the ${session} session. Ignore unrelated stories.`,
    "Return ONLY JSON matching:",
    '{ "headline": "one line, no figures", "summary": "2-5 sentences on what happened and why",',
    '  "drivers": [{ "id": number, "title": "short", "detail": "1-2 sentences" }] }',
    "Use 2-4 drivers.",
  ].join("\n");
  const user = JSON.stringify({
    session,
    levels: Object.fromEntries(
      Object.entries(levels).map(([k, l]) => [k, { close: l!.value, change_pct: l!.change_pct }]),
    ),
    articles: list.map((a, id) => ({ id, source: a.source, published: a.date, title: a.title, summary: a.description })),
  });

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
  const out = JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, "")) as {
    headline?: string;
    summary?: string;
    drivers?: Array<{ id?: number; title?: string; detail?: string }>;
  };
  const drivers = (out.drivers ?? []).flatMap((d) => {
    const a = typeof d.id === "number" ? list[d.id] : undefined;
    if (!a || !d.title || !d.detail) return [];
    return [{ title: d.title, detail: d.detail, source_url: a.url }];
  });
  if (!out.headline || !out.summary || drivers.length === 0) {
    throw new Error("Gemini returned an incomplete briefing");
  }
  return { headline: out.headline, summary: out.summary, drivers };
}

// ---------- entry point ----------

export async function generateFreeBriefing(session: string): Promise<GenerationResult> {
  const [lv, news] = await Promise.all([fetchLevels(session), fetchNews(session)]);

  const missing = (["spx", "ndx", "dji"] as const).filter((k) => !lv.levels[k]);
  if (missing.length) {
    throw new LevelsNotReadyError(`${session} close not published yet for ${missing.join(", ")}`);
  }
  const levels = lv.levels as BriefingPayload["levels"];

  let written: Written | null = null;
  let model = "template";
  if (geminiKey() && news.articles.length) {
    for (const m of GEMINI_MODELS) {
      try {
        const w = await geminiWrite(m, levels, news.articles, session);
        // The gate rejects big numbers in prose that aren't declared levels (e.g.
        // "1,200 jobs"). Rather than lose the day's brief, try the next writer.
        const prose = [w.headline, w.summary, ...w.drivers.map((d) => d.detail)].join(" ");
        if (/\b\d{1,3}(?:,\d{3})+(?:\.\d+)?\b|\b\d{4,6}\.\d{1,2}\b/.test(prose)) {
          console.warn(`[briefing] ${m} prose contains large figures; trying next writer`);
          continue;
        }
        written = w;
        model = m;
        break;
      } catch (e) {
        console.warn(`[briefing] ${m} failed:`, e instanceof Error ? e.message : e);
      }
    }
  }
  if (!written) {
    if (geminiKey()) console.warn("[briefing] all Gemini models failed; using template");
    written = templateWrite(levels, news.articles, session);
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
