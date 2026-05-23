import { useEffect, useMemo, useRef, useState } from "react";
import {
  formatCurrency,
  formatLargeNumber,
  formatPercentFromDecimal,
  formatRatio,
} from "../core/format";
import type {
  CompanyProfile,
  Multiples,
  Quote,
  SearchResult,
  Ticker,
} from "../core/types";
import { useProvider } from "./providerContext";

const MAX_TICKERS = 4;

interface CompareData {
  symbol: Ticker;
  profile?: CompanyProfile;
  quote?: Quote;
  multiples?: Multiples;
  loading: boolean;
  error?: string;
}

interface RowDef {
  /** Metric label (omitted for section-heading rows). */
  label?: string;
  /** Cell value getter (omitted for section-heading rows). */
  get?: (d: CompareData) => string;
  /** Higher is better (green), lower is red. Inverted for "low is better" metrics. */
  highlight?: "higher-better" | "lower-better";
  /** Numeric extractor for highlight comparison. */
  num?: (d: CompareData) => number | undefined;
  /** Section heading shown before this row. */
  section?: string;
}

const ROWS: RowDef[] = [
  { section: "Price" },
  { label: "Price", get: (d) => formatCurrency(d.quote?.price, d.profile?.currency ?? "USD") },
  {
    label: "Change %",
    get: (d) => (d.quote ? `${d.quote.changePercent.toFixed(2)}%` : "—"),
    highlight: "higher-better",
    num: (d) => d.quote?.changePercent,
  },
  { label: "Market Cap", get: (d) => formatLargeNumber(d.quote?.marketCap) },
  { label: "52w Range", get: (d) =>
    d.quote
      ? `${formatCurrency(d.quote.yearLow, d.profile?.currency ?? "USD")} – ${formatCurrency(d.quote.yearHigh, d.profile?.currency ?? "USD")}`
      : "—" },

  { section: "Valuation" },
  {
    label: "P/E",
    get: (d) => formatRatio(d.multiples?.pe),
    highlight: "lower-better",
    num: (d) => d.multiples?.pe,
  },
  {
    label: "PEG",
    get: (d) => formatRatio(d.multiples?.pegRatio),
    highlight: "lower-better",
    num: (d) => d.multiples?.pegRatio,
  },
  {
    label: "P/S",
    get: (d) => formatRatio(d.multiples?.ps),
    highlight: "lower-better",
    num: (d) => d.multiples?.ps,
  },
  {
    label: "P/B",
    get: (d) => formatRatio(d.multiples?.pb),
    highlight: "lower-better",
    num: (d) => d.multiples?.pb,
  },
  {
    label: "EV/EBITDA",
    get: (d) => formatRatio(d.multiples?.evToEbitda),
    highlight: "lower-better",
    num: (d) => d.multiples?.evToEbitda,
  },
  {
    label: "Dividend Yield",
    get: (d) => formatPercentFromDecimal(d.multiples?.dividendYield),
    highlight: "higher-better",
    num: (d) => d.multiples?.dividendYield,
  },

  { section: "Profitability" },
  {
    label: "Gross Margin",
    get: (d) => formatPercentFromDecimal(d.multiples?.grossMargin),
    highlight: "higher-better",
    num: (d) => d.multiples?.grossMargin,
  },
  {
    label: "Operating Margin",
    get: (d) => formatPercentFromDecimal(d.multiples?.operatingMargin),
    highlight: "higher-better",
    num: (d) => d.multiples?.operatingMargin,
  },
  {
    label: "Net Margin",
    get: (d) => formatPercentFromDecimal(d.multiples?.netMargin),
    highlight: "higher-better",
    num: (d) => d.multiples?.netMargin,
  },
  {
    label: "ROE",
    get: (d) => formatPercentFromDecimal(d.multiples?.roe),
    highlight: "higher-better",
    num: (d) => d.multiples?.roe,
  },
  {
    label: "ROIC",
    get: (d) => formatPercentFromDecimal(d.multiples?.roic),
    highlight: "higher-better",
    num: (d) => d.multiples?.roic,
  },

  { section: "Health" },
  {
    label: "Debt / Equity",
    get: (d) => formatRatio(d.multiples?.debtToEquity),
    highlight: "lower-better",
    num: (d) => d.multiples?.debtToEquity,
  },
  {
    label: "Current Ratio",
    get: (d) => formatRatio(d.multiples?.currentRatio),
    highlight: "higher-better",
    num: (d) => d.multiples?.currentRatio,
  },
  {
    label: "Interest Coverage",
    get: (d) => formatRatio(d.multiples?.interestCoverage),
    highlight: "higher-better",
    num: (d) => d.multiples?.interestCoverage,
  },
];

export function CompareView() {
  const provider = useProvider();
  const [tickers, setTickers] = useState<Ticker[]>([]);
  const [data, setData] = useState<Record<Ticker, CompareData>>({});
  // Track which symbols we've already kicked off a fetch for, independent
  // of React state, so we don't double-fetch under strict mode.
  const started = useRef<Set<Ticker>>(new Set());

  useEffect(() => {
    let cancelled = false;
    tickers.forEach((symbol) => {
      if (started.current.has(symbol)) return;
      started.current.add(symbol);

      setData((prev) => ({ ...prev, [symbol]: { symbol, loading: true } }));

      Promise.all([
        provider.getProfile(symbol),
        provider.getQuote(symbol),
        provider.getMultiples(symbol).catch(() => undefined),
      ])
        .then(([profile, quote, multiples]) => {
          if (cancelled) return;
          setData((prev) => ({
            ...prev,
            [symbol]: { symbol, profile, quote, multiples, loading: false },
          }));
        })
        .catch((e) => {
          if (cancelled) return;
          started.current.delete(symbol); // allow retry on next render
          setData((prev) => ({
            ...prev,
            [symbol]: {
              symbol,
              loading: false,
              error: e instanceof Error ? e.message : "Failed to load",
            },
          }));
        });
    });
    return () => {
      cancelled = true;
    };
  }, [tickers, provider]);

  const addTicker = (symbol: Ticker) => {
    const upper = symbol.toUpperCase().trim();
    if (!upper) return;
    if (tickers.includes(upper)) return;
    if (tickers.length >= MAX_TICKERS) return;
    setTickers((prev) => [...prev, upper]);
  };

  const removeTicker = (symbol: Ticker) => {
    started.current.delete(symbol);
    setTickers((prev) => prev.filter((t) => t !== symbol));
    setData((prev) => {
      const next = { ...prev };
      delete next[symbol];
      return next;
    });
  };

  const rowsData = useMemo(() => tickers.map((t) => data[t] ?? { symbol: t, loading: true }), [tickers, data]);

  return (
    <div className="compare">
      <div className="compare-header">
        <h2>Compare</h2>
        <div className="compare-sub">
          Up to {MAX_TICKERS} tickers side-by-side.
        </div>
      </div>

      <TickerPicker
        onAdd={addTicker}
        disabled={tickers.length >= MAX_TICKERS}
        existing={tickers}
      />

      {tickers.length === 0 ? (
        <div className="empty">
          <p>Add 2 or more tickers above to compare them.</p>
          <p className="hint">Try AAPL, MSFT, GOOGL.</p>
        </div>
      ) : (
        <CompareTable rows={ROWS} cols={rowsData} onRemove={removeTicker} />
      )}
    </div>
  );
}

function TickerPicker({
  onAdd,
  disabled,
  existing,
}: {
  onAdd: (s: Ticker) => void;
  disabled: boolean;
  existing: Ticker[];
}) {
  const provider = useProvider();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [open, setOpen] = useState(false);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (debounce.current) clearTimeout(debounce.current);
    if (!query.trim()) {
      setResults([]);
      return;
    }
    debounce.current = setTimeout(async () => {
      try {
        const r = await provider.search(query.trim());
        setResults(r.filter((x) => !existing.includes(x.symbol.toUpperCase())));
        setOpen(true);
      } catch {
        setResults([]);
      }
    }, 250);
    return () => {
      if (debounce.current) clearTimeout(debounce.current);
    };
  }, [query, provider, existing]);

  const pick = (sym: string) => {
    onAdd(sym);
    setQuery("");
    setResults([]);
    setOpen(false);
  };

  return (
    <div className="ticker-picker search">
      <input
        type="text"
        placeholder={disabled ? "Maximum reached" : "Add a ticker (e.g. AAPL or 'Apple')"}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onFocus={() => results.length > 0 && setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && query.trim()) {
            pick(results[0]?.symbol ?? query.trim().toUpperCase());
          }
        }}
        className="search-input"
        disabled={disabled}
      />
      {open && results.length > 0 && (
        <ul className="search-results">
          {results.map((r) => (
            <li key={`${r.symbol}-${r.exchange ?? ""}`}>
              <button onMouseDown={() => pick(r.symbol)}>
                <span className="symbol">{r.symbol}</span>
                <span className="name">{r.name}</span>
                {r.exchange && <span className="exchange">{r.exchange}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function CompareTable({
  rows,
  cols,
  onRemove,
}: {
  rows: RowDef[];
  cols: CompareData[];
  onRemove: (s: Ticker) => void;
}) {
  return (
    <div className="compare-table-wrap">
      <table className="compare-table">
        <thead>
          <tr>
            <th className="metric-col"></th>
            {cols.map((c) => (
              <th key={c.symbol} className="ticker-col">
                <div className="ticker-header">
                  <div className="ticker-symbol">{c.symbol}</div>
                  <button
                    className="ticker-remove"
                    onClick={() => onRemove(c.symbol)}
                    title="Remove"
                  >
                    ✕
                  </button>
                </div>
                <div className="ticker-name">
                  {c.error ? (
                    <span className="error">{c.error}</span>
                  ) : c.loading ? (
                    "Loading…"
                  ) : (
                    c.profile?.name ?? "—"
                  )}
                </div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => {
            if (row.section) {
              return (
                <tr key={`s-${i}`} className="section-row">
                  <td colSpan={cols.length + 1}>{row.section}</td>
                </tr>
              );
            }
            const values = cols.map((c) => row.num?.(c));
            const winnerIdx = row.highlight ? pickWinner(values, row.highlight) : -1;
            const loserIdx = row.highlight ? pickLoser(values, row.highlight) : -1;
            return (
              <tr key={row.label}>
                <td className="metric-col">{row.label}</td>
                {cols.map((c, j) => {
                  const cls =
                    j === winnerIdx
                      ? "metric-cell winner"
                      : j === loserIdx && cols.length > 1
                        ? "metric-cell loser"
                        : "metric-cell";
                  return (
                    <td key={c.symbol} className={cls}>
                      {c.loading && !c.quote ? "…" : row.get?.(c)}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function pickWinner(values: Array<number | undefined>, mode: "higher-better" | "lower-better"): number {
  const defined = values
    .map((v, i) => ({ v, i }))
    .filter((x): x is { v: number; i: number } => x.v != null && Number.isFinite(x.v));
  if (defined.length < 2) return -1;
  defined.sort((a, b) => (mode === "higher-better" ? b.v - a.v : a.v - b.v));
  return defined[0].i;
}

function pickLoser(values: Array<number | undefined>, mode: "higher-better" | "lower-better"): number {
  const defined = values
    .map((v, i) => ({ v, i }))
    .filter((x): x is { v: number; i: number } => x.v != null && Number.isFinite(x.v));
  if (defined.length < 2) return -1;
  defined.sort((a, b) => (mode === "higher-better" ? a.v - b.v : b.v - a.v));
  return defined[0].i;
}
