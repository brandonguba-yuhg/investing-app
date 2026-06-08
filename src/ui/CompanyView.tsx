import { useEffect, useState } from "react";
import {
  formatCurrency,
  formatDate,
  formatLargeNumber,
  formatPercent,
} from "../core/format";
import type {
  CompanyProfile,
  Financials,
  Multiples,
  Period,
  QualityScores,
  Quote,
} from "../core/types";
import { CompanyAI } from "./CompanyAI";
import { CompanyCharts } from "./CompanyCharts";
import { CompanyMultiples } from "./CompanyMultiples";
import { CompanyScores } from "./CompanyScores";
import { CompanyValuation } from "./CompanyValuation";
import { DividendCard } from "./DividendCard";
// Vaulted: notes feature kept on disk but not wired into the UI.
// import { CompanyNotes } from "./CompanyNotes";
import { NewsFeed } from "./NewsFeed";
import { PriceChart } from "./PriceChart";
import { useProvider } from "./providerContext";
import { useWatchlist } from "./useWatchlist";

interface Props {
  symbol: string;
}

type View = "overview" | "charts" | "multiples" | "analysis";
type Statement = "income" | "balance" | "cashflow";

export function CompanyView({ symbol }: Props) {
  const provider = useProvider();
  const [profile, setProfile] = useState<CompanyProfile | null>(null);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [financials, setFinancials] = useState<Financials | null>(null);
  const [multiples, setMultiples] = useState<Multiples | null>(null);
  const [period, setPeriod] = useState<Period>("annual");
  const [view, setView] = useState<View>("overview");
  const [statement, setStatement] = useState<Statement>("income");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [multiplesLoading, setMultiplesLoading] = useState(false);
  const [multiplesError, setMultiplesError] = useState<string | null>(null);
  const [scores, setScores] = useState<QualityScores | null>(null);
  const [scoresLoading, setScoresLoading] = useState(false);
  const [scoresError, setScoresError] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);
  const watchlist = useWatchlist();

  // Primary load: profile + quote + financials. Multiples is lazy (below).
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setMultiples(null);
    setMultiplesError(null);
    setScores(null);
    setScoresError(null);
    Promise.all([
      provider.getProfile(symbol),
      provider.getQuote(symbol),
      provider.getFinancials(symbol, period, 5),
    ])
      .then(([p, q, f]) => {
        if (cancelled) return;
        setProfile(p);
        setQuote(q);
        setFinancials(f);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(toErrorMessage(e, symbol));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [symbol, period, provider, retryKey]);

  // Lazy: fetch multiples only when the user opens that tab.
  // We only gate on whether we already have data — strict-mode double-mount is
  // handled by the `cancelled` flag so stale fetches don't setState.
  useEffect(() => {
    if (view !== "multiples" || multiples) return;
    let cancelled = false;
    setMultiplesLoading(true);
    setMultiplesError(null);
    provider
      .getMultiples(symbol)
      .then((m) => {
        if (!cancelled) {
          setMultiples(m);
          setMultiplesLoading(false);
        }
      })
      .catch((e) => {
        if (!cancelled) {
          setMultiplesError(toErrorMessage(e, symbol));
          setMultiplesLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [view, symbol, provider, multiples]);

  // Lazy: fetch quality scores only when the Analysis tab is opened.
  useEffect(() => {
    if (view !== "analysis" || scores) return;
    let cancelled = false;
    setScoresLoading(true);
    setScoresError(null);
    provider
      .getScores(symbol)
      .then((s) => {
        if (!cancelled) {
          setScores(s);
          setScoresLoading(false);
        }
      })
      .catch((e) => {
        if (!cancelled) {
          setScoresError(toErrorMessage(e, symbol));
          setScoresLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [view, symbol, provider, scores]);

  if (loading) return <div className="loading">Loading {symbol}…</div>;
  if (error) {
    return (
      <div className="error-block">
        <p>{error}</p>
        <button
          className="retry-btn"
          onClick={() => setRetryKey((k) => k + 1)}
        >
          Try again
        </button>
      </div>
    );
  }
  if (!profile || !quote || !financials) return null;

  const currency = profile.currency ?? "USD";
  const positive = quote.change >= 0;
  const latestEps = financials.income[0]?.eps;
  const pe =
    latestEps && latestEps !== 0 ? quote.price / latestEps : undefined;
  const saved = watchlist.has(profile.symbol);

  return (
    <div className="company">
      <header className="company-header">
        <div>
          <h1>
            {profile.name} <span className="ticker">{profile.symbol}</span>
          </h1>
          <div className="meta">
            {profile.exchange} · {profile.sector ?? "—"} · {profile.industry ?? "—"}
          </div>
        </div>
        <div className="price-block">
          <div className="price">{formatCurrency(quote.price, currency)}</div>
          <div className={positive ? "change up" : "change down"}>
            {positive ? "+" : ""}
            {quote.change.toFixed(2)} ({formatPercent(quote.changePercent)})
          </div>
          <button
            className={saved ? "save-btn saved" : "save-btn"}
            onClick={() => watchlist.toggle(profile.symbol)}
            title={saved ? "Remove from watchlist" : "Save to watchlist"}
          >
            {saved ? "★ Saved" : "☆ Save"}
          </button>
        </div>
      </header>

      <div className="view-tabs">
        <button
          className={view === "overview" ? "view-tab on" : "view-tab"}
          onClick={() => setView("overview")}
        >
          Overview
        </button>
        <button
          className={view === "charts" ? "view-tab on" : "view-tab"}
          onClick={() => setView("charts")}
        >
          Charts
        </button>
        <button
          className={view === "multiples" ? "view-tab on" : "view-tab"}
          onClick={() => setView("multiples")}
        >
          Multiples
        </button>
        <button
          className={view === "analysis" ? "view-tab on" : "view-tab"}
          onClick={() => setView("analysis")}
        >
          Analysis
        </button>
      </div>

      {view === "overview" ? (
        <>
          <PriceChart symbol={profile.symbol} currency={currency} />

          <section className="stats">
            <Stat label="Market Cap" value={formatLargeNumber(quote.marketCap)} />
            <Stat label="P/E" value={pe ? pe.toFixed(2) : "—"} />
            <Stat label="EPS" value={latestEps ? latestEps.toFixed(2) : "—"} />
            <Stat label="Day Range" value={`${formatCurrency(quote.dayLow, currency)} – ${formatCurrency(quote.dayHigh, currency)}`} />
            <Stat label="52w Range" value={`${formatCurrency(quote.yearLow, currency)} – ${formatCurrency(quote.yearHigh, currency)}`} />
            <Stat label="Volume" value={formatLargeNumber(quote.volume)} />
          </section>

          <DividendCard symbol={profile.symbol} price={quote.price} currency={currency} />

          {profile.description && (
            <details className="collapsible">
              <summary>
                <span className="collapsible-title">About {profile.name}</span>
                <span className="collapsible-icon" aria-hidden>▾</span>
              </summary>
              <div className="collapsible-body description-body">
                <p>{profile.description}</p>
              </div>
            </details>
          )}

          <NewsFeed symbol={profile.symbol} />

          {/* Notes vaulted — re-enable by uncommenting:
              {saved && <CompanyNotes symbol={profile.symbol} />}
          */}

          <section className="financials">
            <div className="financials-controls">
              <div className="tabs">
                <TabButton active={statement === "income"} onClick={() => setStatement("income")}>Income</TabButton>
                <TabButton active={statement === "balance"} onClick={() => setStatement("balance")}>Balance Sheet</TabButton>
                <TabButton active={statement === "cashflow"} onClick={() => setStatement("cashflow")}>Cash Flow</TabButton>
              </div>
              <PeriodToggle period={period} onChange={setPeriod} />
            </div>

            {statement === "income" && <IncomeTable rows={financials.income} />}
            {statement === "balance" && <BalanceTable rows={financials.balance} />}
            {statement === "cashflow" && <CashFlowTable rows={financials.cashFlow} />}
          </section>
        </>
      ) : view === "charts" ? (
        <>
          <div className="charts-controls">
            <PeriodToggle period={period} onChange={setPeriod} />
          </div>
          <CompanyCharts financials={financials} period={period} />
        </>
      ) : view === "multiples" ? (
        multiples ? (
          <CompanyMultiples multiples={multiples} />
        ) : multiplesLoading ? (
          <div className="loading">Loading multiples…</div>
        ) : multiplesError ? (
          <div className="error-block">
            <p>{multiplesError}</p>
            <button
              className="retry-btn"
              onClick={() => {
                setMultiples(null);
                setMultiplesError(null);
              }}
            >
              Try again
            </button>
          </div>
        ) : (
          <div className="loading">Multiples unavailable for {symbol}</div>
        )
      ) : (
        // view === "analysis"
        <div className="analysis">
          <CompanyAI symbol={profile.symbol} />

          {scores ? (
            <CompanyScores scores={scores} />
          ) : scoresLoading ? (
            <div className="loading">Crunching the numbers…</div>
          ) : scoresError ? (
            <div className="error-block">
              <p>{scoresError}</p>
              <button
                className="retry-btn"
                onClick={() => {
                  setScores(null);
                  setScoresError(null);
                }}
              >
                Try again
              </button>
            </div>
          ) : null}

          <CompanyValuation financials={financials} quote={quote} />
        </div>
      )}
    </div>
  );
}

function toErrorMessage(e: unknown, symbol: string): string {
  const raw = e instanceof Error ? e.message : String(e);
  if (/404|not found|no .* for/i.test(raw)) {
    return `Couldn't find data for "${symbol}". Check the ticker symbol.`;
  }
  if (/failed to fetch|networkerror|load failed/i.test(raw)) {
    return "Couldn't reach the backend. Check that the server is running.";
  }
  if (/429|rate limit/i.test(raw)) {
    return "Rate limited by the data source. Wait a moment and try again.";
  }
  return raw || "Something went wrong loading this company.";
}

function PeriodToggle({ period, onChange }: { period: Period; onChange: (p: Period) => void }) {
  return (
    <div className="period-toggle">
      <button className={period === "annual" ? "on" : ""} onClick={() => onChange("annual")}>
        Annual
      </button>
      <button className={period === "quarter" ? "on" : ""} onClick={() => onChange("quarter")}>
        Quarterly
      </button>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat">
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button className={active ? "tab on" : "tab"} onClick={onClick}>
      {children}
    </button>
  );
}

function IncomeTable({ rows }: { rows: Financials["income"] }) {
  return (
    <table className="fin-table">
      <thead>
        <tr>
          <th>Metric</th>
          {rows.map((r) => <th key={r.date}>{formatDate(r.date)}</th>)}
        </tr>
      </thead>
      <tbody>
        <Row label="Revenue" values={rows.map((r) => r.revenue)} />
        <Row label="Cost of Revenue" values={rows.map((r) => r.costOfRevenue)} />
        <Row label="Gross Profit" values={rows.map((r) => r.grossProfit)} />
        <Row label="Operating Income" values={rows.map((r) => r.operatingIncome)} />
        <Row label="Net Income" values={rows.map((r) => r.netIncome)} />
        <Row label="EPS" values={rows.map((r) => r.eps)} raw />
      </tbody>
    </table>
  );
}

function BalanceTable({ rows }: { rows: Financials["balance"] }) {
  return (
    <table className="fin-table">
      <thead>
        <tr>
          <th>Metric</th>
          {rows.map((r) => <th key={r.date}>{formatDate(r.date)}</th>)}
        </tr>
      </thead>
      <tbody>
        <Row label="Total Assets" values={rows.map((r) => r.totalAssets)} />
        <Row label="Total Liabilities" values={rows.map((r) => r.totalLiabilities)} />
        <Row label="Total Equity" values={rows.map((r) => r.totalEquity)} />
        <Row label="Cash" values={rows.map((r) => r.cash)} />
        <Row label="Total Debt" values={rows.map((r) => r.totalDebt)} />
      </tbody>
    </table>
  );
}

function CashFlowTable({ rows }: { rows: Financials["cashFlow"] }) {
  return (
    <table className="fin-table">
      <thead>
        <tr>
          <th>Metric</th>
          {rows.map((r) => <th key={r.date}>{formatDate(r.date)}</th>)}
        </tr>
      </thead>
      <tbody>
        <Row label="Operating CF" values={rows.map((r) => r.operatingCashFlow)} />
        <Row label="Investing CF" values={rows.map((r) => r.investingCashFlow)} />
        <Row label="Financing CF" values={rows.map((r) => r.financingCashFlow)} />
        <Row label="Free Cash Flow" values={rows.map((r) => r.freeCashFlow)} />
      </tbody>
    </table>
  );
}

function Row({ label, values, raw = false }: { label: string; values: number[]; raw?: boolean }) {
  return (
    <tr>
      <td className="row-label">{label}</td>
      {values.map((v, i) => (
        <td key={i} className="num">
          {raw ? (Number.isFinite(v) ? v.toFixed(2) : "—") : formatLargeNumber(v)}
        </td>
      ))}
    </tr>
  );
}
