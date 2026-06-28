// Data orchestration across four sources, tried in order:
//
//   1. Yahoo — free, broadest data (fundamentals, news, history). Works locally
//      but its endpoints block Railway's datacenter IP, so in production it
//      usually fails and we fall through.
//   2. FMP — official keyed API, works from datacenters, BUT the free tier only
//      serves a whitelist of popular symbols (others 402) and has no
//      history/news.
//   3. Twelve Data — official keyed API, works from datacenters, covers all US
//      symbols for quote/profile/search/history. No fundamentals on free tier.
//   4. SEC EDGAR — free/keyless, covers every US filer's 10-K/10-Q fundamentals
//      (financials, scores, derived multiples). The backstop for symbols FMP's
//      free tier gates (MU, mid-caps). No prices/quotes/news.
//
// Per-capability chains below pick the sources that can actually serve them.
// Scores are special-cased: Yahoo returns {unavailable:true} instead of
// throwing, so the chain checks the result rather than catching.

import * as fmp from "./fmp.js";
import * as sec from "./sec.js";
import * as td from "./twelvedata.js";
import type {
  CompanyProfile,
  Financials,
  History,
  HistoryRange,
  Multiples,
  NewsItem,
  Period,
  QualityScores,
  Quote,
  SearchResult,
  Ticker,
} from "./types.js";
import * as yahoo from "./yahoo.js";

interface Source<T> {
  name: string;
  enabled: () => boolean;
  load: () => Promise<T>;
}

/** Try each enabled source in order; aggregate errors if all fail. */
async function chain<T>(label: string, sources: Array<Source<T>>): Promise<T> {
  const errors: string[] = [];
  let attempted = 0;
  for (const s of sources) {
    if (!s.enabled()) continue;
    attempted += 1;
    try {
      const result = await s.load();
      // The first attempted source is the expected path; only log fallbacks.
      if (attempted > 1) console.warn(`[data] ${label}: served from ${s.name} fallback`);
      return result;
    } catch (e) {
      errors.push(`${s.name}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  throw new Error(
    errors.length
      ? `All sources failed — ${errors.join("; ")}`
      : `No data source is configured for ${label}`,
  );
}

const always = () => true;

export function search(query: string): Promise<SearchResult[]> {
  return chain("search", [
    { name: "Yahoo", enabled: always, load: () => yahoo.search(query) },
    { name: "FMP", enabled: fmp.fmpEnabled, load: () => fmp.search(query) },
    { name: "TwelveData", enabled: td.tdEnabled, load: () => td.search(query) },
  ]);
}

export function getProfile(symbol: Ticker): Promise<CompanyProfile> {
  return chain("profile", [
    { name: "Yahoo", enabled: always, load: () => yahoo.getProfile(symbol) },
    { name: "FMP", enabled: fmp.fmpEnabled, load: () => fmp.getProfile(symbol) },
    { name: "TwelveData", enabled: td.tdEnabled, load: () => td.getProfile(symbol) },
  ]);
}

export function getQuote(symbol: Ticker): Promise<Quote> {
  return chain("quote", [
    { name: "Yahoo", enabled: always, load: () => yahoo.getQuote(symbol) },
    { name: "FMP", enabled: fmp.fmpEnabled, load: () => fmp.getQuote(symbol) },
    { name: "TwelveData", enabled: td.tdEnabled, load: () => td.getQuote(symbol) },
  ]);
}

export function getFinancials(symbol: Ticker, period: Period, limit = 5): Promise<Financials> {
  return chain("financials", [
    { name: "Yahoo", enabled: always, load: () => yahoo.getFinancials(symbol, period, limit) },
    { name: "FMP", enabled: fmp.fmpEnabled, load: () => fmp.getFinancials(symbol, period, limit) },
    { name: "SEC", enabled: sec.secEnabled, load: () => sec.getFinancials(symbol, period, limit) },
  ]);
}

export async function getMultiples(symbol: Ticker): Promise<Multiples> {
  try {
    return await chain("multiples", [
      { name: "Yahoo", enabled: always, load: () => yahoo.getMultiples(symbol) },
      { name: "FMP", enabled: fmp.fmpEnabled, load: () => fmp.getMultiples(symbol) },
    ]);
  } catch (e) {
    // SEC can derive multiples from the 10-K, but only with a live price (it has
    // none of its own). Pull the price from the quote chain first.
    if (!sec.secEnabled()) throw e;
    const price = await getQuote(symbol)
      .then((q) => q.price)
      .catch(() => undefined);
    console.warn(`[data] multiples: served from SEC fallback`);
    return sec.getMultiples(symbol, price);
  }
}

export function getHistory(symbol: Ticker, range: HistoryRange): Promise<History> {
  return chain("history", [
    { name: "Yahoo", enabled: always, load: () => yahoo.getHistory(symbol, range) },
    { name: "TwelveData", enabled: td.tdEnabled, load: () => td.getHistory(symbol, range) },
  ]);
}

// Yahoo-only: neither FMP free tier nor Twelve Data free tier has news.
export function getNews(symbol: Ticker, limit = 10): Promise<NewsItem[]> {
  return yahoo.getNews(symbol, limit);
}

// Scores: Yahoo signals failure by returning {unavailable:true} (it computes
// from fundamentals that may be missing), so check the result, don't catch.
export async function getScores(symbol: Ticker): Promise<QualityScores> {
  const fromYahoo = await yahoo.getScores(symbol).catch(() => ({ unavailable: true as const }));
  if (!fromYahoo.unavailable) return fromYahoo;
  if (fmp.fmpEnabled()) {
    try {
      const fromFmp = await fmp.getScores(symbol);
      if (!fromFmp.unavailable) {
        console.warn(`[data] scores: served from FMP fallback`);
        return fromFmp;
      }
    } catch {
      // fall through to SEC
    }
  }
  if (sec.secEnabled()) {
    try {
      // SEC has no price of its own; supply one so Altman's market-equity term
      // is populated (otherwise asset-heavy firms look falsely distressed).
      const price = await getQuote(symbol)
        .then((q) => q.price)
        .catch(() => undefined);
      const fromSec = await sec.getScores(symbol, price);
      if (!fromSec.unavailable) {
        console.warn(`[data] scores: served from SEC fallback`);
        return fromSec;
      }
    } catch {
      // fall through to unavailable
    }
  }
  return { unavailable: true };
}
