import type { Ticker } from "./types";

const KEY_V2 = "investing.watchlist.v2";
const KEY_V1 = "investing.watchlist.v1";

export interface WatchlistEntry {
  symbol: Ticker;
  /** Optional position: number of shares held. Undefined = just watching, no position. */
  shares?: number;
  /** Average cost per share, in the position's currency. */
  costBasis?: number;
  /** Free-text notes from the user. */
  notes?: string;
  /** ISO timestamp when first added. */
  addedAt?: string;
}

export interface WatchlistStorage {
  read(): WatchlistEntry[];
  write(entries: WatchlistEntry[]): void;
  subscribe(listener: () => void): () => void;
}

export function createLocalStorageWatchlist(
  storage: Storage = typeof localStorage !== "undefined" ? localStorage : memoryStorage(),
): WatchlistStorage {
  const listeners = new Set<() => void>();
  let cached: WatchlistEntry[] | null = null;
  let cachedRaw: string | null = null;

  const migrateFromV1 = (): WatchlistEntry[] | null => {
    const old = storage.getItem(KEY_V1);
    if (!old) return null;
    try {
      const parsed = JSON.parse(old);
      if (!Array.isArray(parsed)) return null;
      const entries: WatchlistEntry[] = parsed
        .filter((t) => typeof t === "string")
        .map((symbol) => ({ symbol, addedAt: new Date().toISOString() }));
      const raw = JSON.stringify(entries);
      storage.setItem(KEY_V2, raw);
      cachedRaw = raw;
      cached = entries;
      return entries;
    } catch {
      return null;
    }
  };

  const parse = (raw: string | null): WatchlistEntry[] => {
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed
        .filter((e): e is WatchlistEntry => e && typeof e === "object" && typeof e.symbol === "string")
        .map((e) => ({
          symbol: String(e.symbol).toUpperCase(),
          shares: typeof e.shares === "number" && e.shares > 0 ? e.shares : undefined,
          costBasis:
            typeof e.costBasis === "number" && e.costBasis > 0 ? e.costBasis : undefined,
          notes: typeof e.notes === "string" ? e.notes : undefined,
          addedAt: typeof e.addedAt === "string" ? e.addedAt : undefined,
        }));
    } catch {
      return [];
    }
  };

  const read = (): WatchlistEntry[] => {
    const raw = storage.getItem(KEY_V2);
    if (!raw) {
      // First read on this client — try to migrate v1 data.
      const migrated = migrateFromV1();
      if (migrated) return migrated;
    }
    if (cached !== null && raw === cachedRaw) return cached;
    cachedRaw = raw;
    cached = parse(raw);
    return cached;
  };

  const write = (entries: WatchlistEntry[]): void => {
    const raw = JSON.stringify(entries);
    storage.setItem(KEY_V2, raw);
    cachedRaw = raw;
    cached = entries;
    listeners.forEach((l) => l());
  };

  const subscribe = (listener: () => void): (() => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  };

  return { read, write, subscribe };
}

// ---------- pure helpers ----------

export function findEntry(list: WatchlistEntry[], symbol: Ticker): WatchlistEntry | undefined {
  const upper = symbol.toUpperCase();
  return list.find((e) => e.symbol === upper);
}

export function hasTicker(list: WatchlistEntry[], symbol: Ticker): boolean {
  return findEntry(list, symbol) !== undefined;
}

export function addTicker(list: WatchlistEntry[], symbol: Ticker): WatchlistEntry[] {
  const upper = symbol.toUpperCase();
  if (hasTicker(list, upper)) return list;
  return [...list, { symbol: upper, addedAt: new Date().toISOString() }];
}

export function removeTicker(list: WatchlistEntry[], symbol: Ticker): WatchlistEntry[] {
  const upper = symbol.toUpperCase();
  return list.filter((e) => e.symbol !== upper);
}

export function updateEntry(
  list: WatchlistEntry[],
  symbol: Ticker,
  patch: Partial<Omit<WatchlistEntry, "symbol">>,
): WatchlistEntry[] {
  const upper = symbol.toUpperCase();
  let found = false;
  const next = list.map((e) => {
    if (e.symbol !== upper) return e;
    found = true;
    return { ...e, ...patch };
  });
  if (!found) {
    next.push({ symbol: upper, addedAt: new Date().toISOString(), ...patch });
  }
  return next;
}

/** Returns the tickers array (the previous-shape API some callers want). */
export function tickersOf(list: WatchlistEntry[]): Ticker[] {
  return list.map((e) => e.symbol);
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
