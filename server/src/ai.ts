import Anthropic from "@anthropic-ai/sdk";
import type {
  AIAnalysis,
  AIAnswer,
  InvestorProfile,
  MarketBriefing,
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
const BRIEFING_MODEL = "claude-sonnet-4-6";

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

// ---------- daily market briefing (web search) ----------

const BRIEFING_SYSTEM = `You are the markets editor for a stock-research app, writing today's macro briefing.
Use web search to find the most important market-moving developments from the last 24 hours:
the Fed and interest rates, inflation data, major geopolitical events (wars, elections, trade),
big equity/sector/commodity/currency moves, and notable economic data.

Then respond with ONLY a JSON object (no prose before/after, no markdown code fences) of this shape:
{
  "headline": "one punchy line capturing the day's single biggest market story",
  "overview": "2-3 sentence summary of the overall market mood and what's driving it",
  "items": [
    { "heading": "short topic label, e.g. 'Fed & Rates'", "summary": "2-3 factual sentences" }
  ]
}
Include 4-6 items covering distinct themes. Be specific and factual — cite figures, levels,
and named events from your search. No hype, no investment advice, no AI disclaimers.

Keep research efficient: run at most ~5 broad web searches (e.g. "stock market today",
"Fed interest rates news", "oil prices geopolitics") rather than one narrow search per
sub-topic. Once you have enough to cover the themes, stop searching and write the JSON.`;

// A hard max_uses cap fights this prompt's multi-theme coverage: the model wants
// more searches, hits the cap, then loops on pause_turn until the guard runs out
// (observed 480s+ runs and truncated JSON). Instead we keep the tool uncapped and
// nudge toward fewer searches via the system prompt below.
const BRIEFING_TOOLS = [
  { type: "web_search_20260209", name: "web_search" } as never,
];

export async function getMarketBriefing(): Promise<MarketBriefing> {
  const today = new Date().toISOString().slice(0, 10);

  let message = await getClient().messages.create({
    model: BRIEFING_MODEL,
    max_tokens: 4000,
    thinking: { type: "adaptive" },
    output_config: { effort: "medium" },
    system: BRIEFING_SYSTEM,
    tools: BRIEFING_TOOLS,
    messages: [
      {
        role: "user",
        content: `Write today's market briefing for ${today}. Search for the latest macro and market news first.`,
      },
    ],
  });

  // Server-side tool loop may pause; resume up to a few times.
  let guard = 0;
  const history: Anthropic.MessageParam[] = [
    {
      role: "user",
      content: `Write today's market briefing for ${today}. Search for the latest macro and market news first.`,
    },
  ];
  while (message.stop_reason === "pause_turn" && guard < 3) {
    guard += 1;
    history.push({ role: "assistant", content: message.content });
    message = await getClient().messages.create({
      model: BRIEFING_MODEL,
      max_tokens: 4000,
      thinking: { type: "adaptive" },
      output_config: { effort: "medium" },
      system: BRIEFING_SYSTEM,
      tools: BRIEFING_TOOLS,
      messages: history,
    });
  }

  const parsed = parseJsonLoose(extractText(message)) as {
    headline?: string;
    overview?: string;
    items?: Array<{ heading?: string; summary?: string }>;
  };

  const items = (parsed.items ?? [])
    .filter((i) => i.heading && i.summary)
    .map((i) => ({
      heading: stripCitations(String(i.heading)),
      summary: stripCitations(String(i.summary)),
    }));

  return {
    date: today,
    headline: stripCitations(parsed.headline ?? "Today's market briefing"),
    overview: stripCitations(parsed.overview ?? ""),
    items,
    sources: extractSources(message),
    generatedAt: new Date().toISOString(),
    model: BRIEFING_MODEL,
  };
}

// Web search wraps cited claims in <cite index="..">..</cite> markup. Strip the
// tags (keeping the text) so they don't render literally in the UI; real source
// links are surfaced separately via extractSources().
function stripCitations(text: string): string {
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

/** Best-effort pull of source links from web_search_tool_result blocks. */
function extractSources(
  message: Anthropic.Message,
): { title: string; url: string }[] | undefined {
  const out: { title: string; url: string }[] = [];
  const seen = new Set<string>();
  const blocks = message.content as unknown as Array<Record<string, unknown>>;
  for (const block of blocks) {
    if (block.type !== "web_search_tool_result") continue;
    const content = block.content as Array<Record<string, unknown>> | undefined;
    if (!Array.isArray(content)) continue;
    for (const r of content) {
      const url = r.url as string | undefined;
      const title = (r.title as string | undefined) ?? url;
      if (url && title && !seen.has(url)) {
        seen.add(url);
        out.push({ title, url });
      }
    }
  }
  return out.length ? out.slice(0, 8) : undefined;
}
