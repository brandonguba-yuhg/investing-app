import type { Ticker } from "./types";

const KEY = "investing.watchlist.v1";

export interface WatchlistStorage {
  read(): Ticker[];
  write(tickers: Ticker[]): void;
  subscribe(listener: () => void): () => void;
}

export function createLocalStorageWatchlist(
  storage: Storage = typeof localStorage !== "undefined" ? localStorage : memoryStorage(),
): WatchlistStorage {
  const listeners = new Set<() => void>();
  let cached: Ticker[] | null = null;
  let cachedRaw: string | null = null;

  const parse = (raw: string | null): Ticker[] => {
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.filter((t) => typeof t === "string") : [];
    } catch {
      return [];
    }
  };

  const read = (): Ticker[] => {
    const raw = storage.getItem(KEY);
    if (cached !== null && raw === cachedRaw) return cached;
    cachedRaw = raw;
    cached = parse(raw);
    return cached;
  };

  const write = (tickers: Ticker[]): void => {
    const raw = JSON.stringify(tickers);
    storage.setItem(KEY, raw);
    cachedRaw = raw;
    cached = tickers;
    listeners.forEach((l) => l());
  };

  const subscribe = (listener: () => void): (() => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  };

  return { read, write, subscribe };
}

export function addTicker(list: Ticker[], symbol: Ticker): Ticker[] {
  const upper = symbol.toUpperCase();
  if (list.includes(upper)) return list;
  return [...list, upper];
}

export function removeTicker(list: Ticker[], symbol: Ticker): Ticker[] {
  const upper = symbol.toUpperCase();
  return list.filter((t) => t !== upper);
}

export function hasTicker(list: Ticker[], symbol: Ticker): boolean {
  return list.includes(symbol.toUpperCase());
}

function memoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (k) => map.get(k) ?? null,
    key: (i) => Array.from(map.keys())[i] ?? null,
    removeItem: (k) => {
      map.delete(k);
    },
    setItem: (k, v) => {
      map.set(k, v);
    },
  };
}
