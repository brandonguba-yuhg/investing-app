interface Entry<T> {
  value: T;
  expiresAt: number;
}

/** Simple TTL cache. Single-process, in-memory. Lost on restart. */
export class TtlCache {
  private store = new Map<string, Entry<unknown>>();

  get<T>(key: string): T | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return undefined;
    }
    return entry.value as T;
  }

  set<T>(key: string, value: T, ttlMs: number): void {
    this.store.set(key, { value, expiresAt: Date.now() + ttlMs });
  }

  async wrap<T>(key: string, ttlMs: number, loader: () => Promise<T>): Promise<T> {
    const cached = this.get<T>(key);
    if (cached !== undefined) return cached;
    const value = await loader();
    this.set(key, value, ttlMs);
    return value;
  }

  size(): number {
    return this.store.size;
  }
}

export const cache = new TtlCache();

export const TTL = {
  search: 60 * 60 * 1000,        // 1 hour — name->ticker rarely changes
  quote: 60 * 1000,              // 60 seconds — live price
  profile: 24 * 60 * 60 * 1000,  // 24 hours — company info
  financials: 24 * 60 * 60 * 1000, // 24 hours — quarterly filings
  multiples: 60 * 60 * 1000,     // 1 hour — TTM ratios shift slowly
  historyIntraday: 60 * 1000,    // 1 minute — 1d range with 5-min bars
  historyDaily: 60 * 60 * 1000,  // 1 hour — bars dated daily/weekly
  news: 10 * 60 * 1000,          // 10 minutes — news flow but not real-time
  scores: 24 * 60 * 60 * 1000,   // 24 hours — derived from annual fundamentals
  analysis: 24 * 60 * 60 * 1000, // 24 hours — AI analysis is costly; cache hard
  briefing: 24 * 60 * 60 * 1000, // 24 hours — once-daily market briefing
  events: 12 * 60 * 60 * 1000,   // 12 hours — static macro + slow-moving earnings
  dividends: 12 * 60 * 60 * 1000, // 12 hours — dividend schedules change rarely
} as const;
