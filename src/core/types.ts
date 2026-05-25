// ⚠️ Keep in sync with ../../server/src/types.ts (backend copy).
// The backend can't import this file directly because Railway builds it with
// the build context limited to server/, so the two are kept as mirror copies.

export type Ticker = string;

export interface SearchResult {
  symbol: Ticker;
  name: string;
  exchange?: string;
  currency?: string;
}

export interface CompanyProfile {
  symbol: Ticker;
  name: string;
  exchange?: string;
  industry?: string;
  sector?: string;
  description?: string;
  ceo?: string;
  website?: string;
  country?: string;
  employees?: number;
  marketCap?: number;
  price?: number;
  currency?: string;
}

export interface Quote {
  symbol: Ticker;
  price: number;
  change: number;
  changePercent: number;
  dayLow?: number;
  dayHigh?: number;
  yearLow?: number;
  yearHigh?: number;
  volume?: number;
  marketCap?: number;
  pe?: number;
  eps?: number;
}

export type Period = "annual" | "quarter";

export interface IncomeStatement {
  date: string;
  period: Period;
  revenue: number;
  costOfRevenue: number;
  grossProfit: number;
  operatingIncome: number;
  netIncome: number;
  eps: number;
}

export interface BalanceSheet {
  date: string;
  period: Period;
  totalAssets: number;
  totalLiabilities: number;
  totalEquity: number;
  cash: number;
  totalDebt: number;
}

export interface CashFlowStatement {
  date: string;
  period: Period;
  operatingCashFlow: number;
  investingCashFlow: number;
  financingCashFlow: number;
  freeCashFlow: number;
}

export interface Financials {
  income: IncomeStatement[];
  balance: BalanceSheet[];
  cashFlow: CashFlowStatement[];
}

export type HistoryRange = "1d" | "1m" | "6m" | "1y" | "5y";

export interface HistoryPoint {
  /** ISO timestamp; minute-precision for intraday, day for longer ranges. */
  date: string;
  close: number;
}

export interface History {
  range: HistoryRange;
  points: HistoryPoint[];
  currency?: string;
}

export interface NewsItem {
  id: string;
  title: string;
  publisher: string;
  link: string;
  /** ISO timestamp. */
  publishedAt: string;
  thumbnail?: string;
}

export interface ScoreCriterion {
  label: string;
  pass: boolean;
  detail?: string;
}

export interface PiotroskiScore {
  score: number; // 0–9
  criteria: ScoreCriterion[];
}

export interface AltmanComponent {
  label: string;
  value: number; // the underlying ratio
  contribution: number; // weighted contribution to Z
}

export interface AltmanScore {
  z: number;
  zone: "safe" | "grey" | "distress";
  components: AltmanComponent[];
}

export interface CompositeScore {
  score: number; // 0–100
  grade: string; // A+ … F
  breakdown: { label: string; points: number; max: number }[];
}

export interface QualityScores {
  /** ISO date of the latest fiscal year used. */
  asOf?: string;
  piotroski?: PiotroskiScore;
  altman?: AltmanScore;
  composite?: CompositeScore;
  /** True when fundamentals were insufficient to compute. */
  unavailable?: boolean;
}

export interface AIAnalysis {
  summary: string;
  bullCase: string[];
  bearCase: string[];
  /** ISO timestamp of when it was generated. */
  generatedAt: string;
  /** Model used, for transparency. */
  model: string;
}

export interface AIAnswer {
  answer: string;
}

export interface BriefingItem {
  heading: string;
  summary: string;
}

export interface MarketBriefing {
  /** ISO date the briefing covers. */
  date: string;
  headline: string;
  overview: string;
  items: BriefingItem[];
  sources?: { title: string; url: string }[];
  generatedAt: string;
  model: string;
}

export interface Multiples {
  marketCap?: number;
  enterpriseValue?: number;

  pe?: number;
  pegRatio?: number;
  ps?: number;
  pb?: number;
  pfcf?: number;
  pocf?: number;
  evToEbitda?: number;
  evToSales?: number;
  evToFcf?: number;
  earningsYield?: number;
  fcfYield?: number;
  dividendYield?: number;

  grossMargin?: number;
  operatingMargin?: number;
  netMargin?: number;
  ebitdaMargin?: number;
  roa?: number;
  roe?: number;
  roic?: number;

  debtToEquity?: number;
  currentRatio?: number;
  quickRatio?: number;
  interestCoverage?: number;
  payoutRatio?: number;
}
