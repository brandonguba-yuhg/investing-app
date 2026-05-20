import { useEffect, useState } from "react";
import { formatCurrency, formatLargeNumber, formatPercent } from "../core/format";
import type { Quote, Ticker } from "../core/types";
import { useProvider } from "./providerContext";
import { useWatchlist } from "./useWatchlist";

interface Props {
  onSelect: (symbol: Ticker) => void;
}

interface CardState {
  symbol: Ticker;
  quote?: Quote;
  error?: string;
}

export function Dashboard({ onSelect }: Props) {
  const provider = useProvider();
  const watchlist = useWatchlist();
  const [cards, setCards] = useState<CardState[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (watchlist.tickers.length === 0) {
      setCards([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setCards(watchlist.tickers.map((symbol) => ({ symbol })));

    Promise.all(
      watchlist.tickers.map(async (symbol) => {
        try {
          const quote = await provider.getQuote(symbol);
          return { symbol, quote };
        } catch (e) {
          return {
            symbol,
            error: e instanceof Error ? e.message : "Failed to load",
          };
        }
      }),
    ).then((results) => {
      if (cancelled) return;
      setCards(results);
      setLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [watchlist.tickers, provider]);

  if (watchlist.tickers.length === 0) {
    return (
      <div className="empty">
        <p>Your watchlist is empty.</p>
        <p className="hint">
          Search for a company and click <strong>☆ Save</strong> to add it here.
        </p>
      </div>
    );
  }

  return (
    <div className="dashboard">
      <div className="dashboard-header">
        <h2>Watchlist</h2>
        <span className="dashboard-count">{watchlist.tickers.length} {watchlist.tickers.length === 1 ? "stock" : "stocks"}</span>
      </div>
      <div className="dashboard-grid">
        {cards.map((card) => (
          <DashboardCard
            key={card.symbol}
            card={card}
            loading={loading && !card.quote && !card.error}
            onOpen={() => onSelect(card.symbol)}
            onRemove={() => watchlist.remove(card.symbol)}
          />
        ))}
      </div>
    </div>
  );
}

function DashboardCard({
  card,
  loading,
  onOpen,
  onRemove,
}: {
  card: CardState;
  loading: boolean;
  onOpen: () => void;
  onRemove: () => void;
}) {
  const { symbol, quote, error } = card;
  const positive = quote ? quote.change >= 0 : false;

  return (
    <div className="dashboard-card">
      <div className="card-row card-top">
        <button className="card-symbol" onClick={onOpen}>
          {symbol}
        </button>
        <button
          className="card-remove"
          onClick={onRemove}
          title="Remove from watchlist"
        >
          ✕
        </button>
      </div>

      {loading && <div className="card-status">Loading…</div>}
      {error && <div className="card-status error">{error}</div>}

      {quote && (
        <>
          <div className="card-price">{formatCurrency(quote.price, "USD")}</div>
          <div className={positive ? "card-change up" : "card-change down"}>
            {positive ? "+" : ""}
            {quote.change.toFixed(2)} ({formatPercent(quote.changePercent)})
          </div>
          <div className="card-meta">
            <span>Mkt Cap: {formatLargeNumber(quote.marketCap)}</span>
            <span>Vol: {formatLargeNumber(quote.volume)}</span>
          </div>
        </>
      )}
    </div>
  );
}
