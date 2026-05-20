import { useCallback, useSyncExternalStore } from "react";
import {
  addTicker,
  createLocalStorageWatchlist,
  hasTicker,
  removeTicker,
  type WatchlistStorage,
} from "../core/watchlist";
import type { Ticker } from "../core/types";

const store: WatchlistStorage = createLocalStorageWatchlist();
const EMPTY: Ticker[] = [];

export function useWatchlist() {
  const tickers = useSyncExternalStore(
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

  const has = useCallback((symbol: Ticker) => hasTicker(tickers, symbol), [tickers]);

  return { tickers, add, remove, toggle, has };
}
