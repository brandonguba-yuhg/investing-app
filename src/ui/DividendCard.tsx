import { useEffect, useState } from "react";
import { formatCurrency, formatDate, formatPercent } from "../core/format";
import type { DividendInfo } from "../core/types";
import { InfoTip } from "./InfoTip";
import { useProvider } from "./providerContext";

interface Props {
  symbol: string;
  /** Current share price, used to compute the forward yield. */
  price: number;
  currency?: string;
}

/**
 * Company-level dividend summary, shown on the Overview tab. Self-fetches and
 * renders nothing for companies that don't pay a dividend (or on any error),
 * so it never pushes an empty card onto the page.
 */
export function DividendCard({ symbol, price, currency = "USD" }: Props) {
  const provider = useProvider();
  const [info, setInfo] = useState<DividendInfo | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setInfo(null);
    setFailed(false);
    provider
      .getDividends(symbol)
      .then((d) => {
        if (!cancelled) setInfo(d);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [provider, symbol]);

  if (failed || !info || !info.paysDividend) return null;

  const annual = info.forwardAnnual;
  const yieldPct = annual && price > 0 ? (annual / price) * 100 : undefined;

  return (
    <section className="dividend-card">
      <div className="dividend-head">
        <h3>Dividend</h3>
        <InfoTip
          title="Dividends"
          body="A dividend is a cash payment per share. To receive one you must own the stock before its ex-dividend date. Yield is the annual dividend as a percent of the price."
        />
      </div>

      <div className="dividend-stats">
        <DivStat label="Yield" value={yieldPct != null ? formatPercent(yieldPct) : "—"} accent />
        <DivStat
          label="Annual / share"
          value={annual != null ? formatCurrency(annual, currency) : "—"}
        />
        <DivStat label="Frequency" value={info.frequency ?? "—"} />
        <DivStat
          label={info.nextExDate ? "Next ex-date" : "Last ex-date"}
          value={formatDate(info.nextExDate ?? info.lastExDate)}
        />
      </div>

      {info.history.length > 1 && (
        <div className="dividend-history">
          <span className="dividend-history-label">Recent payments</span>
          <div className="dividend-chips">
            {info.history.slice(0, 6).map((p) => (
              <span className="dividend-chip" key={p.exDate} title={`Ex-date ${formatDate(p.exDate)}`}>
                {formatCurrency(p.amount, currency)}
                <span className="dividend-chip-date">{shortDate(p.exDate)}</span>
              </span>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

function DivStat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="dividend-stat">
      <div className="dividend-stat-label">{label}</div>
      <div className={accent ? "dividend-stat-value accent" : "dividend-stat-value"}>{value}</div>
    </div>
  );
}

function shortDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", { month: "short", year: "2-digit" });
}
