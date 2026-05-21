import { useEffect, useMemo, useState } from "react";
import { formatCurrency, formatLargeNumber, formatPercent } from "../core/format";
import { portfolioTotals, positionStats } from "../core/portfolio";
import type { Quote, Ticker } from "../core/types";
import type { WatchlistEntry } from "../core/watchlist";
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

  const quotesBySymbol = useMemo(() => {
    const out: Record<string, Quote | undefined> = {};
    for (const c of cards) out[c.symbol] = c.quote;
    return out;
  }, [cards]);

  const totals = useMemo(
    () => portfolioTotals(watchlist.entries, quotesBySymbol),
    [watchlist.entries, quotesBySymbol],
  );

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
      {totals.positionsCount > 0 && <PortfolioSummary totals={totals} />}

      <div className="dashboard-header">
        <h2>Watchlist</h2>
        <span className="dashboard-count">
          {watchlist.tickers.length} {watchlist.tickers.length === 1 ? "stock" : "stocks"}
          {totals.positionsCount > 0 && ` · ${totals.positionsCount} position${totals.positionsCount === 1 ? "" : "s"}`}
        </span>
      </div>

      <div className="dashboard-grid">
        {cards.map((card) => (
          <DashboardCard
            key={card.symbol}
            card={card}
            entry={watchlist.getEntry(card.symbol)}
            loading={loading && !card.quote && !card.error}
            onOpen={() => onSelect(card.symbol)}
            onRemove={() => watchlist.remove(card.symbol)}
            onUpdatePosition={(shares, cost) =>
              watchlist.updatePosition(card.symbol, shares, cost)
            }
          />
        ))}
      </div>
    </div>
  );
}

function PortfolioSummary({
  totals,
}: {
  totals: ReturnType<typeof portfolioTotals>;
}) {
  const up = totals.gain >= 0;
  const dayUp = totals.dayChange >= 0;
  return (
    <div className="portfolio-summary">
      <div className="ps-cell">
        <div className="ps-label">Total Value</div>
        <div className="ps-value">{formatCurrency(totals.value, "USD")}</div>
      </div>
      <div className="ps-cell">
        <div className="ps-label">Cost Basis</div>
        <div className="ps-value subtle">{formatCurrency(totals.cost, "USD")}</div>
      </div>
      <div className="ps-cell">
        <div className="ps-label">Total Gain</div>
        <div className={up ? "ps-value up" : "ps-value down"}>
          {up ? "+" : ""}
          {formatCurrency(totals.gain, "USD")}
          <span className="ps-pct">
            {" "}
            ({totals.gainPct >= 0 ? "+" : ""}
            {totals.gainPct.toFixed(2)}%)
          </span>
        </div>
      </div>
      <div className="ps-cell">
        <div className="ps-label">Today</div>
        <div className={dayUp ? "ps-value up" : "ps-value down"}>
          {dayUp ? "+" : ""}
          {formatCurrency(totals.dayChange, "USD")}
        </div>
      </div>
    </div>
  );
}

function DashboardCard({
  card,
  entry,
  loading,
  onOpen,
  onRemove,
  onUpdatePosition,
}: {
  card: CardState;
  entry?: WatchlistEntry;
  loading: boolean;
  onOpen: () => void;
  onRemove: () => void;
  onUpdatePosition: (shares: number | undefined, cost: number | undefined) => void;
}) {
  const { symbol, quote, error } = card;
  const positive = quote ? quote.change >= 0 : false;
  const stats = quote && entry ? positionStats(entry, quote) : null;
  const [editing, setEditing] = useState(false);

  return (
    <div className="dashboard-card">
      <div className="card-row card-top">
        <button className="card-symbol" onClick={onOpen}>
          {symbol}
        </button>
        <div className="card-actions">
          <button
            className="card-edit"
            onClick={() => setEditing((v) => !v)}
            title={entry?.shares ? "Edit position" : "Add position"}
          >
            {entry?.shares ? "✎" : "+"}
          </button>
          <button
            className="card-remove"
            onClick={onRemove}
            title="Remove from watchlist"
          >
            ✕
          </button>
        </div>
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

          {stats && (
            <div className="card-position">
              <div className="cp-row">
                <span>{entry?.shares?.toLocaleString()} sh</span>
                <span className="cp-value">{formatCurrency(stats.value, "USD")}</span>
              </div>
              <div className={stats.gain >= 0 ? "cp-gain up" : "cp-gain down"}>
                {stats.gain >= 0 ? "+" : ""}
                {formatCurrency(stats.gain, "USD")}
                <span className="cp-pct">
                  {" "}
                  ({stats.gainPct >= 0 ? "+" : ""}
                  {stats.gainPct.toFixed(2)}%)
                </span>
              </div>
            </div>
          )}

          <div className="card-meta">
            <span>Mkt Cap: {formatLargeNumber(quote.marketCap)}</span>
            <span>Vol: {formatLargeNumber(quote.volume)}</span>
          </div>

          {editing && (
            <PositionEditor
              initialShares={entry?.shares}
              initialCost={entry?.costBasis}
              onSave={(s, c) => {
                onUpdatePosition(s, c);
                setEditing(false);
              }}
              onCancel={() => setEditing(false)}
              onClear={() => {
                onUpdatePosition(undefined, undefined);
                setEditing(false);
              }}
            />
          )}
        </>
      )}
    </div>
  );
}

function PositionEditor({
  initialShares,
  initialCost,
  onSave,
  onCancel,
  onClear,
}: {
  initialShares?: number;
  initialCost?: number;
  onSave: (shares: number | undefined, cost: number | undefined) => void;
  onCancel: () => void;
  onClear: () => void;
}) {
  const [shares, setShares] = useState(initialShares ? String(initialShares) : "");
  const [cost, setCost] = useState(initialCost ? String(initialCost) : "");

  const handleSave = () => {
    const s = Number(shares);
    const c = Number(cost);
    if (s > 0 && c > 0) {
      onSave(s, c);
    } else {
      onSave(undefined, undefined);
    }
  };

  return (
    <div className="position-editor">
      <div className="pe-row">
        <label>
          Shares
          <input
            type="number"
            step="any"
            min="0"
            value={shares}
            onChange={(e) => setShares(e.target.value)}
            placeholder="100"
          />
        </label>
        <label>
          Cost / share
          <input
            type="number"
            step="any"
            min="0"
            value={cost}
            onChange={(e) => setCost(e.target.value)}
            placeholder="150.00"
          />
        </label>
      </div>
      <div className="pe-actions">
        <button className="pe-btn primary" onClick={handleSave}>
          Save
        </button>
        <button className="pe-btn" onClick={onCancel}>
          Cancel
        </button>
        {(initialShares || initialCost) && (
          <button className="pe-btn danger" onClick={onClear}>
            Clear
          </button>
        )}
      </div>
    </div>
  );
}
