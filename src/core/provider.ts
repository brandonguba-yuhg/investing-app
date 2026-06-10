import type {
  AIAnalysis,
  AIAnswer,
  CompanyProfile,
  DividendInfo,
  Financials,
  History,
  HistoryRange,
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
} from "./types";

export interface FinancialDataProvider {
  search(query: string): Promise<SearchResult[]>;
  getProfile(symbol: Ticker): Promise<CompanyProfile>;
  getQuote(symbol: Ticker): Promise<Quote>;
  getFinancials(symbol: Ticker, period: Period, limit?: number): Promise<Financials>;
  getMultiples(symbol: Ticker): Promise<Multiples>;
  getHistory(symbol: Ticker, range: HistoryRange): Promise<History>;
  getNews(symbol: Ticker, limit?: number): Promise<NewsItem[]>;
  getScores(symbol: Ticker): Promise<QualityScores>;
  getAnalysis(symbol: Ticker): Promise<AIAnalysis>;
  ask(symbol: Ticker, question: string): Promise<AIAnswer>;
  getBriefing(): Promise<MarketBriefing>;
  getUpcomingEvents(watchlist?: Ticker[]): Promise<UpcomingEvents>;
  getDividends(symbol: Ticker): Promise<DividendInfo>;
  getPositionAnalysis(
    symbol: Ticker,
    portfolio: PortfolioPosition[],
    profile: InvestorProfile | null,
  ): Promise<PositionAnalysis>;
}

export class ProviderError extends Error {
  status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = "ProviderError";
    this.status = status;
  }
}
