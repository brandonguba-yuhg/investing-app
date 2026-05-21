import cors from "cors";
import express, { type NextFunction, type Request, type Response } from "express";
import { cache, TTL } from "./cache.js";
import * as yahoo from "./yahoo.js";

const app = express();
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
  res.json({ ok: true, cached: cache.size(), time: new Date().toISOString() });
});

app.get("/api/search", async (req, res, next) => {
  try {
    const q = String(req.query.q ?? "").trim();
    if (!q) return res.json([]);
    const out = await cache.wrap(`search:${q.toLowerCase()}`, TTL.search, () =>
      yahoo.search(q),
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
      yahoo.getProfile(symbol),
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
      yahoo.getQuote(symbol),
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
      () => yahoo.getFinancials(symbol, period, limit),
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
      yahoo.getNews(symbol, limit),
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
      yahoo.getHistory(symbol, range),
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
      yahoo.getMultiples(symbol),
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
