import { ProviderError, type FinancialDataProvider } from "../provider";
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
} from "../types";

/**
 * Provider that delegates to our own backend (Express/Yahoo) instead of
 * calling a third-party API directly from the browser. The backend caches
 * and hides any upstream keys.
 */
export class HttpProvider implements FinancialDataProvider {
  private readonly baseUrl: string;

  constructor(baseUrl: string) {
    // Trim trailing slash so we can build paths consistently.
    this.baseUrl = baseUrl.replace(/\/+$/, "");
  }

  private async get<T>(path: string): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`);
    if (!res.ok) {
      let message = res.statusText;
      try {
        const body = (await res.json()) as { error?: string };
        if (body?.error) message = body.error;
      } catch {
        // ignore JSON parse errors
      }
      throw new ProviderError(`Backend ${res.status}: ${message}`, res.status);
    }
    return (await res.json()) as T;
  }

  search(query: string): Promise<SearchResult[]> {
    return this.get<SearchResult[]>(
      `/api/search?q=${encodeURIComponent(query)}`,
    );
  }

  getProfile(symbol: Ticker): Promise<CompanyProfile> {
    return this.get<CompanyProfile>(`/api/profile/${encodeURIComponent(symbol)}`);
  }

  getQuote(symbol: Ticker): Promise<Quote> {
    return this.get<Quote>(`/api/quote/${encodeURIComponent(symbol)}`);
  }

  getFinancials(symbol: Ticker, period: Period, limit = 5): Promise<Financials> {
    return this.get<Financials>(
      `/api/financials/${encodeURIComponent(symbol)}?period=${period}&limit=${limit}`,
    );
  }

  getMultiples(symbol: Ticker): Promise<Multiples> {
    return this.get<Multiples>(`/api/multiples/${encodeURIComponent(symbol)}`);
  }

  getHistory(symbol: Ticker, range: HistoryRange): Promise<History> {
    return this.get<History>(
      `/api/history/${encodeURIComponent(symbol)}?range=${range}`,
    );
  }

  getNews(symbol: Ticker, limit = 10): Promise<NewsItem[]> {
    return this.get<NewsItem[]>(
      `/api/news/${encodeURIComponent(symbol)}?limit=${limit}`,
    );
  }

  getScores(symbol: Ticker): Promise<QualityScores> {
    return this.get<QualityScores>(`/api/scores/${encodeURIComponent(symbol)}`);
  }

  getAnalysis(symbol: Ticker): Promise<AIAnalysis> {
    return this.get<AIAnalysis>(`/api/analysis/${encodeURIComponent(symbol)}`);
  }

  async ask(symbol: Ticker, question: string): Promise<AIAnswer> {
    const res = await fetch(`${this.baseUrl}/api/ask/${encodeURIComponent(symbol)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question }),
    });
    if (!res.ok) {
      let message = res.statusText;
      try {
        const body = (await res.json()) as { error?: string };
        if (body?.error) message = body.error;
      } catch {
        // ignore
      }
      throw new ProviderError(`Backend ${res.status}: ${message}`, res.status);
    }
    return (await res.json()) as AIAnswer;
  }

  getBriefing(): Promise<MarketBriefing> {
    return this.get<MarketBriefing>(`/api/briefing`);
  }

  getUpcomingEvents(watchlist: Ticker[] = []): Promise<UpcomingEvents> {
    const q = watchlist.length
      ? `?watchlist=${encodeURIComponent(watchlist.join(","))}`
      : "";
    return this.get<UpcomingEvents>(`/api/events${q}`);
  }

  getDividends(symbol: Ticker): Promise<DividendInfo> {
    return this.get<DividendInfo>(`/api/dividends/${encodeURIComponent(symbol)}`);
  }

  async getPositionAnalysis(
    symbol: Ticker,
    portfolio: PortfolioPosition[],
    profile: InvestorProfile | null,
  ): Promise<PositionAnalysis> {
    const res = await fetch(`${this.baseUrl}/api/position-analysis`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ symbol, portfolio, profile }),
    });
    if (!res.ok) {
      let message = res.statusText;
      try {
        const body = (await res.json()) as { error?: string };
        if (body?.error) message = body.error;
      } catch {
        // ignore
      }
      throw new ProviderError(`Backend ${res.status}: ${message}`, res.status);
    }
    return (await res.json()) as PositionAnalysis;
  }
}
