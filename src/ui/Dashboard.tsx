import { useEffect, useMemo, useState } from "react";
import { formatCurrency, formatLargeNumber, formatPercent } from "../core/format";
import {
  portfolioBreakdown,
  portfolioTotals,
  positionStats,
  type PortfolioBreakdown,
} from "../core/portfolio";
import type { InvestorProfile, PortfolioPosition, Quote, Ticker } from "../core/types";
import type { WatchlistEntry } from "../core/watchlist";
import { AllocationWheel } from "./AllocationWheel";
import { OnboardingQuiz } from "./OnboardingQuiz";
import { PositionAnalysisCard } from "./PositionAnalysisCard";
import { useInvestorProfile } from "./useInvestorProfile";
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
  const { profile, save: saveProfile } = useInvestorProfile();
  const [cards, setCards] = useState<CardState[]>([]);
  const [loading, setLoading] = useState(false);
  const [sectors, setSectors] = useState<Record<string, string>>({});
  // symbol -> forward annual dividend per share (only for payers)
  const [divPerShare, setDivPerShare] = useState<Record<string, number>>({});
  // First-visit onboarding: hidden for the session via "Maybe later".
  const [quizDismissed, setQuizDismissed] = useState(false);
  const [editingProfile, setEditingProfile] = useState(false);
  // Symbol currently shown in the AI position-check card.
  const [analysisSymbol, setAnalysisSymbol] = useState<string | null>(null);

  // Symbols that represent a real position (shares + cost). Sector allocation
  // only makes sense for these, so we only fetch profiles for them.
  const positionedSymbols = useMemo(
    () =>
      watchlist.entries
        .filter((e) => e.shares && e.costBasis)
        .map((e) => e.symbol),
    [watchlist.entries],
  );
  const positionedKey = useMemo(
    () => [...positionedSymbols].sort().join(","),
    [positionedSymbols],
  );

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

  // For positioned holdings, fetch sector (for allocation) and dividend
  // run-rate (for projected income). Both are cached server-side, so this is
  // cheap and only runs when the set of positioned symbols changes.
  useEffect(() => {
    if (positionedSymbols.length === 0) {
      setSectors({});
      setDivPerShare({});
      return;
    }
    let cancelled = false;
    Promise.all(
      positionedSymbols.map(async (symbol) => {
        const [profile, dividend] = await Promise.all([
          provider.getProfile(symbol).catch(() => undefined),
          provider.getDividends(symbol).catch(() => undefined),
        ]);
        return {
          symbol,
          sector: profile?.sector,
          annual: dividend?.paysDividend ? dividend.forwardAnnual : undefined,
        };
      }),
    ).then((rows) => {
      if (cancelled) return;
      const nextSectors: Record<string, string> = {};
      const nextDiv: Record<string, number> = {};
      for (const r of rows) {
        if (r.sector) nextSectors[r.symbol] = r.sector;
        if (r.annual && r.annual > 0) nextDiv[r.symbol] = r.annual;
      }
      setSectors(nextSectors);
      setDivPerShare(nextDiv);
    });
    return () => {
      cancelled = true;
    };
    // positionedKey is a stable string of the positioned symbols.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [positionedKey, provider]);

  const quotesBySymbol = useMemo(() => {
    const out: Record<string, Quote | undefined> = {};
    for (const c of cards) out[c.symbol] = c.quote;
    return out;
  }, [cards]);

  const totals = useMemo(
    () => portfolioTotals(watchlist.entries, quotesBySymbol),
    [watchlist.entries, quotesBySymbol],
  );

  const breakdown = useMemo(
    () => portfolioBreakdown(watchlist.entries, quotesBySymbol, sectors),
    [watchlist.entries, quotesBySymbol, sectors],
  );

  const income = useMemo(() => {
    let annual = 0;
    let payers = 0;
    for (const e of watchlist.entries) {
      const perShare = e.shares ? divPerShare[e.symbol] : undefined;
      if (e.shares && perShare) {
        annual += e.shares * perShare;
        payers += 1;
      }
    }
    return { annual, payers };
  }, [watchlist.entries, divPerShare]);

  // Current weights in the wire shape the position-analysis endpoint expects.
  const portfolioPositions = useMemo<PortfolioPosition[]>(
    () =>
      (breakdown?.byHolding ?? []).map((s) => ({
        symbol: s.key,
        weightPct: s.pct,
        sector: sectors[s.key],
      })),
    [breakdown, sectors],
  );

  // Saving a real position (shares + cost) triggers the AI position check.
  const handleUpdatePosition = (
    symbol: string,
    shares: number | undefined,
    cost: number | undefined,
  ) => {
    const prev = watchlist.getEntry(symbol);
    watchlist.updatePosition(symbol, shares, cost);
    const changed = prev?.shares !== shares || prev?.costBasis !== cost;
    if (shares && cost && changed) setAnalysisSymbol(symbol);
  };

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

  const showQuiz = (!profile && !quizDismissed) || editingProfile;

  return (
    <div className="dashboard">
      {showQuiz && (
        <OnboardingQuiz
          initial={profile}
          onSave={(p) => {
            saveProfile(p);
            setEditingProfile(false);
            setQuizDismissed(true);
          }}
          onCancel={() => {
            setEditingProfile(false);
            setQuizDismissed(true);
          }}
        />
      )}

      {totals.positionsCount > 0 && <PortfolioSummary totals={totals} />}

      {analysisSymbol && (
        <PositionAnalysisCard
          symbol={analysisSymbol}
          portfolio={portfolioPositions}
          profile={profile}
          onClose={() => setAnalysisSymbol(null)}
        />
      )}

      {breakdown && breakdown.holdingsCount >= 2 && (
        <PortfolioInsights
          breakdown={breakdown}
          income={income}
          profile={profile}
          onEditProfile={() => setEditingProfile(true)}
        />
      )}

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
              handleUpdatePosition(card.symbol, shares, cost)
            }
            onAnalyze={
              watchlist.getEntry(card.symbol)?.shares
                ? () => setAnalysisSymbol(card.symbol)
                : undefined
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

// How much single-stock / single-sector concentration warrants a flag depends
// on the user's stated weighting style.
const THRESHOLDS: Record<
  InvestorProfile["diversification"],
  { holding: number; sector: number }
> = {
  concentrated: { holding: 40, sector: 65 },
  balanced: { holding: 25, sector: 50 },
  diversified: { holding: 15, sector: 35 },
};

function PortfolioInsights({
  breakdown,
  income,
  profile,
  onEditProfile,
}: {
  breakdown: PortfolioBreakdown;
  income: { annual: number; payers: number };
  profile: InvestorProfile | null;
  onEditProfile: () => void;
}) {
  const { bySector, byHolding, topHoldingPct, holdingsCount, sectorsCount } = breakdown;
  const topHolding = byHolding[0];
  const topSector = bySector[0];
  const limits = THRESHOLDS[profile?.diversification ?? "balanced"];

  // Gentle, informational concentration flags — not advice.
  const flags: string[] = [];
  if (topHolding && topHoldingPct >= limits.holding) {
    flags.push(
      `${topHolding.key} is ${topHoldingPct.toFixed(0)}% of your portfolio — large${profile ? " for your stated weighting style" : ""} for a single stock.`,
    );
  }
  if (topSector && topSector.pct >= limits.sector && sectorsCount > 1) {
    flags.push(
      `${topSector.key} makes up ${topSector.pct.toFixed(0)}% of your holdings — heavily weighted to one sector.`,
    );
  }
  if (holdingsCount < 5) {
    flags.push(
      `Only ${holdingsCount} position${holdingsCount === 1 ? "" : "s"} with cost basis set — a small number of stocks carries more single-name risk.`,
    );
  }

  return (
    <div className="portfolio-insights">
      <div className="pi-head">
        <h3>Allocation</h3>
        <span className="pi-sub">
          {holdingsCount} holding{holdingsCount === 1 ? "" : "s"} · {sectorsCount} sector
          {sectorsCount === 1 ? "" : "s"}
        </span>
        <button className="pi-profile-btn" onClick={onEditProfile}>
          {profile ? "Edit profile" : "Set up profile"}
        </button>
      </div>

      <AllocationWheel
        slices={byHolding}
        centerLabel={`${holdingsCount}`}
        centerSub={`holding${holdingsCount === 1 ? "" : "s"}`}
      />

      <div className="pi-bars">
        {bySector.map((s) => (
          <div className="pi-bar-row" key={s.key}>
            <div className="pi-bar-label">
              <span className="pi-bar-name">{s.key}</span>
              <span className="pi-bar-pct">{s.pct.toFixed(0)}%</span>
            </div>
            <div className="pi-bar-track">
              <div className="pi-bar-fill" style={{ width: `${Math.max(s.pct, 2)}%` }} />
            </div>
          </div>
        ))}
      </div>

      {income.payers > 0 && (
        <div className="pi-income">
          <div>
            <span className="pi-income-label">Est. annual dividend income</span>
            <span className="pi-income-sub">
              {" "}
              from {income.payers} holding{income.payers === 1 ? "" : "s"}
            </span>
          </div>
          <span className="pi-income-value">{formatCurrency(income.annual, "USD")}</span>
        </div>
      )}

      {flags.length > 0 && (
        <ul className="pi-flags">
          {flags.map((f, i) => (
            <li key={i}>{f}</li>
          ))}
        </ul>
      )}
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
  onAnalyze,
}: {
  card: CardState;
  entry?: WatchlistEntry;
  loading: boolean;
  onOpen: () => void;
  onRemove: () => void;
  onUpdatePosition: (shares: number | undefined, cost: number | undefined) => void;
  onAnalyze?: () => void;
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
          {onAnalyze && (
            <button className="card-analyze" onClick={onAnalyze} title="AI position check">
              ✦
            </button>
          )}
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
