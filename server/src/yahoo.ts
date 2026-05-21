import YahooFinance from "yahoo-finance2";
import type {
  BalanceSheet,
  CashFlowStatement,
  CompanyProfile,
  Financials,
  History,
  HistoryRange,
  Multiples,
  NewsItem,
  Period,
  Quote,
  SearchResult,
  Ticker,
} from "../../src/core/types.js";

// v3 default export is the YahooFinance class; instantiate to use modules.
// The library's TypeScript types are strict and don't match the loose shapes
// we want to handle defensively, so we type-erase here.
interface YfClient {
  search(query: string, opts?: { quotesCount?: number; newsCount?: number }): Promise<{
    quotes: Array<Record<string, unknown>>;
    news?: Array<Record<string, unknown>>;
  }>;
  quote(symbol: string): Promise<Record<string, unknown>>;
  quoteSummary(symbol: string, opts: { modules: readonly string[] }): Promise<Record<string, unknown>>;
  fundamentalsTimeSeries(
    symbol: string,
    opts: { period1: string; module: string; type: "annual" | "quarterly" | "trailing" },
  ): Promise<Array<Record<string, unknown>>>;
  chart(
    symbol: string,
    opts: { period1: Date | string; period2?: Date | string; interval: string },
  ): Promise<{
    meta?: { currency?: string };
    quotes: Array<{ date: Date | string; close: number | null }>;
  }>;
}

const yf = new YahooFinance({ suppressNotices: ["yahooSurvey", "ripHistorical"] }) as unknown as YfClient;

/** Coerce numeric fields that yahoo-finance2 may type loosely. */
function num(v: unknown): number | undefined {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (v && typeof v === "object" && "raw" in v) {
    const r = (v as { raw: unknown }).raw;
    if (typeof r === "number" && Number.isFinite(r)) return r;
  }
  return undefined;
}

function dateString(v: unknown): string {
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "string") return v.slice(0, 10);
  if (typeof v === "number") return new Date(v * 1000).toISOString().slice(0, 10);
  return "";
}

function isoTimestamp(v: unknown): string {
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "string") return v;
  if (typeof v === "number") {
    // Yahoo gives seconds for some fields; treat values < 1e12 as seconds.
    const ms = v < 1e12 ? v * 1000 : v;
    return new Date(ms).toISOString();
  }
  return "";
}

// ---------- search ----------

export async function search(query: string): Promise<SearchResult[]> {
  const res = await yf.search(query, { quotesCount: 10, newsCount: 0 });
  const allowed = new Set(["EQUITY", "ETF", "MUTUALFUND", "INDEX"]);
  const out: SearchResult[] = [];
  for (const q of res.quotes ?? []) {
    const symbol = q.symbol as string | undefined;
    const quoteType = q.quoteType as string | undefined;
    if (!symbol || !allowed.has(String(quoteType))) continue;
    out.push({
      symbol,
      name:
        (q.longname as string | undefined) ??
        (q.shortname as string | undefined) ??
        symbol,
      exchange: q.exchange as string | undefined,
    });
  }
  return out;
}

// ---------- profile ----------

export async function getProfile(symbol: Ticker): Promise<CompanyProfile> {
  const summary = await yf.quoteSummary(symbol, {
    modules: ["assetProfile", "summaryProfile", "price"],
  });
  const ap = (summary.assetProfile ?? summary.summaryProfile ?? {}) as Record<string, unknown>;
  const price = (summary.price ?? {}) as Record<string, unknown>;
  return {
    symbol,
    name:
      (price.longName as string | undefined) ??
      (price.shortName as string | undefined) ??
      symbol,
    exchange: price.exchangeName as string | undefined,
    industry: ap.industry as string | undefined,
    sector: ap.sector as string | undefined,
    description: ap.longBusinessSummary as string | undefined,
    ceo: extractCeo(ap.companyOfficers),
    website: ap.website as string | undefined,
    country: ap.country as string | undefined,
    employees: num(ap.fullTimeEmployees),
    marketCap: num(price.marketCap),
    price: num(price.regularMarketPrice),
    currency: price.currency as string | undefined,
  };
}

function extractCeo(officers: unknown): string | undefined {
  if (!Array.isArray(officers)) return undefined;
  const ceo = officers.find((o) => {
    const title = (o?.title as string | undefined) ?? "";
    return /chief executive|ceo/i.test(title);
  });
  return ceo?.name as string | undefined;
}

// ---------- quote ----------

export async function getQuote(symbol: Ticker): Promise<Quote> {
  const q = await yf.quote(symbol);
  return {
    symbol,
    price: num(q.regularMarketPrice) ?? 0,
    change: num(q.regularMarketChange) ?? 0,
    changePercent: num(q.regularMarketChangePercent) ?? 0,
    dayLow: num(q.regularMarketDayLow),
    dayHigh: num(q.regularMarketDayHigh),
    yearLow: num(q.fiftyTwoWeekLow),
    yearHigh: num(q.fiftyTwoWeekHigh),
    volume: num(q.regularMarketVolume),
    marketCap: num(q.marketCap),
  };
}

// ---------- financials ----------

type Row = Record<string, unknown>;

/**
 * Yahoo deprecated the per-statement quoteSummary modules in Nov 2024.
 * We now use `fundamentalsTimeSeries` which returns one wide record per period
 * containing income + balance + cashflow fields merged.
 */
export async function getFinancials(
  symbol: Ticker,
  period: Period,
  limit = 5,
): Promise<Financials> {
  // Request ~6 years/quarters of history so we have headroom over `limit`.
  const yearsBack = period === "annual" ? 6 : 2;
  const period1 = new Date(Date.now() - yearsBack * 365 * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
  const type = period === "annual" ? "annual" : "quarterly";

  const rows = await yf.fundamentalsTimeSeries(symbol, {
    period1,
    module: "all",
    type,
  });

  // newest first
  const sorted = [...rows].sort((a, b) => {
    return new Date(b.date as string).getTime() - new Date(a.date as string).getTime();
  });
  const trimmed = sorted.slice(0, limit);

  const income = trimmed.map((r) => mapIncome(r, period));
  const balance = trimmed.map((r) => mapBalance(r, period));
  const cashFlow = trimmed.map((r) => mapCash(r, period));

  return { income, balance, cashFlow };
}

function mapIncome(r: Row, period: Period) {
  const revenue = num(r.totalRevenue) ?? num(r.operatingRevenue) ?? 0;
  const costOfRevenue = num(r.costOfRevenue) ?? num(r.reconciledCostOfRevenue) ?? 0;
  const grossProfit = num(r.grossProfit) ?? revenue - costOfRevenue;
  const operatingIncome =
    num(r.operatingIncome) ??
    num(r.totalOperatingIncomeAsReported) ??
    num(r.EBIT) ??
    0;
  const netIncome =
    num(r.netIncome) ?? num(r.netIncomeCommonStockholders) ?? 0;
  const eps = num(r.dilutedEPS) ?? num(r.basicEPS) ?? Number.NaN;
  return {
    date: dateString(r.date),
    period,
    revenue,
    costOfRevenue,
    grossProfit,
    operatingIncome,
    netIncome,
    eps,
  };
}

function mapBalance(r: Row, period: Period): BalanceSheet {
  const totalAssets = num(r.totalAssets) ?? 0;
  const totalLiabilities =
    num(r.totalLiabilitiesNetMinorityInterest) ?? 0;
  const totalEquity =
    num(r.stockholdersEquity) ??
    num(r.commonStockEquity) ??
    num(r.totalEquityGrossMinorityInterest) ??
    totalAssets - totalLiabilities;
  return {
    date: dateString(r.date),
    period,
    totalAssets,
    totalLiabilities,
    totalEquity,
    cash:
      num(r.cashAndCashEquivalents) ??
      num(r.cashCashEquivalentsAndShortTermInvestments) ??
      0,
    totalDebt: num(r.totalDebt) ?? 0,
  };
}

function mapCash(r: Row, period: Period): CashFlowStatement {
  const operating =
    num(r.operatingCashFlow) ??
    num(r.cashFlowFromContinuingOperatingActivities) ??
    0;
  const investing =
    num(r.investingCashFlow) ??
    num(r.cashFlowFromContinuingInvestingActivities) ??
    0;
  const financing =
    num(r.financingCashFlow) ??
    num(r.cashFlowFromContinuingFinancingActivities) ??
    0;
  const fcf =
    num(r.freeCashFlow) ??
    operating + (num(r.capitalExpenditure) ?? 0); // capex is negative
  return {
    date: dateString(r.date),
    period,
    operatingCashFlow: operating,
    investingCashFlow: investing,
    financingCashFlow: financing,
    freeCashFlow: fcf,
  };
}

// ---------- news ----------

export async function getNews(symbol: Ticker, limit = 10): Promise<NewsItem[]> {
  const res = await yf.search(symbol, { newsCount: limit, quotesCount: 0 });
  const items = res.news ?? [];
  return items.slice(0, limit).map((n) => {
    const thumbs = (n.thumbnail as { resolutions?: Array<{ url?: string; width?: number }> } | undefined)
      ?.resolutions;
    // Prefer a small (square) thumbnail when available.
    const thumb = pickThumbnail(thumbs);
    return {
      id: String(n.uuid ?? n.link ?? n.title ?? Math.random()),
      title: String(n.title ?? ""),
      publisher: String(n.publisher ?? ""),
      link: String(n.link ?? ""),
      publishedAt: isoTimestamp(n.providerPublishTime),
      thumbnail: thumb,
    };
  });
}

function pickThumbnail(
  resolutions?: Array<{ url?: string; width?: number }>,
): string | undefined {
  if (!resolutions || resolutions.length === 0) return undefined;
  // Pick the smallest resolution >= 140px, else the smallest available.
  const sorted = [...resolutions].sort(
    (a, b) => (a.width ?? 9999) - (b.width ?? 9999),
  );
  const small = sorted.find((r) => (r.width ?? 0) >= 140) ?? sorted[0];
  return small.url;
}

// ---------- history (price chart) ----------

interface RangeSpec {
  days: number;
  interval: string;
}

const RANGES: Record<HistoryRange, RangeSpec> = {
  "1d": { days: 1, interval: "5m" },
  "1m": { days: 31, interval: "1d" },
  "6m": { days: 186, interval: "1d" },
  "1y": { days: 366, interval: "1d" },
  "5y": { days: 5 * 366, interval: "1wk" },
};

export async function getHistory(symbol: Ticker, range: HistoryRange): Promise<History> {
  const spec = RANGES[range];
  if (!spec) throw new Error(`Unknown range: ${range}`);

  const period1 = new Date(Date.now() - spec.days * 24 * 60 * 60 * 1000);
  const res = await yf.chart(symbol, { period1, interval: spec.interval });

  const points = (res.quotes ?? [])
    .filter((q) => q.close != null && Number.isFinite(q.close))
    .map((q) => ({
      date: q.date instanceof Date ? q.date.toISOString() : String(q.date),
      close: q.close as number,
    }));

  return {
    range,
    points,
    currency: res.meta?.currency,
  };
}

// ---------- multiples ----------

export async function getMultiples(symbol: Ticker): Promise<Multiples> {
  // Fetch the TTM modules and the latest annual fundamentals in parallel.
  // The fundamentals give us EBIT, tax rate, invested capital, and (sometimes)
  // interest expense — fields we use to compute ROIC and Interest Coverage,
  // neither of which Yahoo exposes as a precomputed TTM ratio.
  const period1 = new Date(Date.now() - 2 * 365 * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);

  const [summary, fundamentalsRows] = await Promise.all([
    yf.quoteSummary(symbol, {
      modules: ["defaultKeyStatistics", "summaryDetail", "financialData", "price"],
    }),
    yf
      .fundamentalsTimeSeries(symbol, { period1, module: "all", type: "annual" })
      .catch(() => [] as Array<Record<string, unknown>>),
  ]);
  const ks = (summary.defaultKeyStatistics ?? {}) as Row;
  const sd = (summary.summaryDetail ?? {}) as Row;
  const fd = (summary.financialData ?? {}) as Row;
  const pr = (summary.price ?? {}) as Row;

  const trailingPE = num(sd.trailingPE) ?? num(ks.trailingPE);
  const pegRatio = num(ks.pegRatio) ?? num(ks.trailingPegRatio);
  const priceToBook = num(ks.priceToBook);
  const priceToSales = num(sd.priceToSalesTrailing12Months);
  const evToEbitda = num(ks.enterpriseToEbitda);
  const evToRevenue = num(ks.enterpriseToRevenue);
  const enterpriseValue = num(ks.enterpriseValue);
  const marketCap = num(pr.marketCap) ?? num(sd.marketCap);
  const dividendYield = num(sd.dividendYield) ?? num(sd.trailingAnnualDividendYield);
  const earningsYield = trailingPE && trailingPE !== 0 ? 1 / trailingPE : undefined;

  const freeCashflow = num(fd.freeCashflow);
  const fcfYield = marketCap && freeCashflow ? freeCashflow / marketCap : undefined;
  const pfcf = marketCap && freeCashflow && freeCashflow !== 0 ? marketCap / freeCashflow : undefined;
  const operatingCashflow = num(fd.operatingCashflow);
  const pocf = marketCap && operatingCashflow && operatingCashflow !== 0 ? marketCap / operatingCashflow : undefined;
  const evToFcf = enterpriseValue && freeCashflow && freeCashflow !== 0 ? enterpriseValue / freeCashflow : undefined;

  // Use the most recent annual record for ROIC + interest coverage.
  const latestFund = pickLatestAnnual(fundamentalsRows);
  const roic = computeRoic(latestFund);
  const interestCoverage = computeInterestCoverage(latestFund);

  return {
    marketCap,
    enterpriseValue,

    pe: trailingPE,
    pegRatio,
    ps: priceToSales,
    pb: priceToBook,
    pfcf,
    pocf,
    evToEbitda,
    evToSales: evToRevenue,
    evToFcf,
    earningsYield,
    fcfYield,
    dividendYield,

    grossMargin: num(fd.grossMargins),
    operatingMargin: num(fd.operatingMargins),
    netMargin: num(fd.profitMargins),
    ebitdaMargin: num(fd.ebitdaMargins),
    roa: num(fd.returnOnAssets),
    roe: num(fd.returnOnEquity),
    roic,

    // Yahoo returns debtToEquity as a percentage (e.g. 79.5 = 79.5%);
    // convert to a true ratio to match our formatter.
    debtToEquity: (() => {
      const v = num(fd.debtToEquity);
      return v != null ? v / 100 : undefined;
    })(),
    currentRatio: num(fd.currentRatio),
    quickRatio: num(fd.quickRatio),
    interestCoverage,
    payoutRatio: num(sd.payoutRatio),
  };
}

function pickLatestAnnual(rows: Array<Record<string, unknown>>): Record<string, unknown> {
  if (!rows.length) return {};
  return [...rows].sort((a, b) => {
    return new Date(b.date as string).getTime() - new Date(a.date as string).getTime();
  })[0];
}

/**
 * ROIC = NOPAT / Invested Capital.
 * Prefer Yahoo's `investedCapital` and `taxRateForCalcs` when available.
 * NOPAT = EBIT * (1 - taxRate). Fallback tax rate = taxProvision / pretaxIncome.
 */
function computeRoic(r: Record<string, unknown>): number | undefined {
  const ebit = num(r.EBIT) ?? num(r.operatingIncome);
  if (!ebit) return undefined;

  let taxRate = num(r.taxRateForCalcs);
  if (taxRate == null) {
    const taxProvision = num(r.taxProvision);
    const pretax = num(r.pretaxIncome);
    if (taxProvision != null && pretax && pretax !== 0) {
      taxRate = taxProvision / pretax;
    }
  }
  // Clamp to a sensible range; Yahoo can return weird values around losses.
  if (taxRate == null || !Number.isFinite(taxRate)) taxRate = 0.21;
  taxRate = Math.max(0, Math.min(0.5, taxRate));

  const nopat = ebit * (1 - taxRate);

  let investedCapital = num(r.investedCapital);
  if (!investedCapital) {
    const equity = num(r.stockholdersEquity) ?? num(r.commonStockEquity);
    const debt = num(r.totalDebt);
    if (equity != null && debt != null) investedCapital = equity + debt;
  }
  if (!investedCapital || investedCapital === 0) return undefined;

  return nopat / investedCapital;
}

/**
 * Interest Coverage = EBIT / |Interest Expense|. Yahoo doesn't always expose
 * the field directly, so fall back to `interestExpenseNonOperating`.
 */
function computeInterestCoverage(r: Record<string, unknown>): number | undefined {
  const ebit = num(r.EBIT) ?? num(r.operatingIncome);
  if (!ebit) return undefined;
  const interest =
    num(r.interestExpense) ??
    num(r.interestExpenseNonOperating) ??
    num(r.netInterestIncome);
  if (interest == null || interest === 0) return undefined;
  // Yahoo sometimes reports interest as positive, sometimes negative;
  // we want a positive coverage ratio either way.
  return ebit / Math.abs(interest);
}
