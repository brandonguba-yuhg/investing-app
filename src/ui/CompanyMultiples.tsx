import {
  formatLargeNumber,
  formatPercentFromDecimal,
  formatRatio,
} from "../core/format";
import type { Multiples } from "../core/types";
import { InfoTip } from "./InfoTip";

interface Props {
  multiples: Multiples;
}

export function CompanyMultiples({ multiples: m }: Props) {
  return (
    <div className="multiples">
      <p className="multiples-note">
        All ratios are trailing twelve months (TTM).
      </p>

      <Section title="Valuation">
        <Tile label="P/E" metric="pe" value={formatRatio(m.pe)} hint="Price / Earnings" />
        <Tile label="PEG" metric="pegRatio" value={formatRatio(m.pegRatio)} hint="P/E ÷ growth" />
        <Tile label="P/S" metric="ps" value={formatRatio(m.ps)} hint="Price / Sales" />
        <Tile label="P/B" metric="pb" value={formatRatio(m.pb)} hint="Price / Book" />
        <Tile label="P/FCF" metric="pfcf" value={formatRatio(m.pfcf)} hint="Price / Free Cash Flow" />
        <Tile label="P/OCF" metric="pocf" value={formatRatio(m.pocf)} hint="Price / Operating Cash Flow" />
        <Tile label="EV/EBITDA" metric="evToEbitda" value={formatRatio(m.evToEbitda)} hint="Enterprise Value / EBITDA" />
        <Tile label="EV/Sales" metric="evToSales" value={formatRatio(m.evToSales)} hint="Enterprise Value / Revenue" />
        <Tile label="EV/FCF" metric="evToFcf" value={formatRatio(m.evToFcf)} hint="Enterprise Value / Free Cash Flow" />
        <Tile label="Earnings Yield" metric="earningsYield" value={formatPercentFromDecimal(m.earningsYield)} hint="Inverse of P/E" />
        <Tile label="FCF Yield" metric="fcfYield" value={formatPercentFromDecimal(m.fcfYield)} hint="Free Cash Flow / Market Cap" />
        <Tile label="Dividend Yield" metric="dividendYield" value={formatPercentFromDecimal(m.dividendYield)} hint="Dividends per share / Price" />
      </Section>

      <Section title="Profitability">
        <Tile label="Gross Margin" metric="grossMargin" value={formatPercentFromDecimal(m.grossMargin)} hint="Gross Profit / Revenue" />
        <Tile label="Operating Margin" metric="operatingMargin" value={formatPercentFromDecimal(m.operatingMargin)} hint="Operating Income / Revenue" />
        <Tile label="EBITDA Margin" metric="ebitdaMargin" value={formatPercentFromDecimal(m.ebitdaMargin)} hint="EBITDA / Revenue" />
        <Tile label="Net Margin" metric="netMargin" value={formatPercentFromDecimal(m.netMargin)} hint="Net Income / Revenue" />
        <Tile label="ROA" metric="roa" value={formatPercentFromDecimal(m.roa)} hint="Return on Assets" />
        <Tile label="ROE" metric="roe" value={formatPercentFromDecimal(m.roe)} hint="Return on Equity" />
        <Tile label="ROIC" metric="roic" value={formatPercentFromDecimal(m.roic)} hint="Return on Invested Capital" />
      </Section>

      <Section title="Financial Health">
        <Tile label="Debt / Equity" metric="debtToEquity" value={formatRatio(m.debtToEquity)} hint="Total Debt / Equity" />
        <Tile label="Current Ratio" metric="currentRatio" value={formatRatio(m.currentRatio)} hint="Current Assets / Current Liabilities" />
        <Tile label="Quick Ratio" metric="quickRatio" value={formatRatio(m.quickRatio)} hint="Liquid Assets / Current Liabilities" />
        <Tile label="Interest Coverage" metric="interestCoverage" value={formatRatio(m.interestCoverage)} hint="EBIT / Interest Expense" />
        <Tile label="Payout Ratio" metric="payoutRatio" value={formatPercentFromDecimal(m.payoutRatio)} hint="Dividends / Net Income" />
      </Section>

      <Section title="Size">
        <Tile label="Market Cap" value={formatLargeNumber(m.marketCap)} />
        <Tile label="Enterprise Value" metric="enterpriseValue" value={formatLargeNumber(m.enterpriseValue)} hint="Market Cap + Debt − Cash" />
      </Section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="multi-section">
      <h3 className="multi-title">{title}</h3>
      <div className="multi-grid">{children}</div>
    </section>
  );
}

function Tile({
  label,
  value,
  hint,
  metric,
}: {
  label: string;
  value: string;
  hint?: string;
  metric?: string;
}) {
  return (
    <div className="multi-tile">
      <div className="multi-label">
        <span>{label}</span>
        {metric && <InfoTip metric={metric} />}
      </div>
      <div className="multi-value">{value}</div>
      {hint && <div className="multi-hint">{hint}</div>}
    </div>
  );
}
