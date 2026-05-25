import Anthropic from "@anthropic-ai/sdk";
import type { AIAnalysis, AIAnswer, Ticker } from "./types.js";
import {
  getFinancials,
  getMultiples,
  getProfile,
  getQuote,
  getScores,
} from "./yahoo.js";

// Default to the most capable model. Swap to "claude-sonnet-4-6" (~3x cheaper)
// or "claude-haiku-4-5" (~5x cheaper) if cost outweighs analysis quality.
const MODEL = "claude-opus-4-7";

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
