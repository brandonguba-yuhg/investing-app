import { useCallback, useMemo, useSyncExternalStore } from "react";
import {
  addTicker,
  createLocalStorageWatchlist,
  findEntry,
  hasTicker,
  removeTicker,
  tickersOf,
  updateEntry,
  type WatchlistEntry,
  type WatchlistStorage,
} from "../core/watchlist";
import type { Ticker } from "../core/types";

const store: WatchlistStorage = createLocalStorageWatchlist();
const EMPTY: WatchlistEntry[] = [];

export function useWatchlist() {
  const entries = useSyncExternalStore(
    (cb) => store.subscribe(cb),
    () => store.read(),
    () => EMPTY,
  );

  const add = useCallback((symbol: Ticker) => {
    store.write(addTicker(store.read(), symbol));
  }, []);

  const remove = useCallback((symbol: Ticker) => {
    store.write(removeTicker(store.read(), symbol));
  }, []);

  const toggle = useCallback((symbol: Ticker) => {
    const list = store.read();
    store.write(hasTicker(list, symbol) ? removeTicker(list, symbol) : addTicker(list, symbol));
  }, []);

  const has = useCallback((symbol: Ticker) => hasTicker(entries, symbol), [entries]);

  const getEntry = useCallback(
    (symbol: Ticker) => findEntry(entries, symbol),
    [entries],
  );

  const updatePosition = useCallback(
    (symbol: Ticker, shares: number | undefined, costBasis: number | undefined) => {
      store.write(updateEntry(store.read(), symbol, { shares, costBasis }));
    },
    [],
  );

  const setNotes = useCallback((symbol: Ticker, notes: string) => {
    store.write(updateEntry(store.read(), symbol, { notes: notes || undefined }));
  }, []);

  // Memoized so consumers (Dashboard) can depend on `tickers` without
  // triggering effect re-runs on every render.
  const tickers = useMemo(() => tickersOf(entries), [entries]);

  return {
    entries,
    tickers,
    add,
    remove,
    toggle,
    has,
    getEntry,
    updatePosition,
    setNotes,
  };
}
