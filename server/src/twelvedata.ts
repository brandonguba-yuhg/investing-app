// Twelve Data client — third data source in the chain, after Yahoo and FMP.
// Why it exists: Yahoo blocks Railway's datacenter IP entirely, and FMP's free
// tier only serves a whitelist of popular symbols (MU, ORCL, CRM... return 402).
// Twelve Data's free tier works from datacenters and covers all US symbols for
// quote/profile/search/time_series — it's what makes arbitrary tickers load in
// production. Fundamentals/statements are NOT on its free tier, so financials,
// multiples, and scores stay with Yahoo/FMP.
//
// Free-tier limits: 8 credits/min, 800/day. The server-side TTL cache keeps us
// well under except on cold bursts (a throttled call returns code 429 in the
// JSON envelope and we surface it as an error like any other source failure).

import type {
  CompanyProfile,
  History,
  HistoryRange,
  Quote,
  SearchResult,
  Ticker,
} from "./types.js";

const BASE = "https://api.twelvedata.com";

export function tdEnabled(): boolean {
  return Boolean(process.env.TWELVE_DATA_API_KEY);
}

// Twelve Data signals errors as HTTP 200 with {status:"error", code, message}.
async function fetchJson<T>(path: string, params: Record<string, string>): Promise<T> {
  const key = process.env.TWELVE_DATA_API_KEY;
  if (!key) throw new Error("TWELVE_DATA_API_KEY is not set");
  const url = new URL(`${BASE}${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  url.searchParams.set("apikey", key);

  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`Twelve Data request failed (${res.status}): ${res.statusText}`);
  const body = (await res.json()) as T & { status?: string; code?: number; message?: string };
  if (body && typeof body === "object" && body.status === "error") {
    throw new Error(`Twelve Data error (${body.code ?? "?"}): ${body.message ?? "unknown"}`);
  }
  return body;
}

function num(v: unknown): number | undefined {
  const n = typeof v === "string" ? Number(v) : typeof v === "number" ? v : NaN;
  return Number.isFinite(n) ? n : undefined;
}

// ---------- search ----------

export async function search(query: string): Promise<SearchResult[]> {
  const res = await fetchJson<{
    data?: Array<{
      symbol?: string;
      instrument_name?: string;
      exchange?: string;
      country?: string;
      currency?: string;
      instrument_type?: string;
    }>;
  }>("/symbol_search", { symbol: query, outputsize: "30" });

  const rows = res.data ?? [];
  // US listings first — that's what this app is about — then everything else.
  const ranked = [...rows].sort((a, b) => {
    const aUs = a.country === "United States" ? 0 : 1;
    const bUs = b.country === "United States" ? 0 : 1;
    return aUs - bUs;
  });
  const out = ranked.slice(0, 10).map((r) => ({
    symbol: r.symbol ?? "",
    name: r.instrument_name ?? r.symbol ?? "",
    exchange: r.exchange,
    currency: r.currency,
  })).filter((r) => r.symbol);
  if (out.length === 0) throw new Error(`Twelve Data returned no search results for "${query}"`);
  return out;
}

// ---------- quote ----------

interface TdQuoteRaw {
  symbol?: string;
  name?: string;
  exchange?: string;
  currency?: string;
  close?: string;
  change?: string;
  percent_change?: string;
  low?: string;
  high?: string;
  volume?: string;
  fifty_two_week?: { low?: string; high?: string };
}

async function fetchQuoteRaw(symbol: Ticker): Promise<TdQuoteRaw> {
  return fetchJson<TdQuoteRaw>("/quote", { symbol });
}

export async function getQuote(symbol: Ticker): Promise<Quote> {
  const q = await fetchQuoteRaw(symbol);
  const price = num(q.close);
  if (price == null) throw new Error(`Twelve Data: no quote for ${symbol}`);
  return {
    symbol,
    price,
    change: num(q.change) ?? 0,
    changePercent: num(q.percent_change) ?? 0,
    dayLow: num(q.low),
    dayHigh: num(q.high),
    yearLow: num(q.fifty_two_week?.low),
    yearHigh: num(q.fifty_two_week?.high),
    volume: num(q.volume),
    // Twelve Data's free quote has no market cap (that's in /statistics, paid).
    marketCap: undefined,
  };
}

// ---------- profile ----------

export async function getProfile(symbol: Ticker): Promise<CompanyProfile> {
  try {
    const p = await fetchJson<{
      symbol?: string;
      name?: string;
      exchange?: string;
      sector?: string;
      industry?: string;
      employees?: number;
      website?: string;
      description?: string;
      type?: string;
      CEO?: string;
      address?: string;
      city?: string;
      country?: string;
    }>("/profile", { symbol });
    if (!p?.name) throw new Error(`Twelve Data: empty profile for ${symbol}`);
    return {
      symbol,
      name: p.name,
      exchange: p.exchange,
      industry: p.industry,
      sector: p.sector,
      description: p.description,
      ceo: p.CEO,
      website: p.website,
      country: p.country,
      employees: num(p.employees),
    };
  } catch {
    // /profile may be plan-gated; the quote still carries name/exchange/currency,
    // which is enough for the company header to render.
    const q = await fetchQuoteRaw(symbol);
    if (!q?.name) throw new Error(`Twelve Data: no profile or quote for ${symbol}`);
    return {
      symbol,
      name: q.name,
      exchange: q.exchange,
      currency: q.currency,
      price: num(q.close),
    };
  }
}

// ---------- history (price chart) ----------

interface RangeSpec {
  interval: string;
  outputsize: number;
}

// outputsize is in bars: ~78 5-min bars per session, ~21 trading days/month.
const RANGES: Record<HistoryRange, RangeSpec> = {
  "1d": { interval: "5min", outputsize: 80 },
  "1m": { interval: "1day", outputsize: 23 },
  "6m": { interval: "1day", outputsize: 128 },
  "1y": { interval: "1day", outputsize: 254 },
  "5y": { interval: "1week", outputsize: 262 },
};

export async function getHistory(symbol: Ticker, range: HistoryRange): Promise<History> {
  const spec = RANGES[range];
  if (!spec) throw new Error(`Unknown range: ${range}`);

  const res = await fetchJson<{
    meta?: { currency?: string };
    values?: Array<{ datetime?: string; close?: string }>;
  }>("/time_series", {
    symbol,
    interval: spec.interval,
    outputsize: String(spec.outputsize),
    timezone: "UTC",
  });

  // Values arrive newest-first; the chart wants oldest-first.
  const points = (res.values ?? [])
    .map((v) => {
      const close = num(v.close);
      const dt = v.datetime ?? "";
      if (close == null || !dt) return null;
      // Daily bars: "YYYY-MM-DD"; intraday: "YYYY-MM-DD HH:mm:ss" (UTC).
      const iso = dt.includes(" ")
        ? `${dt.replace(" ", "T")}Z`
        : `${dt}T00:00:00.000Z`;
      return { date: new Date(iso).toISOString(), close };
    })
    .filter((p): p is { date: string; close: number } => p !== null)
    .reverse();

  if (points.length === 0) throw new Error(`Twelve Data: no history for ${symbol}`);
  return { range, points, currency: res.meta?.currency };
}
