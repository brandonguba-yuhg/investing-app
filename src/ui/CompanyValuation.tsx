import { useMemo, useState } from "react";
import { formatCurrency, formatLargeNumber } from "../core/format";
import type { Financials, Quote } from "../core/types";

interface Props {
  financials: Financials;
  quote: Quote;
}

interface Assumptions {
  baseFcf: number;
  growth: number; // % per year during projection
  years: number;
  discount: number; // % WACC
  terminalGrowth: number; // %
}

interface DcfResult {
  pvProjected: number;
  pvTerminal: number;
  enterpriseValue: number;
  netDebt: number;
  equityValue: number;
  shares: number;
  fairValue: number;
  upsidePct: number;
  projected: { year: number; fcf: number; pv: number }[];
  warning?: string;
}

function runDcf(a: Assumptions, netDebt: number, shares: number, price: number): DcfResult {
  const g = a.growth / 100;
  const r = a.discount / 100;
  const tg = a.terminalGrowth / 100;

  const projected: DcfResult["projected"] = [];
  let pvProjected = 0;
  for (let year = 1; year <= a.years; year++) {
    const fcf = a.baseFcf * Math.pow(1 + g, year);
    const pv = fcf / Math.pow(1 + r, year);
    pvProjected += pv;
    projected.push({ year, fcf, pv });
  }

  const finalFcf = a.baseFcf * Math.pow(1 + g, a.years);
  let pvTerminal = 0;
  let warning: string | undefined;
  if (r <= tg) {
    warning = "Discount rate must exceed terminal growth for a valid terminal value.";
  } else {
    const terminalValue = (finalFcf * (1 + tg)) / (r - tg);
    pvTerminal = terminalValue / Math.pow(1 + r, a.years);
  }

  const enterpriseValue = pvProjected + pvTerminal;
  const equityValue = enterpriseValue - netDebt;
  const fairValue = shares > 0 ? equityValue / shares : 0;
  const upsidePct = price > 0 ? ((fairValue - price) / price) * 100 : 0;

  return {
    pvProjected,
    pvTerminal,
    enterpriseValue,
    netDebt,
    equityValue,
    shares,
    fairValue,
    upsidePct,
    projected,
    warning,
  };
}

export function CompanyValuation({ financials, quote }: Props) {
  // Derived starting points from the company's own data.
  const latestFcf = financials.cashFlow[0]?.freeCashFlow ?? 0;
  const balance = financials.balance[0];
  const netDebt = balance ? balance.totalDebt - balance.cash : 0;
  const shares = quote.price > 0 ? (quote.marketCap ?? 0) / quote.price : 0;

  // Smart default growth = historical revenue CAGR, clamped to a sane range.
  const defaultGrowth = useMemo(() => {
    const inc = financials.income;
    if (inc.length < 2) return 8;
    const latest = inc[0]?.revenue;
    const oldest = inc[inc.length - 1]?.revenue;
    const n = inc.length - 1;
    if (!latest || !oldest || oldest <= 0) return 8;
    const cagr = (Math.pow(latest / oldest, 1 / n) - 1) * 100;
    if (!Number.isFinite(cagr)) return 8;
    return Math.max(2, Math.min(15, Math.round(cagr * 10) / 10));
  }, [financials.income]);

  const [a, setA] = useState<Assumptions>({
    baseFcf: latestFcf,
    growth: defaultGrowth,
    years: 10,
    discount: 10,
    terminalGrowth: 2.5,
  });

  const result = useMemo(
    () => runDcf(a, netDebt, shares, quote.price),
    [a, netDebt, shares, quote.price],
  );

  const set = (patch: Partial<Assumptions>) => setA((prev) => ({ ...prev, ...patch }));

  const negativeFcf = a.baseFcf <= 0;
  const undervalued = result.upsidePct >= 0;

  return (
    <section className="valuation score-card">
      <div className="score-card-head">
        <h3>Fair Value (DCF)</h3>
        <span className="val-verdict-tag">{a.years}-year model</span>
      </div>
      <p className="score-blurb">
        Discounted cash flow: projects free cash flow forward, discounts it to
        today, and adds a terminal value. Adjust the assumptions to see how the
        implied fair value moves. Defaults are seeded from this company’s history.
      </p>

      {negativeFcf ? (
        <div className="val-note">
          This company’s base free cash flow is negative, so a DCF isn’t
          meaningful. You can enter a normalized FCF below to model a turnaround.
        </div>
      ) : null}

      <div className="val-result">
        <div className="val-fair">
          <div className="val-label">Implied fair value</div>
          <div className="val-fair-num">{formatCurrency(result.fairValue, "USD")}</div>
        </div>
        <div className="val-vs">
          <div className="val-label">Current price</div>
          <div className="val-price-num">{formatCurrency(quote.price, "USD")}</div>
        </div>
        <div className="val-verdict">
          <div className="val-label">Verdict</div>
          <div className={undervalued ? "val-updown up" : "val-updown down"}>
            {Math.abs(result.upsidePct) < 5
              ? "Fairly valued"
              : undervalued
                ? `Undervalued ${result.upsidePct.toFixed(0)}%`
                : `Overvalued ${Math.abs(result.upsidePct).toFixed(0)}%`}
          </div>
        </div>
      </div>

      {result.warning && <div className="val-warning">{result.warning}</div>}

      <div className="val-sliders">
        <SliderRow
          label="Base annual FCF"
          value={formatLargeNumber(a.baseFcf)}
        >
          <input
            type="number"
            className="val-num-input"
            step="any"
            value={a.baseFcf}
            onChange={(e) => set({ baseFcf: Number(e.target.value) })}
          />
        </SliderRow>
        <SliderRow label="FCF growth" value={`${a.growth.toFixed(1)}%/yr`}>
          <input
            type="range"
            min={-5}
            max={30}
            step={0.5}
            value={a.growth}
            onChange={(e) => set({ growth: Number(e.target.value) })}
          />
        </SliderRow>
        <SliderRow label="Projection years" value={`${a.years}`}>
          <input
            type="range"
            min={5}
            max={15}
            step={1}
            value={a.years}
            onChange={(e) => set({ years: Number(e.target.value) })}
          />
        </SliderRow>
        <SliderRow label="Discount rate (WACC)" value={`${a.discount.toFixed(1)}%`}>
          <input
            type="range"
            min={5}
            max={15}
            step={0.25}
            value={a.discount}
            onChange={(e) => set({ discount: Number(e.target.value) })}
          />
        </SliderRow>
        <SliderRow label="Terminal growth" value={`${a.terminalGrowth.toFixed(2)}%`}>
          <input
            type="range"
            min={0}
            max={4}
            step={0.25}
            value={a.terminalGrowth}
            onChange={(e) => set({ terminalGrowth: Number(e.target.value) })}
          />
        </SliderRow>
      </div>

      <details className="val-breakdown">
        <summary>How this fair value is built</summary>
        <table className="val-table">
          <tbody>
            <tr>
              <td className="row-label">PV of {a.years}yr projected FCF</td>
              <td className="num">{formatLargeNumber(result.pvProjected)}</td>
            </tr>
            <tr>
              <td className="row-label">PV of terminal value</td>
              <td className="num">{formatLargeNumber(result.pvTerminal)}</td>
            </tr>
            <tr>
              <td className="row-label">Enterprise value</td>
              <td className="num">{formatLargeNumber(result.enterpriseValue)}</td>
            </tr>
            <tr>
              <td className="row-label">− Net debt</td>
              <td className="num">{formatLargeNumber(result.netDebt)}</td>
            </tr>
            <tr>
              <td className="row-label">= Equity value</td>
              <td className="num">{formatLargeNumber(result.equityValue)}</td>
            </tr>
            <tr>
              <td className="row-label">÷ Shares (est.)</td>
              <td className="num">{formatLargeNumber(result.shares)}</td>
            </tr>
          </tbody>
        </table>
        <p className="val-fineprint">
          Shares estimated from market cap ÷ price. This is a simplified model —
          a real valuation depends heavily on your assumptions. Not investment advice.
        </p>
      </details>
    </section>
  );
}

function SliderRow({
  label,
  value,
  children,
}: {
  label: string;
  value: string;
  children: React.ReactNode;
}) {
  return (
    <div className="val-slider-row">
      <div className="val-slider-head">
        <span>{label}</span>
        <span className="val-slider-value">{value}</span>
      </div>
      {children}
    </div>
  );
}
