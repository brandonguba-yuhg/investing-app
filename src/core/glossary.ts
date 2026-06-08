/**
 * Plain-English explanations for financial metrics, written for retail
 * investors who may be seeing these ratios for the first time.
 *
 * Each entry has:
 *  - `plain`:   one sentence on what the number actually means.
 *  - `typical`: a rough rule-of-thumb for reading it. These are general
 *               guidelines only — "good" varies enormously by industry and
 *               business model, and none of this is investment advice.
 *
 * Keys match the field names on the `Multiples` type so callers can look up
 * an entry directly from the metric they're rendering.
 */

export interface GlossaryEntry {
  /** Human label (matches the on-screen label). */
  name: string;
  /** What the metric measures, in one plain sentence. */
  plain: string;
  /** A rough rule of thumb for interpreting the value. */
  typical: string;
}

export const METRIC_GLOSSARY: Record<string, GlossaryEntry> = {
  pe: {
    name: "Price / Earnings (P/E)",
    plain: "How many dollars you pay for each $1 of the company's annual profit.",
    typical:
      "Mature companies often sit around 15–25. A high P/E means the market expects fast growth; a negative P/E means the company isn't profitable.",
  },
  pegRatio: {
    name: "PEG Ratio",
    plain: "The P/E ratio divided by the company's earnings growth rate.",
    typical:
      "Around 1.0 is often considered fair value. Below 1 can suggest you're paying little for the growth on offer.",
  },
  ps: {
    name: "Price / Sales (P/S)",
    plain: "How many dollars you pay for each $1 of the company's revenue.",
    typical:
      "Useful when a company isn't profitable yet. Varies hugely by industry, so compare to similar companies rather than a fixed number.",
  },
  pb: {
    name: "Price / Book (P/B)",
    plain: "Price compared to the company's accounting net worth (assets minus liabilities).",
    typical:
      "Below 1 can mean it trades for less than its book value — a bargain or a warning sign. Asset-light firms (software) often trade well above 3.",
  },
  pfcf: {
    name: "Price / Free Cash Flow",
    plain: "Price compared to the actual cash left over after running and investing in the business.",
    typical:
      "Lower is cheaper. Under ~20 is often seen as reasonable. Free cash flow is harder to manipulate than earnings.",
  },
  pocf: {
    name: "Price / Operating Cash Flow",
    plain: "Price compared to the cash the core business generates before big investments.",
    typical: "Lower is cheaper. Like P/FCF but before capital spending is subtracted.",
  },
  evToEbitda: {
    name: "EV / EBITDA",
    plain:
      "The whole company's value (including debt) compared to its earnings before interest, tax, and accounting charges.",
    typical:
      "Under ~10 is often considered inexpensive. Useful for comparing companies with different debt levels.",
  },
  evToSales: {
    name: "EV / Sales",
    plain: "The whole company's value (including debt) compared to its revenue.",
    typical:
      "Handy for fast-growing or unprofitable firms. Compare within an industry — high-margin businesses justify higher multiples.",
  },
  evToFcf: {
    name: "EV / Free Cash Flow",
    plain: "The whole company's value (including debt) compared to its free cash flow.",
    typical: "Lower is cheaper. A debt-aware version of Price / Free Cash Flow.",
  },
  earningsYield: {
    name: "Earnings Yield",
    plain: "The flip side of P/E — annual profit as a percentage of the share price.",
    typical:
      "Higher means cheaper. Handy to compare against bond yields: a 5% earnings yield is like the stock 'paying' 5%.",
  },
  fcfYield: {
    name: "Free Cash Flow Yield",
    plain: "Free cash flow as a percentage of the company's market value.",
    typical: "Higher is more attractive. Above ~5% is often considered healthy.",
  },
  dividendYield: {
    name: "Dividend Yield",
    plain: "The annual dividend as a percentage of the current share price.",
    typical:
      "Income investors watch this closely. A very high yield (say 8%+) can be a red flag that the market expects a cut.",
  },
  grossMargin: {
    name: "Gross Margin",
    plain: "The share of revenue left after the direct cost of making the product or service.",
    typical: "Higher signals pricing power. Software can exceed 70%; retailers may run under 30%.",
  },
  operatingMargin: {
    name: "Operating Margin",
    plain: "The share of revenue left as profit from the core business, before interest and tax.",
    typical: "Higher means a more efficient business. Compare to industry peers.",
  },
  ebitdaMargin: {
    name: "EBITDA Margin",
    plain: "Profit as a share of revenue before interest, tax, and accounting charges.",
    typical: "A rough proxy for cash profitability. Higher is better; compare within an industry.",
  },
  netMargin: {
    name: "Net Margin",
    plain: "The share of revenue that becomes bottom-line profit after every cost.",
    typical: "Above ~10% is generally healthy, though thin-margin industries (groceries) run far lower.",
  },
  roa: {
    name: "Return on Assets (ROA)",
    plain: "How much profit the company squeezes from every dollar of its assets.",
    typical: "Above ~5% is decent. Asset-heavy businesses (utilities, airlines) naturally run lower.",
  },
  roe: {
    name: "Return on Equity (ROE)",
    plain: "How much profit the company generates on shareholders' invested money.",
    typical: "15%+ is often considered strong — but check it isn't driven mainly by heavy debt.",
  },
  roic: {
    name: "Return on Invested Capital (ROIC)",
    plain: "Returns earned on all the capital (debt and equity) put into the business.",
    typical:
      "Above ~10% and above the company's cost of capital signals genuine value creation. One of the highest-signal quality metrics.",
  },
  debtToEquity: {
    name: "Debt / Equity",
    plain: "How much debt the company uses for every dollar of shareholder equity.",
    typical:
      "Below 1 is fairly conservative. High leverage isn't always bad, but it raises risk in downturns. Varies a lot by industry.",
  },
  currentRatio: {
    name: "Current Ratio",
    plain: "Whether short-term assets can cover short-term bills due within a year.",
    typical: "Above 1 means it can cover near-term obligations; roughly 1.5–3 is comfortable.",
  },
  quickRatio: {
    name: "Quick Ratio",
    plain: "A stricter liquidity test that ignores inventory.",
    typical: "Above 1 is reassuring — it can pay near-term bills without selling inventory.",
  },
  interestCoverage: {
    name: "Interest Coverage",
    plain: "How many times over the company's profit could pay its interest bill.",
    typical: "Above ~3 is comfortable. Below ~1.5 means debt payments are eating most of the profit — a risk.",
  },
  payoutRatio: {
    name: "Payout Ratio",
    plain: "The share of profit paid out to shareholders as dividends.",
    typical:
      "Under ~60% generally leaves room to keep paying and reinvest. Above 100% means it's paying out more than it earns — often unsustainable.",
  },
  enterpriseValue: {
    name: "Enterprise Value",
    plain: "What it would cost to buy the whole company: market cap plus debt, minus cash.",
    typical: "A truer 'takeover price' than market cap alone, since it accounts for the balance sheet.",
  },
};

export function lookupMetric(key: string): GlossaryEntry | undefined {
  return METRIC_GLOSSARY[key];
}
