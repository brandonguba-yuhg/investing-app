// Financial Modeling Prep client — used as a fallback when Yahoo is blocked
// (Yahoo's quote/quoteSummary/search/chart endpoints reject Railway's
// datacenter IP). FMP is an official keyed API and works from datacenters.
//
// Free tier endpoints (/stable/*). No price-history or news on the free tier,
// so getHistory/getNews are intentionally absent — those stay Yahoo-only.

import type {
  BalanceSheet,
  CashFlowStatement,
  CompanyProfile,
  Financials,
  IncomeStatement,
  Multiples,
  Period,
  Quote,
  SearchResult,
  Ticker,
} from "./types.js";

const BASE = "https://financialmodelingprep.com/stable";

export function fmpEnabled(): boolean {
  return Boolean(process.env.FMP_API_KEY);
}

async function fetchJson<T>(path: string, params: Record<string, string> = {}): Promise<T> {
  const key = process.env.FMP_API_KEY;
  if (!key) throw new Error("FMP_API_KEY is not set");
  const url = new URL(`${BASE}${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  url.searchParams.set("apikey", key);

  const res = await fetch(url.toString());
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = await res.text();
      if (body) detail = `${detail} — ${body.slice(0, 160)}`;
    } catch {
      // ignore
    }
    throw new Error(`FMP request failed (${res.status}): ${detail}`);
  }
  return (await res.json()) as T;
}

export async function search(query: string): Promise<SearchResult[]> {
  type Raw = { symbol: string; name: string; exchange?: string; currency?: string };
  const [bySymbol, byName] = await Promise.all([
    fetchJson<Raw[]>("/search-symbol", { query, limit: "10" }).catch(() => [] as Raw[]),
    fetchJson<Raw[]>("/search-name", { query, limit: "10" }).catch(() => [] as Raw[]),
  ]);
  const seen = new Set<string>();
  const merged: SearchResult[] = [];
  for (const r of [...bySymbol, ...byName]) {
    const k = `${r.symbol}|${r.exchange ?? ""}`;
    if (seen.has(k)) continue;
    seen.add(k);
    merged.push({ symbol: r.symbol, name: r.name, exchange: r.exchange, currency: r.currency });
    if (merged.length >= 10) break;
  }
  if (merged.length === 0) throw new Error(`FMP returned no search results for "${query}"`);
  return merged;
}

export async function getProfile(symbol: Ticker): Promise<CompanyProfile> {
  const raw = await fetchJson<Array<{
    symbol: string;
    companyName: string;
    exchange?: string;
    industry?: string;
    sector?: string;
    description?: string;
    ceo?: string;
    website?: string;
    country?: string;
    fullTimeEmployees?: number | string;
    marketCap?: number;
    price?: number;
    currency?: string;
  }>>("/profile", { symbol });
  if (!raw || raw.length === 0) throw new Error(`FMP: no profile for ${symbol}`);
  const p = raw[0];
  const employees =
    typeof p.fullTimeEmployees === "string" ? Number(p.fullTimeEmployees) : p.fullTimeEmployees;
  return {
    symbol: p.symbol,
    name: p.companyName,
    exchange: p.exchange,
    industry: p.industry,
    sector: p.sector,
    description: p.description,
    ceo: p.ceo,
    website: p.website,
    country: p.country,
    employees: Number.isFinite(employees) ? (employees as number) : undefined,
    marketCap: p.marketCap,
    price: p.price,
    currency: p.currency,
  };
}

export async function getQuote(symbol: Ticker): Promise<Quote> {
  const raw = await fetchJson<Array<{
    symbol: string;
    price: number;
    change: number;
    changePercentage: number;
    dayLow?: number;
    dayHigh?: number;
    yearLow?: number;
    yearHigh?: number;
    volume?: number;
    marketCap?: number;
  }>>("/quote", { symbol });
  if (!raw || raw.length === 0) throw new Error(`FMP: no quote for ${symbol}`);
  const q = raw[0];
  return {
    symbol: q.symbol,
    price: q.price,
    change: q.change,
    changePercent: q.changePercentage,
    dayLow: q.dayLow,
    dayHigh: q.dayHigh,
    yearLow: q.yearLow,
    yearHigh: q.yearHigh,
    volume: q.volume,
    marketCap: q.marketCap,
  };
}

export async function getFinancials(
  symbol: Ticker,
  period: Period,
  limit = 5,
): Promise<Financials> {
  const params = { symbol, limit: String(limit), period };
  const [incomeRaw, balanceRaw, cashRaw] = await Promise.all([
    fetchJson<IncomeRaw[]>("/income-statement", params),
    fetchJson<BalanceRaw[]>("/balance-sheet-statement", params),
    fetchJson<CashRaw[]>("/cash-flow-statement", params),
  ]);

  const income: IncomeStatement[] = (incomeRaw ?? []).map((r) => ({
    date: r.date,
    period,
    revenue: r.revenue,
    costOfRevenue: r.costOfRevenue,
    grossProfit: r.grossProfit,
    operatingIncome: r.operatingIncome,
    netIncome: r.netIncome,
    eps: r.eps,
  }));
  const balance: BalanceSheet[] = (balanceRaw ?? []).map((r) => ({
    date: r.date,
    period,
    totalAssets: r.totalAssets,
    totalLiabilities: r.totalLiabilities,
    totalEquity: r.totalStockholdersEquity,
    cash: r.cashAndCashEquivalents,
    totalDebt: r.totalDebt,
  }));
  const cashFlow: CashFlowStatement[] = (cashRaw ?? []).map((r) => ({
    date: r.date,
    period,
    operatingCashFlow: r.netCashProvidedByOperatingActivities ?? r.operatingCashFlow ?? 0,
    investingCashFlow: r.netCashProvidedByInvestingActivities,
    financingCashFlow: r.netCashProvidedByFinancingActivities,
    freeCashFlow: r.freeCashFlow,
  }));

  if (income.length === 0 && balance.length === 0) {
    throw new Error(`FMP: no financials for ${symbol}`);
  }
  return { income, balance, cashFlow };
}

export async function getMultiples(symbol: Ticker): Promise<Multiples> {
  const [keyMetrics, ratios] = await Promise.all([
    fetchJson<KeyMetricsTtmRaw[]>("/key-metrics-ttm", { symbol }),
    fetchJson<RatiosTtmRaw[]>("/ratios-ttm", { symbol }),
  ]);
  const km = keyMetrics?.[0] ?? ({} as KeyMetricsTtmRaw);
  const r = ratios?.[0] ?? ({} as RatiosTtmRaw);
  return {
    marketCap: km.marketCap,
    enterpriseValue: km.enterpriseValueTTM,
    pe: r.priceToEarningsRatioTTM,
    pegRatio: r.priceToEarningsGrowthRatioTTM,
    ps: r.priceToSalesRatioTTM,
    pb: r.priceToBookRatioTTM,
    pfcf: r.priceToFreeCashFlowRatioTTM,
    pocf: r.priceToOperatingCashFlowRatioTTM,
    evToEbitda: km.evToEBITDATTM,
    evToSales: km.evToSalesTTM,
    evToFcf: km.evToFreeCashFlowTTM,
    earningsYield: km.earningsYieldTTM,
    fcfYield: km.freeCashFlowYieldTTM,
    dividendYield: r.dividendYieldTTM,
    grossMargin: r.grossProfitMarginTTM,
    operatingMargin: r.operatingProfitMarginTTM,
    netMargin: r.netProfitMarginTTM,
    ebitdaMargin: r.ebitdaMarginTTM,
    roa: km.returnOnAssetsTTM,
    roe: km.returnOnEquityTTM,
    roic: km.returnOnInvestedCapitalTTM,
    debtToEquity: r.debtToEquityRatioTTM,
    currentRatio: r.currentRatioTTM ?? km.currentRatioTTM,
    quickRatio: r.quickRatioTTM,
    interestCoverage: r.interestCoverageRatioTTM,
    payoutRatio: r.dividendPayoutRatioTTM,
  };
}

interface IncomeRaw {
  date: string;
  revenue: number;
  costOfRevenue: number;
  grossProfit: number;
  operatingIncome: number;
  netIncome: number;
  eps: number;
}
interface BalanceRaw {
  date: string;
  totalAssets: number;
  totalLiabilities: number;
  totalStockholdersEquity: number;
  cashAndCashEquivalents: number;
  totalDebt: number;
}
interface CashRaw {
  date: string;
  netCashProvidedByOperatingActivities: number;
  netCashProvidedByInvestingActivities: number;
  netCashProvidedByFinancingActivities: number;
  operatingCashFlow?: number;
  freeCashFlow: number;
}
interface KeyMetricsTtmRaw {
  marketCap?: number;
  enterpriseValueTTM?: number;
  evToSalesTTM?: number;
  evToEBITDATTM?: number;
  evToFreeCashFlowTTM?: number;
  earningsYieldTTM?: number;
  freeCashFlowYieldTTM?: number;
  returnOnAssetsTTM?: number;
  returnOnEquityTTM?: number;
  returnOnInvestedCapitalTTM?: number;
  currentRatioTTM?: number;
}
interface RatiosTtmRaw {
  priceToEarningsRatioTTM?: number;
  priceToEarningsGrowthRatioTTM?: number;
  priceToBookRatioTTM?: number;
  priceToSalesRatioTTM?: number;
  priceToFreeCashFlowRatioTTM?: number;
  priceToOperatingCashFlowRatioTTM?: number;
  grossProfitMarginTTM?: number;
  operatingProfitMarginTTM?: number;
  netProfitMarginTTM?: number;
  ebitdaMarginTTM?: number;
  debtToEquityRatioTTM?: number;
  currentRatioTTM?: number;
  quickRatioTTM?: number;
  interestCoverageRatioTTM?: number;
  dividendYieldTTM?: number;
  dividendPayoutRatioTTM?: number;
}
