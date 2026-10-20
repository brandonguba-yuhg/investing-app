// Morning briefing editions — the daily briefing users see, replacing the
// after-close recap:
//
//   premarket  7:00am ET  Why stocks are set to open higher/lower today.
//   open       9:40am ET  How stocks actually opened, and whether the move
//                         flipped from what pre-market suggested.
//
// Same free pipeline and guarantees as free.ts. Today's direction comes from
// Nasdaq.com's delayed quotes for SPY/QQQ/DIA (index futures aren't available
// free); the "why" from news since the prior close plus today's economic
// calendar. The prior session's index closes (FRED/Nasdaq) form the `levels`
// block, so the existing eight-gate freshness check applies unchanged with
// session_date = the prior session.

import { getUpcomingMacroEvents } from "../macroEvents.js";
import { etParts } from "./calendar.js";
import {
  type Article,
  type Written,
  GEMINI_MODELS,
  LevelsNotReadyError,
  NAMES,
  callGemini,
  dropUnbackedNumbers,
  etDate,
  fetchBodies,
  fetchLevels,
  fetchNews,
  fetchText,
  firstSentences,
  fmt,
  geminiKey,
  levelsForPrompt,
  rankForTemplate,
  round,
} from "./free.js";
import type { BriefingEdition, BriefingPayload, GenerationResult, MarketMove } from "./types.js";

export type MorningEdition = Exclude<BriefingEdition, "recap">;

const ETFS = [
  { symbol: "SPY", name: "S&P 500" },
  { symbol: "QQQ", name: "Nasdaq 100" },
  { symbol: "DIA", name: "Dow" },
];

const OPEN_ET_MINUTES = 9 * 60 + 30;

/** "Oct 21, 2026 9:38 AM ET" / "Closed at Oct 20, 2026 4:00 PM ET" / "Oct 20, 2026" */
function parseNasdaqTime(raw: string | undefined): { date: string; minutes: number | null } | null {
  const m = raw
    ?.replace(/^.*?(?=[A-Z][a-z]{2} \d)/, "")
    .trim()
    .match(/^(\w{3}) (\d{1,2}), (\d{4})(?: (\d{1,2}):(\d{2}) (AM|PM) ET)?$/);
  if (!m) return null;
  const month = "JanFebMarAprMayJunJulAugSepOctNovDec".indexOf(m[1]) / 3 + 1;
  if (month < 1) return null;
  const date = `${m[3]}-${String(month).padStart(2, "0")}-${m[2].padStart(2, "0")}`;
  const minutes = m[4] ? ((Number(m[4]) % 12) + (m[6] === "PM" ? 12 : 0)) * 60 + Number(m[5]) : null;
  return { date, minutes };
}

const num = (s: string | undefined) => Number((s ?? "").replace(/[$,%+]/g, ""));

/**
 * One ETF's move vs the prior close, valid for the requested edition:
 *  - premarket: Nasdaq reports pre-market status and a trade from today.
 *  - open:      the market is open and the last (delayed) trade is from today
 *               at or after 9:30am — otherwise it's still showing pre-market.
 */
async function fetchMove(
  etf: { symbol: string; name: string },
  today: string,
  edition: MorningEdition,
): Promise<MarketMove | null> {
  const body = JSON.parse(
    await fetchText(`https://api.nasdaq.com/api/quote/${etf.symbol}/info?assetclass=etf`),
  ) as {
    data?: {
      marketStatus?: string;
      primaryData?: { lastSalePrice?: string; percentageChange?: string; lastTradeTimestamp?: string };
      secondaryData?: { lastSalePrice?: string; lastTradeTimestamp?: string } | null;
    };
  };
  const d = body.data;
  const status = d?.marketStatus ?? "";
  const p = d?.primaryData;
  const at = parseNasdaqTime(p?.lastTradeTimestamp);
  if (!d || !p || !at || at.date !== today) return null;

  if (edition === "premarket" && !/pre/i.test(status)) return null;
  if (edition === "open") {
    if (/pre|closed/i.test(status)) return null;
    if (at.minutes != null && at.minutes < OPEN_ET_MINUTES) return null;
  }

  const price = num(p.lastSalePrice);
  if (!Number.isFinite(price) || price <= 0) return null;
  // Outside regular hours Nasdaq puts the last regular close in secondaryData;
  // measure against it when it's from an earlier day (i.e. the prior close).
  const prevClose = num(d.secondaryData?.lastSalePrice);
  const prevAt = parseNasdaqTime(d.secondaryData?.lastTradeTimestamp ?? undefined);
  const pct =
    Number.isFinite(prevClose) && prevClose > 0 && prevAt && prevAt.date < today
      ? (price / prevClose - 1) * 100
      : num(p.percentageChange);
  if (!Number.isFinite(pct)) return null;

  return {
    symbol: etf.symbol,
    name: etf.name,
    price: round(price, 2),
    change_pct: round(pct, 2),
    as_of: p.lastTradeTimestamp ?? "",
    source_url: `https://www.nasdaq.com/market-activity/etf/${etf.symbol.toLowerCase()}`,
  };
}

async function fetchMoves(today: string, edition: MorningEdition): Promise<MarketMove[]> {
  const moves = await Promise.all(
    ETFS.map((e) =>
      fetchMove(e, today, edition).catch((err) => {
        console.warn(`[briefing] ${e.symbol} quote failed:`, err instanceof Error ? err.message : err);
        return null;
      }),
    ),
  );
  return moves.every(Boolean) ? (moves as MarketMove[]) : [];
}

function etTimeLabel(ms: number): string {
  return new Date(ms).toLocaleString("en-US", {
    timeZone: "America/New_York",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function direction(moves: MarketMove[]): "higher" | "lower" | "mixed" | "flat" {
  const up = moves.filter((m) => m.change_pct > 0.05).length;
  const down = moves.filter((m) => m.change_pct < -0.05).length;
  if (up === moves.length) return "higher";
  if (down === moves.length) return "lower";
  if (up === 0 && down === 0) return "flat";
  return "mixed";
}

function movesSentence(moves: MarketMove[]): string {
  const parts = moves.map(
    (m) => `${m.symbol} (${m.name}) ${m.change_pct >= 0 ? "up" : "down"} ${Math.abs(m.change_pct).toFixed(2)}%`,
  );
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

function priorCloseSentence(levels: BriefingPayload["levels"], session: string): string {
  const parts = (["spx", "ndx", "dji"] as const).map((k) => {
    const l = levels[k];
    if (l.change_pct == null) return `the ${NAMES[k]} closed at ${fmt(l.value)}`;
    return `the ${NAMES[k]} ${l.change_pct >= 0 ? "rose" : "fell"} ${Math.abs(l.change_pct).toFixed(2)}% to ${fmt(l.value)}`;
  });
  return `In the previous session (${session}), ${parts[0]}, ${parts[1]} and ${parts[2]}.`;
}

function todaysCalendar(today: string) {
  return getUpcomingMacroEvents(today, 0).map((e) => ({ event: e.title, detail: e.detail ?? "" }));
}

// ---------- writers ----------

function templateWrite(
  edition: MorningEdition,
  levels: BriefingPayload["levels"],
  session: string,
  moves: MarketMove[],
  premarket: MarketMove[] | undefined,
  articles: Article[],
  bodies: Map<string, string>,
  today: string,
): Written {
  const dir = moves.length ? direction(moves) : null;
  const leader = moves.length
    ? moves.reduce((a, b) => (Math.abs(b.change_pct) > Math.abs(a.change_pct) ? b : a))
    : null;
  const lead = leader && (dir === "higher" || dir === "lower") ? `, led by the ${leader.name}` : "";
  const headline = !dir
    ? "What's moving markets before the open"
    : edition === "premarket"
      ? dir === "flat" ? "Stocks set for a flat open" : `Stocks set to open ${dir}${lead}`
      : dir === "flat" ? "Stocks open little changed" : dir === "mixed" ? "Stocks open mixed" : `Stocks open ${dir}${lead}`;

  const sentences: string[] = [];
  if (moves.length) {
    sentences.push(`${edition === "premarket" ? "Before the bell" : "In early trading"}, ${movesSentence(moves)}.`);
  }
  const spyNow = moves.find((m) => m.symbol === "SPY");
  const spyPre = premarket?.find((m) => m.symbol === "SPY");
  if (edition === "open" && spyNow && spyPre && Math.sign(spyNow.change_pct) !== Math.sign(spyPre.change_pct)) {
    sentences.push(
      `That reverses the pre-market signal, when SPY was ${spyPre.change_pct >= 0 ? "up" : "down"} ${Math.abs(spyPre.change_pct).toFixed(2)}%.`,
    );
  }
  sentences.push(priorCloseSentence(levels, session));
  const cal = todaysCalendar(today);
  if (cal.length) sentences.push(`Scheduled today: ${cal.map((c) => `${c.event} (${c.detail})`).join("; ")}.`);

  return {
    headline,
    summary: sentences.join(" "),
    drivers: rankForTemplate(articles).map((a) => {
      const body = dropUnbackedNumbers(firstSentences(bodies.get(a.url) ?? "", 4), levels);
      const blurb = dropUnbackedNumbers(a.description, levels);
      return { title: a.title, detail: body || blurb || `Reported by ${a.source}.`, source_url: a.url };
    }),
  };
}

function editionTask(edition: MorningEdition, today: string): string {
  return edition === "premarket"
    ? `explain why US stocks are set to open higher, lower or mixed today (${today}), based on the pre-market ETF moves`
    : `explain how US stocks opened today (${today}) and why, based on the early-trading ETF moves`;
}

function promptContext(
  edition: MorningEdition,
  levels: BriefingPayload["levels"],
  session: string,
  moves: MarketMove[],
  premarket: MarketMove[] | undefined,
  today: string,
) {
  return {
    today,
    edition,
    todays_moves: moves.map((m) => ({ etf: m.symbol, tracks: m.name, change_pct: m.change_pct, as_of: m.as_of })),
    premarket_moves_at_7am: premarket?.map((m) => ({ etf: m.symbol, tracks: m.name, change_pct: m.change_pct })),
    prior_session: { date: session, closes: levelsForPrompt(levels) },
    scheduled_today: todaysCalendar(today),
  };
}

async function geminiPick(
  model: string,
  edition: MorningEdition,
  context: ReturnType<typeof promptContext>,
  articles: Article[],
): Promise<Article[]> {
  const system = [
    "You are the markets editor for Voyance, an equity-research app.",
    `Pick the 3-4 stories from the article list that best ${editionTask(edition, context.today)}:`,
    "overnight and morning news, stock-futures coverage, earnings released before the bell, this",
    "morning's economic data, Fed commentary, global markets, oil and yields. Prefer the most recent",
    "stories. Skip single-stock analyst notes and stories about earlier sessions.",
    'Return ONLY JSON: { "ids": [number, ...] }',
  ].join("\n");
  const user = JSON.stringify({
    ...context,
    articles: articles.map((a, id) => ({
      id,
      source: a.source,
      published_et: etTimeLabel(a.publishedAt),
      title: a.title,
      summary: a.description,
    })),
  });
  const out = (await callGemini(model, system, user)) as { ids?: unknown[] };
  const picks = (out.ids ?? []).flatMap((id) => (typeof id === "number" && articles[id] ? [articles[id]] : []));
  if (!picks.length) throw new Error("Gemini picked no articles");
  return [...new Set(picks)].slice(0, 4);
}

async function geminiWrite(
  model: string,
  edition: MorningEdition,
  context: ReturnType<typeof promptContext>,
  levels: BriefingPayload["levels"],
  picks: Article[],
  bodies: Map<string, string>,
): Promise<Written> {
  const flipRule =
    edition === "open" && context.premarket_moves_at_7am?.length
      ? [
          "5. Compare todays_moves with premarket_moves_at_7am. If the direction changed (e.g. pre-market",
          "   pointed lower but stocks opened higher), the headline and first sentence must say so and",
          "   explain what changed, using the articles.",
        ]
      : [];
  const system = [
    "You are the markets editor for Voyance, an equity-research app. You write the morning briefing.",
    `Your job: ${editionTask(edition, context.today)}. Use ONLY the data and articles provided.`,
    "Rules, all non-negotiable:",
    "1. Never state facts or figures that are not in the provided material. No outside knowledge.",
    "2. Do NOT write index levels (e.g. 7,659.44) or any number of 1,000 or more written with commas",
    '   or decimals. Use percentages, or words like "$2 trillion" or "about 1.2 million".',
    "3. Each driver must reference one article by its numeric `id`, and its detail must come from that article.",
    "4. Moves are for ETFs that track the indexes (SPY = S&P 500, QQQ = Nasdaq 100, DIA = Dow).",
    "   Say so, e.g. \"the S&P 500 tracker SPY was up 0.4% before the bell\". Do not call them futures.",
    ...flipRule,
    "Return ONLY JSON matching:",
    '{ "headline": "one line, no figures, says which way stocks are heading/opened",',
    '  "summary": "4-6 sentences: today\'s direction with each ETF\'s percent move, the main reasons why,',
    '              anything in scheduled_today, and one sentence on how the prior session closed (percent moves only)",',
    "scheduled_today lists economic releases only (not earnings). If it is empty, don't mention the calendar",
    "or claim nothing is scheduled.",
    '  "drivers": [{ "id": number, "title": "short, specific headline",',
    '                "detail": "3-5 sentences (60-110 words): the story, key facts, and why it matters for today\'s open" }] }',
    "Write one driver per article provided.",
  ].join("\n");
  const user = JSON.stringify({
    ...context,
    articles: picks.map((a, id) => ({
      id,
      source: a.source,
      published_et: etTimeLabel(a.publishedAt),
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

// ---------- entry point ----------

/**
 * @param session   the prior trading session (its closes fill `levels`)
 * @param premarket the 7am edition's moves, passed to the 9:40 run so it can
 *                  call out a change in direction after the open
 */
export async function generateMorningBriefing(
  edition: MorningEdition,
  today: string,
  session: string,
  premarket?: MarketMove[],
): Promise<GenerationResult> {
  const [lv, news, moves] = await Promise.all([
    fetchLevels(session),
    fetchNews(session),
    fetchMoves(today, edition),
  ]);

  const missing = (["spx", "ndx", "dji"] as const).filter((k) => !lv.levels[k]);
  if (missing.length) {
    throw new LevelsNotReadyError(`${session} close not published yet for ${missing.join(", ")}`);
  }
  // The open edition is about direction, so it waits for post-9:30 quotes. The
  // 7am edition can stand on news alone if pre-market quotes aren't available.
  if (edition === "open" && moves.length === 0) {
    throw new LevelsNotReadyError(`opening quotes for ${today} not available yet`);
  }
  const levels = lv.levels as BriefingPayload["levels"];

  const withText = news.articles.filter((a) => a.description.length >= 40);
  const candidates = (withText.length >= 3 ? withText : news.articles).slice(-60);
  const context = promptContext(edition, levels, session, moves, premarket, today);

  let written: Written | null = null;
  let model = "template";
  if (geminiKey() && candidates.length) {
    for (const m of GEMINI_MODELS) {
      try {
        const picks = await geminiPick(m, edition, context, candidates);
        const bodies = await fetchBodies(picks);
        written = await geminiWrite(m, edition, context, levels, picks, bodies);
        model = m;
        break;
      } catch (e) {
        console.warn(`[briefing] ${m} failed:`, e instanceof Error ? e.message : e);
      }
    }
  }
  if (!written) {
    if (geminiKey()) console.warn("[briefing] all Gemini models failed; using template");
    const bodies = await fetchBodies(rankForTemplate(candidates));
    written = templateWrite(edition, levels, session, moves, premarket, candidates, bodies, today);
  }

  const used = new Set(written.drivers.map((d) => d.source_url));
  const sourceDates = [
    ...lv.dates,
    ...news.articles.filter((a) => used.has(a.url)).map((a) => a.date),
    ...(moves.length ? [today] : []),
  ].sort();

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
    edition,
    brief_date: today,
    moves: moves.length ? moves : undefined,
    premarket_moves: edition === "open" && premarket?.length ? premarket : undefined,
  };

  return {
    payload,
    searchUrls: [
      ...new Set([...lv.urls, ...moves.map((m) => m.source_url), ...news.articles.map((a) => a.url)]),
    ],
    searchCount: lv.urls.length + news.feedsOk + (moves.length ? 1 : 0),
    model,
  };
}

/** The edition due at `at`, or null outside the morning window / on non-trading days. */
export function dueEdition(
  at: Date,
  isTradingDay: (d: string) => boolean,
): { edition: MorningEdition; today: string } | null {
  const { date, minutes } = etParts(at);
  if (!isTradingDay(date)) return null;
  if (minutes >= 9 * 60 + 40) return { edition: "open", today: date };
  if (minutes >= 7 * 60) return { edition: "premarket", today: date };
  return null;
}
