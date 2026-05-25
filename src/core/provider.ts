import type {
  AIAnalysis,
  AIAnswer,
  CompanyProfile,
  Financials,
  History,
  HistoryRange,
  MarketBriefing,
  Multiples,
  NewsItem,
  Period,
  QualityScores,
  Quote,
  SearchResult,
  Ticker,
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
}

export class ProviderError extends Error {
  status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = "ProviderError";
    this.status = status;
  }
}
