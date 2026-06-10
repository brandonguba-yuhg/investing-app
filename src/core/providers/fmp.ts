import { ProviderError, type FinancialDataProvider } from "../provider";
import type {
  AIAnalysis,
  AIAnswer,
  BalanceSheet,
  CashFlowStatement,
  CompanyProfile,
  DividendInfo,
  Financials,
  History,
  HistoryRange,
  IncomeStatement,
  InvestorProfile,
  MarketBriefing,
  Multiples,
  NewsItem,
  Period,
  PortfolioPosition,
  PositionAnalysis,
  QualityScores,
  Quote,
  SearchResult,
  Ticker,
  UpcomingEvents,
} from "../types";

const BASE = "https://financialmodelingprep.com/stable";

export class FmpProvider implements FinancialDataProvider {
  private readonly apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  private async fetchJson<T>(path: string, params: Record<string, string> = {}): Promise<T> {
    const url = new URL(`${BASE}${path}`);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    url.searchParams.set("apikey", this.apiKey);

    const res = await fetch(url.toString());
    if (!res.ok) {
      let detail = res.statusText;
      try {
        const body = await res.text();
        if (body) detail = `${detail} — ${body.slice(0, 200)}`;
      } catch {
        // ignore
      }
      throw new ProviderError(`FMP request failed (${res.status}): ${detail}`, res.status);
    }
    return (await res.json()) as T;
  }

  async search(query: string): Promise<SearchResult[]> {
    type Raw = {
      symbol: string;
      name: string;
      exchange?: string;
      currency?: string;
    };
    const [bySymbol, byName] = await Promise.all([
      this.fetchJson<Raw[]>("/search-symbol", { query, limit: "10" }).catch(() => [] as Raw[]),
      this.fetchJson<Raw[]>("/search-name", { query, limit: "10" }).catch(() => [] as Raw[]),
    ]);
    const seen = new Set<string>();
    const merged: SearchResult[] = [];
    for (const r of [...bySymbol, ...byName]) {
      const key = `${r.symbol}|${r.exchange ?? ""}`;
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push({
        symbol: r.symbol,
        name: r.name,
        exchange: r.exchange,
        currency: r.currency,
      });
      if (merged.length >= 10) break;
    }
    return merged;
  }

  async getProfile(symbol: Ticker): Promise<CompanyProfile> {
    const raw = await this.fetchJson<Array<{
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
    if (!raw || raw.length === 0) {
      throw new ProviderError(`No profile found for ${symbol}`, 404);
    }
    const p = raw[0];
    const employees =
      typeof p.fullTimeEmployees === "string"
        ? Number(p.fullTimeEmployees)
        : p.fullTimeEmployees;
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
      employees: Number.isFinite(employees) ? employees : undefined,
      marketCap: p.marketCap,
      price: p.price,
      currency: p.currency,
    };
  }

  async getQuote(symbol: Ticker): Promise<Quote> {
    const raw = await this.fetchJson<Array<{
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
    if (!raw || raw.length === 0) {
      throw new ProviderError(`No quote found for ${symbol}`, 404);
    }
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

  async getHistory(_symbol: Ticker, _range: HistoryRange): Promise<History> {
    throw new ProviderError(
      "Price history is not implemented for the FMP provider. Use the backend (HttpProvider) for charts.",
      501,
    );
  }

  async getNews(_symbol: Ticker, _limit?: number): Promise<NewsItem[]> {
    // Not exposed on FMP free tier; degrade silently.
    return [];
  }

  async getScores(_symbol: Ticker): Promise<QualityScores> {
    // Quality scores are computed by the backend; FMP path is unsupported.
    return { unavailable: true };
  }

  async getAnalysis(_symbol: Ticker): Promise<AIAnalysis> {
    throw new ProviderError("AI analysis requires the backend provider.", 501);
  }

  async ask(_symbol: Ticker, _question: string): Promise<AIAnswer> {
    throw new ProviderError("AI Q&A requires the backend provider.", 501);
  }

  async getBriefing(): Promise<MarketBriefing> {
    throw new ProviderError("Market briefing requires the backend provider.", 501);
  }

  async getUpcomingEvents(_watchlist?: Ticker[]): Promise<UpcomingEvents> {
    throw new ProviderError("Upcoming events require the backend provider.", 501);
  }

  async getPositionAnalysis(
    _symbol: Ticker,
    _portfolio: PortfolioPosition[],
    _profile: InvestorProfile | null,
  ): Promise<PositionAnalysis> {
    throw new ProviderError("Position analysis requires the backend provider.", 501);
  }

  async getDividends(_symbol: Ticker): Promise<DividendInfo> {
    throw new ProviderError("Dividend data requires the backend provider.", 501);
  }

  async getMultiples(symbol: Ticker): Promise<Multiples> {
    const [keyMetrics, ratios] = await Promise.all([
      this.fetchJson<KeyMetricsTtmRaw[]>("/key-metrics-ttm", { symbol }),
      this.fetchJson<RatiosTtmRaw[]>("/ratios-ttm", { symbol }),
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

  async getFinancials(symbol: Ticker, period: Period, limit = 5): Promise<Financials> {
    const params = { symbol, limit: String(limit), period };
    const [incomeRaw, balanceRaw, cashRaw] = await Promise.all([
      this.fetchJson<IncomeRaw[]>("/income-statement", params),
      this.fetchJson<BalanceRaw[]>("/balance-sheet-statement", params),
      this.fetchJson<CashRaw[]>("/cash-flow-statement", params),
    ]);

    const income: IncomeStatement[] = incomeRaw.map((r) => ({
      date: r.date,
      period,
      revenue: r.revenue,
      costOfRevenue: r.costOfRevenue,
      grossProfit: r.grossProfit,
      operatingIncome: r.operatingIncome,
      netIncome: r.netIncome,
      eps: r.eps,
    }));
    const balance: BalanceSheet[] = balanceRaw.map((r) => ({
      date: r.date,
      period,
      totalAssets: r.totalAssets,
      totalLiabilities: r.totalLiabilities,
      totalEquity: r.totalStockholdersEquity,
      cash: r.cashAndCashEquivalents,
      totalDebt: r.totalDebt,
    }));
    const cashFlow: CashFlowStatement[] = cashRaw.map((r) => ({
      date: r.date,
      period,
      operatingCashFlow: r.netCashProvidedByOperatingActivities ?? r.operatingCashFlow,
      investingCashFlow: r.netCashProvidedByInvestingActivities,
      financingCashFlow: r.netCashProvidedByFinancingActivities,
      freeCashFlow: r.freeCashFlow,
    }));

    return { income, balance, cashFlow };
  }
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
