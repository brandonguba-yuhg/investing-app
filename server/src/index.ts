import dotenv from "dotenv";
// override:true so a local .env wins over an empty/ambient ANTHROPIC_API_KEY
// (some shells/harnesses pre-set it to ""). On Railway there's no .env file,
// so the platform-injected variables are left untouched.
dotenv.config({ override: true });
import cors from "cors";
import express, { type NextFunction, type Request, type Response } from "express";
import * as ai from "./ai.js";
import { cache, TTL } from "./cache.js";
import * as data from "./data.js";
import * as events from "./events.js";

const app = express();
app.use(express.json({ limit: "16kb" }));
const PORT = Number(process.env.PORT) || 3001;

// CORS: allow the configured frontend origin in prod, plus localhost dev ports.
const allowedOrigins = (process.env.ALLOWED_ORIGINS ?? "")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true); // curl, server-to-server
      if (
        origin.startsWith("http://localhost:") ||
        origin.startsWith("http://127.0.0.1:") ||
        allowedOrigins.includes(origin)
      ) {
        return callback(null, true);
      }
      callback(new Error(`Origin ${origin} not allowed by CORS`));
    },
  }),
);

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    cached: cache.size(),
    ai: ai.aiEnabled(),
    time: new Date().toISOString(),
  });
});

app.get("/api/search", async (req, res, next) => {
  try {
    const q = String(req.query.q ?? "").trim();
    if (!q) return res.json([]);
    const out = await cache.wrap(`search:${q.toLowerCase()}`, TTL.search, () =>
      data.search(q),
    );
    res.json(out);
  } catch (e) {
    next(e);
  }
});

app.get("/api/profile/:symbol", async (req, res, next) => {
  try {
    const symbol = req.params.symbol.toUpperCase();
    const out = await cache.wrap(`profile:${symbol}`, TTL.profile, () =>
      data.getProfile(symbol),
    );
    res.json(out);
  } catch (e) {
    next(e);
  }
});

app.get("/api/quote/:symbol", async (req, res, next) => {
  try {
    const symbol = req.params.symbol.toUpperCase();
    const out = await cache.wrap(`quote:${symbol}`, TTL.quote, () =>
      data.getQuote(symbol),
    );
    res.json(out);
  } catch (e) {
    next(e);
  }
});

app.get("/api/financials/:symbol", async (req, res, next) => {
  try {
    const symbol = req.params.symbol.toUpperCase();
    const period = req.query.period === "quarter" ? "quarter" : "annual";
    const limit = Math.min(20, Math.max(1, Number(req.query.limit) || 5));
    const out = await cache.wrap(
      `fin:${symbol}:${period}:${limit}`,
      TTL.financials,
      () => data.getFinancials(symbol, period, limit),
    );
    res.json(out);
  } catch (e) {
    next(e);
  }
});

app.get("/api/news/:symbol", async (req, res, next) => {
  try {
    const symbol = req.params.symbol.toUpperCase();
    const limit = Math.min(20, Math.max(1, Number(req.query.limit) || 10));
    const out = await cache.wrap(`news:${symbol}:${limit}`, TTL.news, () =>
      data.getNews(symbol, limit),
    );
    res.json(out);
  } catch (e) {
    next(e);
  }
});

app.get("/api/history/:symbol", async (req, res, next) => {
  try {
    const symbol = req.params.symbol.toUpperCase();
    const rangeRaw = String(req.query.range ?? "1y").toLowerCase();
    const validRanges = ["1d", "1m", "6m", "1y", "5y"] as const;
    type Range = (typeof validRanges)[number];
    const range = (validRanges as readonly string[]).includes(rangeRaw)
      ? (rangeRaw as Range)
      : ("1y" as Range);
    const ttl = range === "1d" ? TTL.historyIntraday : TTL.historyDaily;
    const out = await cache.wrap(`hist:${symbol}:${range}`, ttl, () =>
      data.getHistory(symbol, range),
    );
    res.json(out);
  } catch (e) {
    next(e);
  }
});

// ---- AI endpoints (Claude) -------------------------------------------------

// Simple in-memory rate limit for the costly ask endpoint: N requests / window / IP.
const askHits = new Map<string, number[]>();
const ASK_WINDOW_MS = 60 * 1000;
const ASK_MAX = 8;
function askRateLimited(ip: string): boolean {
  const now = Date.now();
  const hits = (askHits.get(ip) ?? []).filter((t) => now - t < ASK_WINDOW_MS);
  hits.push(now);
  askHits.set(ip, hits);
  return hits.length > ASK_MAX;
}

app.get("/api/briefing", async (_req, res, next) => {
  try {
    if (!ai.aiEnabled()) {
      return res.status(503).json({ error: "AI briefing is not configured." });
    }
    // Cache key includes the date so it rolls over to a fresh briefing daily.
    const today = new Date().toISOString().slice(0, 10);
    const out = await cache.wrap(`briefing:${today}`, TTL.briefing, () =>
      ai.getMarketBriefing(),
    );
    res.json(out);
  } catch (e) {
    next(e);
  }
});

app.get("/api/events", async (req, res, next) => {
  try {
    // Optional watchlist so the feed can include those companies' earnings.
    // The upstream FMP fetch is cached by date inside getUpcomingEvents, so
    // varying watchlists don't multiply API calls.
    const watchlist = String(req.query.watchlist ?? "")
      .split(",")
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean)
      .slice(0, 50);
    const out = await events.getUpcomingEvents(watchlist);
    res.json(out);
  } catch (e) {
    next(e);
  }
});

app.get("/api/analysis/:symbol", async (req, res, next) => {
  try {
    if (!ai.aiEnabled()) {
      return res.status(503).json({ error: "AI analysis is not configured." });
    }
    const symbol = req.params.symbol.toUpperCase();
    const out = await cache.wrap(`analysis:${symbol}`, TTL.analysis, () =>
      ai.getAnalysis(symbol),
    );
    res.json(out);
  } catch (e) {
    next(e);
  }
});

app.post("/api/ask/:symbol", async (req, res, next) => {
  try {
    if (!ai.aiEnabled()) {
      return res.status(503).json({ error: "AI is not configured." });
    }
    const ip = req.ip ?? "unknown";
    if (askRateLimited(ip)) {
      return res.status(429).json({ error: "Too many questions. Wait a minute and try again." });
    }
    const symbol = req.params.symbol.toUpperCase();
    const question = String((req.body as { question?: unknown })?.question ?? "").trim();
    if (!question) return res.status(400).json({ error: "Missing question." });
    if (question.length > 500) {
      return res.status(400).json({ error: "Question too long (max 500 chars)." });
    }
    const out = await ai.askQuestion(symbol, question);
    res.json(out);
  } catch (e) {
    next(e);
  }
});

app.get("/api/scores/:symbol", async (req, res, next) => {
  try {
    const symbol = req.params.symbol.toUpperCase();
    const out = await cache.wrap(`scores:${symbol}`, TTL.scores, () =>
      data.getScores(symbol),
    );
    res.json(out);
  } catch (e) {
    next(e);
  }
});

app.get("/api/multiples/:symbol", async (req, res, next) => {
  try {
    const symbol = req.params.symbol.toUpperCase();
    const out = await cache.wrap(`mult:${symbol}`, TTL.multiples, () =>
      data.getMultiples(symbol),
    );
    res.json(out);
  } catch (e) {
    next(e);
  }
});

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  const message = err instanceof Error ? err.message : "Unknown error";
  const status = /not found|no .* for/i.test(message) ? 404 : 500;
  console.error("[error]", message);
  res.status(status).json({ error: message });
});

app.listen(PORT, () => {
  console.log(`investing-app server listening on :${PORT}`);
  if (allowedOrigins.length) {
    console.log(`CORS allowed origins: ${allowedOrigins.join(", ")}`);
  } else {
    console.log("CORS: localhost only (set ALLOWED_ORIGINS to add prod domains)");
  }
});
