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
