import Anthropic from "@anthropic-ai/sdk";
import { expectedSessionDate } from "./briefing/calendar.js";
import type { GenerationResult } from "./briefing/types.js";
import type {
  AIAnalysis,
  AIAnswer,
  InvestorProfile,
  PortfolioPosition,
  PositionAnalysis,
  Ticker,
} from "./types.js";
import {
  getFinancials,
  getMultiples,
  getProfile,
  getQuote,
  getScores,
} from "./data.js";

// Default to the most capable model. Swap to "claude-sonnet-4-6" (~3x cheaper)
// or "claude-haiku-4-5" (~5x cheaper) if cost outweighs analysis quality.
const MODEL = "claude-opus-4-7";

// The daily briefing is a high-frequency web-search summary, not deep analysis,
// so it runs on Sonnet to cut cost. Bump to MODEL if quality slips.
// BRIEFING_MODEL env var overrides this for the failure-path test (point at a
// model that won't invoke web_search to force a SEARCH_NOT_EXECUTED rejection).
const BRIEFING_MODEL = process.env.BRIEFING_MODEL ?? "claude-sonnet-4-6";

let client: Anthropic | null = null;
function getClient(): Anthropic {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY is not set");
  }
  if (!client) client = new Anthropic();
  return client;
}

export function aiEnabled(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

/** Compact, factual snapshot fed to Claude so it reasons from real numbers. */
async function buildContext(symbol: Ticker): Promise<string> {
  const [profile, quote, fin, multiples, scores] = await Promise.all([
    getProfile(symbol),
    getQuote(symbol),
    getFinancials(symbol, "annual", 4).catch(() => null),
    getMultiples(symbol).catch(() => null),
    getScores(symbol).catch(() => null),
  ]);

  const pct = (v?: number) => (v == null ? null : Math.round(v * 1000) / 10);

  const context = {
    symbol,
    name: profile.name,
    sector: profile.sector,
    industry: profile.industry,
    description: profile.description?.slice(0, 600),
    price: quote.price,
    currency: profile.currency ?? "USD",
    marketCap: quote.marketCap,
    incomeStatement: fin?.income.map((r) => ({
      fy: r.date.slice(0, 4),
      revenue: r.revenue,
      grossProfit: r.grossProfit,
      operatingIncome: r.operatingIncome,
      netIncome: r.netIncome,
      eps: Number.isFinite(r.eps) ? r.eps : null,
    })),
    balanceSheetLatest: fin?.balance[0],
    cashFlowLatest: fin?.cashFlow[0],
    valuation: multiples && {
      peTTM: multiples.pe,
      pegTTM: multiples.pegRatio,
      psTTM: multiples.ps,
      pbTTM: multiples.pb,
      evToEbitdaTTM: multiples.evToEbitda,
      dividendYieldPct: pct(multiples.dividendYield),
    },
    profitability: multiples && {
      grossMarginPct: pct(multiples.grossMargin),
      operatingMarginPct: pct(multiples.operatingMargin),
      netMarginPct: pct(multiples.netMargin),
      roePct: pct(multiples.roe),
      roicPct: pct(multiples.roic),
    },
    health: multiples && {
      debtToEquity: multiples.debtToEquity,
      currentRatio: multiples.currentRatio,
      interestCoverage: multiples.interestCoverage,
    },
    qualityScores: scores && !scores.unavailable && {
      piotroskiF: scores.piotroski?.score,
      altmanZ: scores.altman?.z,
      altmanZone: scores.altman?.zone,
      composite: scores.composite?.score,
      grade: scores.composite?.grade,
    },
  };

  return JSON.stringify(context, null, 1);
}

const SYSTEM_PROMPT = `You are an equity-research assistant inside a stock-lookup app.
You are given a JSON snapshot of a company's real, current fundamentals and valuation.
Rules:
- Use ONLY the numbers in the provided data. Never invent figures, dates, or facts not present.
- If a data point is null/missing, do not speculate about it — work with what's there.
- Be specific and cite the actual numbers (e.g. "net margin of 27%", "P/E of 36x").
- Be balanced and concrete. No hype, no filler, no disclaimers about being an AI.
- This is informational only, not personalized investment advice.`;

export async function getAnalysis(symbol: Ticker): Promise<AIAnalysis> {
  const context = await buildContext(symbol);

  const message = await getClient().messages.create({
    model: MODEL,
    max_tokens: 4000,
    thinking: { type: "adaptive" },
    output_config: {
      effort: "medium",
      format: {
        type: "json_schema",
        schema: {
          type: "object",
          additionalProperties: false,
          properties: {
            summary: {
              type: "string",
              description:
                "2-3 sentence plain-English overview of what the company does and how it is performing financially, grounded in the numbers.",
            },
            bullCase: {
              type: "array",
              items: { type: "string" },
              description: "3-4 concise bull points, each citing a specific metric.",
            },
            bearCase: {
              type: "array",
              items: { type: "string" },
              description: "3-4 concise bear/risk points, each citing a specific metric.",
            },
          },
          required: ["summary", "bullCase", "bearCase"],
        },
      },
    },
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: `Company data:\n\n${context}\n\nWrite the summary, bull case, and bear case.`,
      },
    ],
  });

  const text = extractText(message);
  const parsed = JSON.parse(text) as {
    summary: string;
    bullCase: string[];
    bearCase: string[];
  };

  return {
    summary: parsed.summary,
    bullCase: parsed.bullCase ?? [],
    bearCase: parsed.bearCase ?? [],
    generatedAt: new Date().toISOString(),
    model: MODEL,
  };
}

/**
 * Assess one position in the context of the user's whole portfolio and stated
 * preferences. Powers the "you just added a stock" coaching flow on the
 * Dashboard.
 */
export async function getPositionAnalysis(
  symbol: Ticker,
  portfolio: PortfolioPosition[],
  profile: InvestorProfile | null,
): Promise<PositionAnalysis> {
  const context = await buildContext(symbol);

  const portfolioBlock = portfolio
    .map((p) => `${p.symbol}: ${p.weightPct.toFixed(1)}%${p.sector ? ` (${p.sector})` : ""}`)
    .join("\n");
  const profileBlock = profile
    ? [
        `Risk tolerance: ${profile.riskTolerance}`,
        `Time horizon: ${profile.horizon}`,
        `Focus: ${profile.focus}`,
        `Diversification style: ${profile.diversification}`,
        profile.preferredSectors.length
          ? `Preferred sectors: ${profile.preferredSectors.join(", ")}`
          : "Preferred sectors: no preference",
      ].join("\n")
    : "No stated preferences (treat as a balanced, long-term retail investor).";

  const message = await getClient().messages.create({
    model: MODEL,
    max_tokens: 4000,
    thinking: { type: "adaptive" },
    output_config: {
      effort: "medium",
      format: {
        type: "json_schema",
        schema: {
          type: "object",
          additionalProperties: false,
          properties: {
            summary: {
              type: "string",
              description:
                "2-3 sentences assessing this position inside this specific portfolio, grounded in the numbers.",
            },
            bullCase: {
              type: "array",
              items: { type: "string" },
              description: "2-3 concise bull points for the company, each citing a metric.",
            },
            bearCase: {
              type: "array",
              items: { type: "string" },
              description: "2-3 concise bear/risk points, each citing a metric.",
            },
            riskLevel: {
              type: "string",
              enum: ["low", "moderate", "elevated", "high"],
              description:
                "Overall risk of this position for THIS portfolio and investor profile.",
            },
            fitNotes: {
              type: "string",
              description:
                "1-2 sentences on how this position fits (or conflicts with) the investor's stated risk tolerance, horizon, focus, and sector preferences.",
            },
            portfolioImpact: {
              type: "string",
              description:
                "1-2 sentences on what this position does to portfolio concentration: weight of the holding, sector tilt, diversification.",
            },
          },
          required: [
            "summary",
            "bullCase",
            "bearCase",
            "riskLevel",
            "fitNotes",
            "portfolioImpact",
          ],
        },
      },
    },
    system: `${SYSTEM_PROMPT}
You are also given the investor's current portfolio weights and stated preferences.
Judge the position IN CONTEXT: a fine company can still be a risky position if it
dominates the portfolio or fights the investor's stated style. Be direct about
concentration. This is informational only, not personalized investment advice.`,
    messages: [
      {
        role: "user",
        content: `Company data:\n\n${context}\n\nCurrent portfolio weights (including this position):\n${portfolioBlock}\n\nInvestor profile:\n${profileBlock}\n\nAssess the ${symbol} position.`,
      },
    ],
  });

  const parsed = JSON.parse(extractText(message)) as Omit<
    PositionAnalysis,
    "symbol" | "generatedAt" | "model"
  >;

  return {
    symbol,
    ...parsed,
    generatedAt: new Date().toISOString(),
    model: MODEL,
  };
}

export async function askQuestion(symbol: Ticker, question: string): Promise<AIAnswer> {
  const context = await buildContext(symbol);

  const message = await getClient().messages.create({
    model: MODEL,
    max_tokens: 1500,
    thinking: { type: "adaptive" },
    output_config: { effort: "low" },
    system: `${SYSTEM_PROMPT}
Answer the user's question about this company in 1-3 short paragraphs of plain prose.
Do NOT use markdown — no headers (#), no bold (**), no tables. Plain sentences only;
a simple hyphen list is fine. If the data needed to answer isn't in the snapshot,
say so plainly rather than guessing.`,
    messages: [
      {
        role: "user",
        content: `Company data:\n\n${context}\n\nQuestion: ${question}`,
      },
    ],
  });

  return { answer: extractText(message).trim() };
}

function extractText(message: Anthropic.Message): string {
  const parts: string[] = [];
  for (const block of message.content) {
    if (block.type === "text") parts.push(block.text);
  }
  return parts.join("").trim();
}

// ---------- daily market briefing (web search + freshness gate) ----------

/**
 * The system prompt is deliberately strict — every rule maps to a gate in
 * server/src/briefing/freshness.ts. If you loosen it, you'll surface more
 * gate rejections (which is fine and safe), not fewer.
 *
 * Rule → gate correspondence:
 *   1 (search first)         → SEARCH_NOT_EXECUTED / NO_RETRIEVED_SOURCES
 *   2 (URL verbatim)         → FABRICATED_CITATION
 *   3 (per-level source_url) → UNCITED_LEVEL
 *   4 (prose ⊆ declared)     → UNBACKED_PROSE_NUMBER
 *   5 (session_date pinned)  → SESSION_MISMATCH
 *   6 (latest_source_date)   → SOURCE_DATE_STALE
 */
function buildBriefingSystemPrompt(expectedSession: string): string {
  return [
    "You are the markets editor for Voyance, an equity-research app. You write the daily briefing.",
    "",
    `The session you MUST describe is the US trading session dated ${expectedSession}.`,
    "Do not describe any other session. If you cannot confirm that session's closing data",
    "from search results, return session_date as the most recent date you can actually confirm —",
    "do not substitute a nearby day and do not estimate.",
    "",
    "Rules, all non-negotiable:",
    "1. Every number you report must come from a search result you retrieved in this",
    "   conversation. Never supply a figure from memory, even if you are confident.",
    "2. Every source_url must be a URL that appeared in your search results verbatim.",
    "   Never construct, guess, or complete a URL.",
    "3. Every entry in `levels` and every entry in `drivers` must include its own source_url.",
    "4. Any index level, price, or percentage that appears in prose (headline, summary,",
    "   driver.detail) must ALSO appear in the structured `levels` block with the same",
    "   value. Do not put figures in prose that aren't declared in levels.",
    "5. `session_date` is the trading session you describe, in YYYY-MM-DD.",
    "6. `latest_source_date` is the most recent publication date you saw in any source,",
    "   in YYYY-MM-DD. It must be >= session_date.",
    "7. Cite at least two distinct source domains across the whole brief.",
    "",
    "Return ONLY a JSON object. No preamble, no markdown fences, no trailing commentary.",
    "Schema (all fields required unless marked optional):",
    "{",
    '  "session_date": "YYYY-MM-DD",',
    '  "latest_source_date": "YYYY-MM-DD",',
    '  "headline": "one line, no figures",',
    '  "summary": "2-5 sentences on what happened and why",',
    '  "levels": {',
    '    "spx": { "value": number, "change_pct": number, "source_url": "..." },',
    '    "ndx": { "value": number, "change_pct": number, "source_url": "..." },',
    '    "dji": { "value": number, "change_pct": number, "source_url": "..." },',
    '    "vix":    { ... optional },',
    '    "ust10y": { ... optional }',
    "  },",
    '  "drivers": [{ "title": "...", "detail": "...", "source_url": "..." }],',
    '  "ahead":   [{ "when": "...", "event": "...", "why": "..." }]',
    "}",
    "Keep drivers to the 2-4 that actually moved things. Cover Fed/rates, inflation,",
    "major geopolitical events, and big sector/commodity moves as they matter for the day.",
    "Keep research efficient: 3-6 broad searches are usually enough. Once you have the",
    "close, the moves, and the drivers you need, stop searching and write the JSON.",
  ].join("\n");
}

// web_search_20260209 remains the working tool version. Left uncapped: with a
// hard max_uses the model hits the cap, loops on pause_turn, and truncates its
// JSON output (observed 480s+ runs). The system prompt nudges toward fewer.
const BRIEFING_TOOLS = [
  { type: "web_search_20260209", name: "web_search" } as never,
];

/**
 * Generate a raw briefing payload. Returns the model's parsed output plus the
 * retrieval metadata the freshness gate needs (searchCount, searchUrls, model).
 *
 * This function does NOT validate the payload. The caller (briefing-store)
 * runs assertFreshness() on the result and decides whether to persist.
 */
export async function getMarketBriefing(): Promise<GenerationResult> {
  const expectedSession = expectedSessionDate();
  const system = buildBriefingSystemPrompt(expectedSession);
  const userContent = `Search for and report the ${expectedSession} US market close (S&P 500, Nasdaq 100, Dow). Then write the JSON per the schema.`;

  let message = await getClient().messages.create({
    model: BRIEFING_MODEL,
    max_tokens: 4000,
    thinking: { type: "adaptive" },
    output_config: { effort: "medium" },
    system,
    tools: BRIEFING_TOOLS,
    messages: [{ role: "user", content: userContent }],
  });

  // Server-side tool loop may pause; resume up to a few times.
  const history: Anthropic.MessageParam[] = [{ role: "user", content: userContent }];
  let guard = 0;
  while (message.stop_reason === "pause_turn" && guard < 3) {
    guard += 1;
    history.push({ role: "assistant", content: message.content });
    message = await getClient().messages.create({
      model: BRIEFING_MODEL,
      max_tokens: 4000,
      thinking: { type: "adaptive" },
      output_config: { effort: "medium" },
      system,
      tools: BRIEFING_TOOLS,
      messages: history,
    });
  }

  const { urls, count } = extractRetrieval(message.content);
  const payload = parseJsonLoose(extractText(message));

  return {
    payload,
    searchUrls: urls,
    searchCount: count,
    model: message.model ?? BRIEFING_MODEL,
  };
}

/** Pull the URLs the web_search tool actually returned, plus how many searches ran. */
function extractRetrieval(content: unknown[]): { urls: string[]; count: number } {
  const urls: string[] = [];
  let count = 0;
  for (const raw of content ?? []) {
    const block = raw as Record<string, unknown>;
    if (block?.type === "server_tool_use" && block?.name === "web_search") count++;
    if (block?.type === "web_search_tool_result") {
      const items = Array.isArray(block.content) ? (block.content as Record<string, unknown>[]) : [];
      for (const item of items) {
        if (item?.type === "web_search_result" && typeof item.url === "string") {
          urls.push(item.url);
        }
      }
    }
  }
  return { urls: [...new Set(urls)], count };
}

/**
 * Web search wraps cited claims in <cite index="..">..</cite> markup. Strip the
 * tags (keeping the text) so they don't render literally in the UI. Exported so
 * the briefing store can apply it when building the client-facing MarketBriefing
 * from the accepted payload.
 */
export function stripCitations(text: string): string {
  return text
    .replace(/<\/?cite[^>]*>/gi, "")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

/** Parse a JSON object out of model text, tolerating code fences / stray prose. */
function parseJsonLoose(text: string): unknown {
  let t = text.trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) t = fence[1].trim();
  const start = t.indexOf("{");
  const end = t.lastIndexOf("}");
  if (start >= 0 && end > start) t = t.slice(start, end + 1);
  return JSON.parse(t);
}
