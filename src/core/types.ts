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
  /** The article this item is based on. */
  url?: string;
}

/**
 * A single quoted market level. Every one must carry its own citation — the
 * freshness gate rejects the whole brief if a level has no source_url.
 */
export interface BriefingLevel {
  value: number;
  change_pct: number | null;
  source_url: string;
}

/**
 * The structured, gate-validated payload the model produced. Kept alongside
 * the client-facing fields (headline/overview/items) so future UI can render
 * the levels table, source-per-driver, etc. Absent on legacy briefs loaded
 * from disk before the freshness gate was wired in.
 */
export interface BriefingPayload {
  session_date: string;         // YYYY-MM-DD, the trading session described
  latest_source_date: string;   // YYYY-MM-DD, newest date seen in any source
  headline: string;
  summary: string;
  levels: {
    spx: BriefingLevel;
    ndx: BriefingLevel;
    dji: BriefingLevel;
    vix?: BriefingLevel;
    ust10y?: BriefingLevel;
  };
  drivers: Array<{ title: string; detail: string; source_url: string }>;
  ahead: Array<{ when: string; event: string; why: string }>;
}

export interface MarketBriefing {
  /** ISO date the briefing covers (matches payload.session_date when payload is set). */
  date: string;
  headline: string;
  overview: string;
  items: BriefingItem[];
  sources?: { title: string; url: string }[];
  generatedAt: string;
  model: string;
  /**
   * True when today's briefing isn't ready yet and is being generated in the
   * background. The other fields are empty placeholders; the client should show
   * a "preparing" state and retry shortly.
   */
  preparing?: boolean;
  /** Structured gate-validated payload; absent on legacy disk-loaded briefs. */
  payload?: BriefingPayload;
}

export type EventCategory = "macro" | "earnings";

export interface UpcomingEvent {
  /** YYYY-MM-DD — the day the market reacts to this event. */
  date: string;
  title: string;
  category: EventCategory;
  importance: "high" | "medium" | "low";
  /** Short context line, e.g. "May 2026 data · 8:30 AM ET" or "EPS est. 5.83". */
  detail?: string;
  /** Ticker, for earnings events. */
  symbol?: string;
}

export interface UpcomingEvents {
  /** ISO timestamp of when the list was assembled. */
  generatedAt: string;
  events: UpcomingEvent[];
}

export interface DividendPayment {
  /** Ex-dividend date (YYYY-MM-DD) — own the stock before this to get paid. */
  exDate: string;
  /** When the cash actually lands (YYYY-MM-DD), when known. */
  paymentDate?: string;
  /** Dividend per share for this payment. */
  amount: number;
}

export interface DividendInfo {
  symbol: Ticker;
  /** False when the company doesn't currently pay a dividend. */
  paysDividend: boolean;
  /** "Quarterly", "Monthly", "Annual", etc. when known. */
  frequency?: string;
  /** Per-share dividend annualized at the current run-rate (latest × frequency). */
  forwardAnnual?: number;
  /** Per-share dividends actually paid over the trailing 12 months. */
  ttmDividend?: number;
  /** Most recent ex-dividend date (YYYY-MM-DD). */
  lastExDate?: string;
  /** Most recent payment date (YYYY-MM-DD). */
  lastPaymentDate?: string;
  /** Next ex-dividend date (YYYY-MM-DD) when a future one has been declared. */
  nextExDate?: string;
  /** Recent payments, most recent first. */
  history: DividendPayment[];
}

// ---------- investor profile & position analysis ----------

export type RiskTolerance = "conservative" | "balanced" | "aggressive";
export type InvestmentHorizon = "short" | "medium" | "long";
export type InvestmentFocus = "income" | "growth" | "mixed";
export type DiversificationStyle = "concentrated" | "balanced" | "diversified";

/** The user's stated preferences from onboarding; shapes AI framing and flags. */
export interface InvestorProfile {
  riskTolerance: RiskTolerance;
  horizon: InvestmentHorizon;
  focus: InvestmentFocus;
  diversification: DiversificationStyle;
  /** Sectors the user wants to lean into. Empty = no preference. */
  preferredSectors: string[];
  createdAt: string;
  updatedAt?: string;
}

/** One holding's weight, sent as context for position analysis. */
export interface PortfolioPosition {
  symbol: Ticker;
  weightPct: number;
  sector?: string;
}

/** AI assessment of a single position in the context of the whole portfolio. */
export interface PositionAnalysis {
  symbol: Ticker;
  summary: string;
  bullCase: string[];
  bearCase: string[];
  riskLevel: "low" | "moderate" | "elevated" | "high";
  /** How the position fits the user's stated profile. */
  fitNotes: string;
  /** Effect on portfolio concentration / diversification. */
  portfolioImpact: string;
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
