// Data orchestration: try Yahoo first (free, broad), fall back to FMP when
// Yahoo fails (e.g. its quote/quoteSummary/search/chart endpoints block
// Railway's datacenter IP). FMP has no price-history or news on the free tier,
// so those stay Yahoo-only. Scores rely on Yahoo's fundamentals-timeseries,
// which keeps working even when the other Yahoo endpoints are blocked.

import * as fmp from "./fmp.js";
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

async function withFallback<T>(
  label: string,
  primary: () => Promise<T>,
  fallback: () => Promise<T>,
): Promise<T> {
  try {
    return await primary();
  } catch (primaryErr) {
    if (!fmp.fmpEnabled()) throw primaryErr;
    try {
      const result = await fallback();
      console.warn(`[data] ${label}: Yahoo failed, served from FMP fallback`);
      return result;
    } catch (fallbackErr) {
      const pm = primaryErr instanceof Error ? primaryErr.message : String(primaryErr);
      const fm = fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr);
      throw new Error(`Both sources failed — Yahoo: ${pm}; FMP: ${fm}`);
    }
  }
}

export function search(query: string): Promise<SearchResult[]> {
  return withFallback("search", () => yahoo.search(query), () => fmp.search(query));
}

export function getProfile(symbol: Ticker): Promise<CompanyProfile> {
  return withFallback("profile", () => yahoo.getProfile(symbol), () => fmp.getProfile(symbol));
}

export function getQuote(symbol: Ticker): Promise<Quote> {
  return withFallback("quote", () => yahoo.getQuote(symbol), () => fmp.getQuote(symbol));
}

export function getFinancials(symbol: Ticker, period: Period, limit = 5): Promise<Financials> {
  return withFallback(
    "financials",
    () => yahoo.getFinancials(symbol, period, limit),
    () => fmp.getFinancials(symbol, period, limit),
  );
}

export function getMultiples(symbol: Ticker): Promise<Multiples> {
  return withFallback("multiples", () => yahoo.getMultiples(symbol), () => fmp.getMultiples(symbol));
}

// Yahoo-only (no FMP free-tier equivalent / Yahoo path still works):
export function getHistory(symbol: Ticker, range: HistoryRange): Promise<History> {
  return yahoo.getHistory(symbol, range);
}
export function getNews(symbol: Ticker, limit = 10): Promise<NewsItem[]> {
  return yahoo.getNews(symbol, limit);
}
export function getScores(symbol: Ticker): Promise<QualityScores> {
  return yahoo.getScores(symbol);
}
