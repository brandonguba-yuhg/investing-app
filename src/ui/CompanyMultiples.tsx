import {
  formatLargeNumber,
  formatPercentFromDecimal,
  formatRatio,
} from "../core/format";
import type { Multiples } from "../core/types";

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
        <Tile label="P/E" value={formatRatio(m.pe)} hint="Price / Earnings" />
        <Tile label="PEG" value={formatRatio(m.pegRatio)} hint="P/E ÷ growth" />
        <Tile label="P/S" value={formatRatio(m.ps)} hint="Price / Sales" />
        <Tile label="P/B" value={formatRatio(m.pb)} hint="Price / Book" />
        <Tile label="P/FCF" value={formatRatio(m.pfcf)} hint="Price / Free Cash Flow" />
        <Tile label="P/OCF" value={formatRatio(m.pocf)} hint="Price / Operating Cash Flow" />
        <Tile label="EV/EBITDA" value={formatRatio(m.evToEbitda)} hint="Enterprise Value / EBITDA" />
        <Tile label="EV/Sales" value={formatRatio(m.evToSales)} hint="Enterprise Value / Revenue" />
        <Tile label="EV/FCF" value={formatRatio(m.evToFcf)} hint="Enterprise Value / Free Cash Flow" />
        <Tile label="Earnings Yield" value={formatPercentFromDecimal(m.earningsYield)} hint="Inverse of P/E" />
        <Tile label="FCF Yield" value={formatPercentFromDecimal(m.fcfYield)} hint="Free Cash Flow / Market Cap" />
        <Tile label="Dividend Yield" value={formatPercentFromDecimal(m.dividendYield)} hint="Dividends per share / Price" />
      </Section>

      <Section title="Profitability">
        <Tile label="Gross Margin" value={formatPercentFromDecimal(m.grossMargin)} hint="Gross Profit / Revenue" />
        <Tile label="Operating Margin" value={formatPercentFromDecimal(m.operatingMargin)} hint="Operating Income / Revenue" />
        <Tile label="EBITDA Margin" value={formatPercentFromDecimal(m.ebitdaMargin)} hint="EBITDA / Revenue" />
        <Tile label="Net Margin" value={formatPercentFromDecimal(m.netMargin)} hint="Net Income / Revenue" />
        <Tile label="ROA" value={formatPercentFromDecimal(m.roa)} hint="Return on Assets" />
        <Tile label="ROE" value={formatPercentFromDecimal(m.roe)} hint="Return on Equity" />
        <Tile label="ROIC" value={formatPercentFromDecimal(m.roic)} hint="Return on Invested Capital" />
      </Section>

      <Section title="Financial Health">
        <Tile label="Debt / Equity" value={formatRatio(m.debtToEquity)} hint="Total Debt / Equity" />
        <Tile label="Current Ratio" value={formatRatio(m.currentRatio)} hint="Current Assets / Current Liabilities" />
        <Tile label="Quick Ratio" value={formatRatio(m.quickRatio)} hint="Liquid Assets / Current Liabilities" />
        <Tile label="Interest Coverage" value={formatRatio(m.interestCoverage)} hint="EBIT / Interest Expense" />
        <Tile label="Payout Ratio" value={formatPercentFromDecimal(m.payoutRatio)} hint="Dividends / Net Income" />
      </Section>

      <Section title="Size">
        <Tile label="Market Cap" value={formatLargeNumber(m.marketCap)} />
        <Tile label="Enterprise Value" value={formatLargeNumber(m.enterpriseValue)} hint="Market Cap + Debt − Cash" />
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

function Tile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="multi-tile" title={hint}>
      <div className="multi-label">{label}</div>
      <div className="multi-value">{value}</div>
      {hint && <div className="multi-hint">{hint}</div>}
    </div>
  );
}
