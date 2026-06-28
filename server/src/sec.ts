// SEC EDGAR client — final fallback in the data chain, after Yahoo and FMP.
//
// Why it exists: FMP's free tier only serves a whitelist of popular symbols and
// returns 402 for everything else (MU, and many mid-caps). Yahoo is IP-blocked
// on Railway. That left arbitrary US tickers with NO source for financials,
// scores, or multiples in production. SEC EDGAR's XBRL `companyfacts` API is
// free, keyless, unlimited (with a proper User-Agent), and covers every US
// filer's 10-K / 10-Q line items — so it backstops exactly those gaps.
//
// What it serves: getFinancials (annual + quarterly), getScores (via the shared
// computeScores), getMultiples (derived from the latest annual 10-K + a live
// price passed in by the caller). It has NO price history, quotes, or news —
// those stay with Yahoo / Twelve Data.
//
// Mechanics & limits: SEC requires a descriptive User-Agent with contact info
// (requests without one are 403'd) and asks callers to stay under ~10 req/sec.
// The companyfacts JSON is large (several MB for big filers), so both the
// ticker→CIK map and the per-company facts blob are cached hard (24h) — one
// fetch then serves financials + scores + multiples for that symbol.

import { cache, TTL } from "./cache.js";
import { computeScores, type FundamentalRow } from "./scores.js";
import type {
  BalanceSheet,
  CashFlowStatement,
  Financials,
  IncomeStatement,
  Multiples,
  Period,
  QualityScores,
  Ticker,
} from "./types.js";

const TICKERS_URL = "https://www.sec.gov/files/company_tickers.json";
const FACTS_BASE = "https://data.sec.gov/api/xbrl/companyfacts";

// SEC blocks requests without a descriptive UA naming a contact. Override via
// env if desired, but the default identifies the app and a reachable address.
const USER_AGENT =
  process.env.SEC_USER_AGENT || "voyance-investing-app (brandon.guba@gmail.com)";

// No API key required — EDGAR is open data. Always available as a backstop.
export function secEnabled(): boolean {
  return true;
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, {
    headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
  });
  if (!res.ok) {
    throw new Error(`SEC request failed (${res.status}): ${res.statusText} — ${url}`);
  }
  return (await res.json()) as T;
}

// ---------- ticker → CIK resolution ----------

// company_tickers.json is a positional object: {"0":{cik_str,ticker,title},...}
interface TickerRow {
  cik_str: number;
  ticker: string;
  title: string;
}

async function getCikMap(): Promise<Map<string, string>> {
  return cache.wrap("sec:cikmap", TTL.search, async () => {
    const raw = await fetchJson<Record<string, TickerRow>>(TICKERS_URL);
    const map = new Map<string, string>();
    for (const row of Object.values(raw)) {
      if (!row?.ticker || row.cik_str == null) continue;
      // CIK must be zero-padded to 10 digits for the companyfacts URL.
      map.set(row.ticker.toUpperCase(), String(row.cik_str).padStart(10, "0"));
    }
    return map;
  });
}

async function resolveCik(symbol: Ticker): Promise<string> {
  const map = await getCikMap();
  // EDGAR uses dashes where some feeds use dots (BRK.B → BRK-B).
  const candidates = [symbol.toUpperCase(), symbol.toUpperCase().replace(/\./g, "-")];
  for (const c of candidates) {
    const cik = map.get(c);
    if (cik) return cik;
  }
  throw new Error(`SEC: no CIK for ${symbol}`);
}

// ---------- companyfacts ----------

interface FactEntry {
  start?: string;
  end: string;
  val: number;
  fy?: number;
  fp?: string;
  form?: string;
  filed?: string;
  frame?: string;
}

interface CompanyFacts {
  facts?: {
    "us-gaap"?: Record<string, { units?: Record<string, FactEntry[]> }>;
    dei?: Record<string, { units?: Record<string, FactEntry[]> }>;
  };
}

async function getFacts(symbol: Ticker): Promise<CompanyFacts> {
  const cik = await resolveCik(symbol);
  return cache.wrap(`sec:facts:${cik}`, TTL.financials, () =>
    fetchJson<CompanyFacts>(`${FACTS_BASE}/CIK${cik}.json`),
  );
}

// ---------- concept extraction helpers ----------

const DAY = 24 * 60 * 60 * 1000;
function daysBetween(a: string, b: string): number {
  return Math.abs(new Date(b).getTime() - new Date(a).getTime()) / DAY;
}

function dei(facts: CompanyFacts, names: readonly string[], unit = "shares"): FactEntry[] {
  for (const name of names) {
    const u = facts.facts?.dei?.[name]?.units?.[unit];
    if (Array.isArray(u) && u.length) return u;
  }
  return [];
}

/** Keep the most recently filed value for each key (handles restatements). */
function keepLatest(entries: FactEntry[], key: (e: FactEntry) => string): Map<string, number> {
  const byKey = new Map<string, { val: number; filed: string }>();
  for (const e of entries) {
    const k = key(e);
    const filed = e.filed ?? "";
    const prev = byKey.get(k);
    if (!prev || filed > prev.filed) byKey.set(k, { val: e.val, filed });
  }
  return new Map([...byKey].map(([k, v]) => [k, v.val]));
}

/** Full-fiscal-year flow values (income/cash-flow) from 10-K filings, by end date. */
function annualFlows(entries: FactEntry[]): Map<string, number> {
  const full = entries.filter(
    (e) =>
      e.start != null &&
      e.form?.startsWith("10-K") &&
      daysBetween(e.start, e.end) >= 350 &&
      daysBetween(e.start, e.end) <= 380,
  );
  return keepLatest(full, (e) => e.end);
}

/** Fiscal-year-end balance values (instant concepts) from 10-K filings, by end date. */
function annualInstants(entries: FactEntry[]): Map<string, number> {
  const instants = entries.filter(
    (e) => e.form?.startsWith("10-K") && (!e.start || daysBetween(e.start, e.end) <= 5),
  );
  return keepLatest(instants, (e) => e.end);
}

/** Discrete (~one-quarter) flow values from 10-Q filings, by end date. */
function quarterFlows(entries: FactEntry[]): Map<string, number> {
  const q = entries.filter(
    (e) => e.start != null && daysBetween(e.start, e.end) >= 80 && daysBetween(e.start, e.end) <= 100,
  );
  return keepLatest(q, (e) => e.end);
}

/** Balance values at each quarter end (instant), any form, by end date. */
function quarterInstants(entries: FactEntry[]): Map<string, number> {
  const instants = entries.filter((e) => !e.start || daysBetween(e.start, e.end) <= 5);
  return keepLatest(instants, (e) => e.end);
}

/**
 * Cash-flow statements in 10-Qs are cumulative year-to-date, so the discrete
 * quarter is the YTD difference within a fiscal year. Group by period start,
 * walk ends ascending, and emit each step whose incremental span is ~a quarter
 * (this also yields Q4 from the 10-K's full-year figure, which shares the start).
 */
function quarterFromYtd(entries: FactEntry[]): Map<string, number> {
  const latest = new Map<string, { start: string; end: string; val: number; filed: string }>();
  for (const e of entries) {
    if (!e.start) continue;
    const k = `${e.start}|${e.end}`;
    const filed = e.filed ?? "";
    const prev = latest.get(k);
    if (!prev || filed > prev.filed) latest.set(k, { start: e.start, end: e.end, val: e.val, filed });
  }
  const groups = new Map<string, Array<{ end: string; val: number }>>();
  for (const v of latest.values()) {
    const arr = groups.get(v.start) ?? [];
    arr.push({ end: v.end, val: v.val });
    groups.set(v.start, arr);
  }
  const out = new Map<string, number>();
  for (const [start, arr] of groups) {
    arr.sort((a, b) => a.end.localeCompare(b.end));
    let prevEnd = start;
    let prevVal = 0;
    for (const item of arr) {
      const span = daysBetween(prevEnd, item.end);
      if (span >= 80 && span <= 100) out.set(item.end, item.val - prevVal);
      prevEnd = item.end;
      prevVal = item.val;
    }
  }
  return out;
}

/**
 * Add a derived Q4 to a discrete-quarter map: Q4 = full year − (Q1+Q2+Q3).
 * Only emitted when exactly three prior quarters sit inside the fiscal year.
 */
function withDerivedQ4(quarters: Map<string, number>, annual: Map<string, number>): Map<string, number> {
  const out = new Map(quarters);
  for (const [fyEnd, annualVal] of annual) {
    if (out.has(fyEnd)) continue;
    const priorQuarters = [...quarters.keys()]
      .filter((e) => e < fyEnd && daysBetween(e, fyEnd) <= 300)
      .sort((a, b) => b.localeCompare(a))
      .slice(0, 3);
    if (priorQuarters.length === 3) {
      const sum = priorQuarters.reduce((s, e) => s + (quarters.get(e) ?? 0), 0);
      out.set(fyEnd, annualVal - sum);
    }
  }
  return out;
}

function endsDesc(map: Map<string, number>): string[] {
  return [...map.keys()].sort((a, b) => b.localeCompare(a));
}

/**
 * Extract a metric across all of its concept aliases and merge per fiscal-period
 * end date, with EARLIER aliases winning. Picking one concept wholesale breaks
 * when a company switches XBRL tags over time (RH moved from
 * RevenueFromContract…Excluding to …Including; REITs report under Revenues), so
 * a stale-but-non-empty first alias would otherwise shadow the current one.
 */
function merge(
  facts: CompanyFacts,
  names: readonly string[],
  unit: string,
  extract: (entries: FactEntry[]) => Map<string, number>,
): Map<string, number> {
  const out = new Map<string, number>();
  for (const name of names) {
    const u = facts.facts?.["us-gaap"]?.[name]?.units?.[unit];
    if (!Array.isArray(u) || !u.length) continue;
    for (const [end, val] of extract(u)) if (!out.has(end)) out.set(end, val);
  }
  return out;
}

const aFlows = (f: CompanyFacts, n: readonly string[], u = "USD") => merge(f, n, u, annualFlows);
const aInst = (f: CompanyFacts, n: readonly string[]) => merge(f, n, "USD", annualInstants);
const qFlows = (f: CompanyFacts, n: readonly string[], u = "USD") => merge(f, n, u, quarterFlows);
const qInst = (f: CompanyFacts, n: readonly string[]) => merge(f, n, "USD", quarterInstants);
const qYtd = (f: CompanyFacts, n: readonly string[], u = "USD") => merge(f, n, u, quarterFromYtd);

// us-gaap concept aliases (companies tag the same line under different names).
const C = {
  revenue: [
    "RevenueFromContractWithCustomerExcludingAssessedTax",
    "Revenues",
    "SalesRevenueNet",
    // tax-inclusive only as a fallback (slightly overstates by sales tax)
    "RevenueFromContractWithCustomerIncludingAssessedTax",
    // REIT lease income, for filers that report no contract/Revenues total
    "LeaseIncome",
    "RealEstateRevenueNet",
  ],
  cost: ["CostOfRevenue", "CostOfGoodsAndServicesSold", "CostOfGoodsSold"],
  gross: ["GrossProfit"],
  operatingIncome: ["OperatingIncomeLoss"],
  netIncome: ["NetIncomeLoss", "ProfitLoss"],
  eps: ["EarningsPerShareDiluted", "EarningsPerShareBasic"],
  ocf: [
    "NetCashProvidedByUsedInOperatingActivities",
    "NetCashProvidedByUsedInOperatingActivitiesContinuingOperations",
  ],
  icf: [
    "NetCashProvidedByUsedInInvestingActivities",
    "NetCashProvidedByUsedInInvestingActivitiesContinuingOperations",
  ],
  fcf: [
    "NetCashProvidedByUsedInFinancingActivities",
    "NetCashProvidedByUsedInFinancingActivitiesContinuingOperations",
  ],
  capex: ["PaymentsToAcquirePropertyPlantAndEquipment", "PaymentsToAcquireProductiveAssets"],
  assets: ["Assets"],
  liabilities: ["Liabilities"],
  equity: [
    "StockholdersEquity",
    "StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest",
  ],
  cash: [
    "CashAndCashEquivalentsAtCarryingValue",
    "CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents",
    "CashAndDueFromBanks",
  ],
  currentAssets: ["AssetsCurrent"],
  currentLiabilities: ["LiabilitiesCurrent"],
  retainedEarnings: ["RetainedEarningsAccumulatedDeficit"],
  longTermDebt: ["LongTermDebtNoncurrent", "LongTermDebt"],
  shortTermDebt: ["DebtCurrent", "LongTermDebtCurrent", "ShortTermBorrowings"],
  sharesDiluted: ["WeightedAverageNumberOfDilutedSharesOutstanding"],
  sharesBasic: [
    "WeightedAverageNumberOfSharesOutstandingBasic",
    "WeightedAverageNumberOfShareOutstandingBasicAndDiluted",
  ],
  depAmort: [
    "DepreciationDepletionAndAmortization",
    "DepreciationAmortizationAndAccretionNet",
    "DepreciationAndAmortization",
  ],
  interestExpense: ["InterestExpense", "InterestExpenseDebt"],
} as const;

const pick = (map: Map<string, number>, end: string): number => map.get(end) ?? 0;

/** Gross profit, honest about missing tags: use the tag, derive from cost, else 0. */
function grossAt(end: string, rev: number, gross: Map<string, number>, cost: Map<string, number>): number {
  if (gross.has(end)) return pick(gross, end);
  if (cost.has(end)) return rev - pick(cost, end);
  return 0; // neither tagged — leave 0 rather than implying 100% margin
}

/** Cost of revenue, mirror of grossAt: tag, derive from gross, else 0. */
function costAt(end: string, rev: number, grossVal: number, gross: Map<string, number>, cost: Map<string, number>): number {
  if (cost.has(end)) return pick(cost, end);
  if (gross.has(end)) return rev - grossVal;
  return 0;
}

/** Total liabilities, falling back to assets − equity when no `Liabilities` total is tagged. */
function liabAt(end: string, assets: Map<string, number>, liabilities: Map<string, number>, equity: Map<string, number>): number {
  return liabilities.has(end) ? pick(liabilities, end) : pick(assets, end) - pick(equity, end);
}

/** EPS, falling back to netIncome / diluted shares when EPS isn't tagged (e.g. ABNB). */
function epsAt(end: string, netIncome: number, eps: Map<string, number>, sharesCount: number): number {
  if (eps.has(end)) return pick(eps, end);
  return sharesCount ? netIncome / sharesCount : 0;
}

// ---------- financials ----------

function annualFinancials(facts: CompanyFacts, limit: number): Financials {
  const revenue = aFlows(facts, C.revenue);
  const cost = aFlows(facts, C.cost);
  const gross = aFlows(facts, C.gross);
  const operatingIncome = aFlows(facts, C.operatingIncome);
  const netIncome = aFlows(facts, C.netIncome);
  const eps = aFlows(facts, C.eps, "USD/shares");
  const shares = aFlows(facts, C.sharesDiluted, "shares");
  const sharesBasic = aFlows(facts, C.sharesBasic, "shares");

  const assets = aInst(facts, C.assets);
  const liabilities = aInst(facts, C.liabilities);
  const equity = aInst(facts, C.equity);
  const cash = aInst(facts, C.cash);
  const longTermDebt = aInst(facts, C.longTermDebt);
  const shortTermDebt = aInst(facts, C.shortTermDebt);

  const ocf = aFlows(facts, C.ocf);
  const icf = aFlows(facts, C.icf);
  const fcfFinancing = aFlows(facts, C.fcf);
  const capex = aFlows(facts, C.capex);

  const dilutedShares = (end: string): number => shares.get(end) ?? sharesBasic.get(end) ?? 0;

  const income: IncomeStatement[] = endsDesc(netIncome)
    .slice(0, limit)
    .map((end) => {
      const rev = pick(revenue, end);
      const ni = pick(netIncome, end);
      const grossVal = grossAt(end, rev, gross, cost);
      return {
        date: end,
        period: "annual" as Period,
        revenue: rev,
        costOfRevenue: costAt(end, rev, grossVal, gross, cost),
        grossProfit: grossVal,
        operatingIncome: pick(operatingIncome, end),
        netIncome: ni,
        eps: epsAt(end, ni, eps, dilutedShares(end)),
      };
    });

  const balance: BalanceSheet[] = endsDesc(assets)
    .slice(0, limit)
    .map((end) => ({
      date: end,
      period: "annual" as Period,
      totalAssets: pick(assets, end),
      totalLiabilities: liabAt(end, assets, liabilities, equity),
      totalEquity: pick(equity, end),
      cash: pick(cash, end),
      totalDebt: pick(longTermDebt, end) + pick(shortTermDebt, end),
    }));

  const cashFlow: CashFlowStatement[] = endsDesc(ocf)
    .slice(0, limit)
    .map((end) => {
      const op = pick(ocf, end);
      return {
        date: end,
        period: "annual" as Period,
        operatingCashFlow: op,
        investingCashFlow: pick(icf, end),
        financingCashFlow: pick(fcfFinancing, end),
        freeCashFlow: op - pick(capex, end),
      };
    });

  if (income.length === 0 && balance.length === 0) {
    throw new Error("SEC: no annual financials");
  }
  return { income, balance, cashFlow };
}

function quarterlyFinancials(facts: CompanyFacts, limit: number): Financials {
  const revenue = withDerivedQ4(qFlows(facts, C.revenue), aFlows(facts, C.revenue));
  const cost = withDerivedQ4(qFlows(facts, C.cost), aFlows(facts, C.cost));
  const gross = withDerivedQ4(qFlows(facts, C.gross), aFlows(facts, C.gross));
  const operatingIncome = withDerivedQ4(qFlows(facts, C.operatingIncome), aFlows(facts, C.operatingIncome));
  const netIncome = withDerivedQ4(qFlows(facts, C.netIncome), aFlows(facts, C.netIncome));
  const eps = withDerivedQ4(qFlows(facts, C.eps, "USD/shares"), aFlows(facts, C.eps, "USD/shares"));
  // Share counts aren't additive, so no Q4 derivation — used only for EPS fallback.
  const shares = qFlows(facts, C.sharesDiluted, "shares");
  const sharesBasic = qFlows(facts, C.sharesBasic, "shares");

  const assets = qInst(facts, C.assets);
  const liabilities = qInst(facts, C.liabilities);
  const equity = qInst(facts, C.equity);
  const cash = qInst(facts, C.cash);
  const longTermDebt = qInst(facts, C.longTermDebt);
  const shortTermDebt = qInst(facts, C.shortTermDebt);

  // Cash flows are YTD in 10-Qs → difference to discrete quarters.
  const ocf = qYtd(facts, C.ocf);
  const icf = qYtd(facts, C.icf);
  const fcfFinancing = qYtd(facts, C.fcf);
  const capex = qYtd(facts, C.capex);

  const income: IncomeStatement[] = endsDesc(netIncome)
    .slice(0, limit)
    .map((end) => {
      const rev = pick(revenue, end);
      const ni = pick(netIncome, end);
      const grossVal = grossAt(end, rev, gross, cost);
      return {
        date: end,
        period: "quarter" as Period,
        revenue: rev,
        costOfRevenue: costAt(end, rev, grossVal, gross, cost),
        grossProfit: grossVal,
        operatingIncome: pick(operatingIncome, end),
        netIncome: ni,
        eps: epsAt(end, ni, eps, shares.get(end) ?? sharesBasic.get(end) ?? 0),
      };
    });

  const balance: BalanceSheet[] = endsDesc(assets)
    .slice(0, limit)
    .map((end) => ({
      date: end,
      period: "quarter" as Period,
      totalAssets: pick(assets, end),
      totalLiabilities: liabAt(end, assets, liabilities, equity),
      totalEquity: pick(equity, end),
      cash: pick(cash, end),
      totalDebt: pick(longTermDebt, end) + pick(shortTermDebt, end),
    }));

  const cashFlow: CashFlowStatement[] = endsDesc(ocf)
    .slice(0, limit)
    .map((end) => {
      const op = pick(ocf, end);
      return {
        date: end,
        period: "quarter" as Period,
        operatingCashFlow: op,
        investingCashFlow: pick(icf, end),
        financingCashFlow: pick(fcfFinancing, end),
        freeCashFlow: op - pick(capex, end),
      };
    });

  if (income.length === 0 && balance.length === 0) {
    throw new Error("SEC: no quarterly financials");
  }
  return { income, balance, cashFlow };
}

export async function getFinancials(symbol: Ticker, period: Period, limit = 5): Promise<Financials> {
  const facts = await getFacts(symbol);
  return period === "quarter"
    ? quarterlyFinancials(facts, limit)
    : annualFinancials(facts, limit);
}

// ---------- scores ----------

/**
 * Latest common shares outstanding, from the DEI cover-page count, falling back
 * to the most recent weighted-average diluted share count. Used to turn a live
 * price into a market cap (SEC has no prices of its own).
 */
function latestSharesOutstanding(facts: CompanyFacts): number | undefined {
  const fromDei = [...keepLatest(dei(facts, ["EntityCommonStockSharesOutstanding"]), (e) => e.end).entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))[0]?.[1];
  if (fromDei) return fromDei;
  const diluted = aFlows(facts, C.sharesDiluted, "shares");
  const latest = endsDesc(diluted)[0];
  return latest ? diluted.get(latest) : undefined;
}

export async function getScores(symbol: Ticker, price?: number): Promise<QualityScores> {
  const facts = await getFacts(symbol);

  const netIncome = aFlows(facts, C.netIncome);
  const revenue = aFlows(facts, C.revenue);
  const gross = aFlows(facts, C.gross);
  const operatingIncome = aFlows(facts, C.operatingIncome);
  const ocf = aFlows(facts, C.ocf);
  const shares = aFlows(facts, C.sharesDiluted, "shares");
  const sharesBasic = aFlows(facts, C.sharesBasic, "shares");

  const assets = aInst(facts, C.assets);
  const liabilities = aInst(facts, C.liabilities);
  const equity = aInst(facts, C.equity);
  const currentAssets = aInst(facts, C.currentAssets);
  const currentLiabilities = aInst(facts, C.currentLiabilities);
  const retainedEarnings = aInst(facts, C.retainedEarnings);
  const longTermDebt = aInst(facts, C.longTermDebt);

  // Need two consecutive fiscal years (current + prior) for Piotroski trends.
  const years = endsDesc(netIncome).filter((e) => assets.has(e));
  const toRow = (end: string | undefined): FundamentalRow | undefined => {
    if (!end) return undefined;
    return {
      date: end,
      netIncome: pick(netIncome, end),
      totalAssets: pick(assets, end),
      operatingCashFlow: pick(ocf, end),
      longTermDebt: pick(longTermDebt, end),
      currentAssets: pick(currentAssets, end),
      currentLiabilities: pick(currentLiabilities, end),
      grossProfit: pick(gross, end),
      revenue: pick(revenue, end),
      ebit: pick(operatingIncome, end),
      retainedEarnings: pick(retainedEarnings, end),
      totalLiabilities: liabAt(end, assets, liabilities, equity),
      sharesOutstanding: shares.get(end) ?? sharesBasic.get(end) ?? 0,
    };
  };

  // Turn the caller's live price into a market cap for Altman's market-equity
  // term; without a price it stays undefined and Altman is mildly conservative.
  const sharesOut = latestSharesOutstanding(facts);
  const marketCap = price != null && sharesOut ? price * sharesOut : undefined;
  return computeScores(toRow(years[0]), toRow(years[1]), marketCap);
}

// ---------- multiples ----------

/**
 * Multiples derived from the latest annual 10-K plus a live price supplied by
 * the caller (SEC has no prices). TTM-only ratios that need analyst estimates
 * or finer data (PEG, dividend yield, payout, ROIC, quick ratio) are left
 * undefined rather than approximated badly.
 */
export async function getMultiples(symbol: Ticker, price?: number): Promise<Multiples> {
  const facts = await getFacts(symbol);

  const revenue = aFlows(facts, C.revenue);
  const gross = aFlows(facts, C.gross);
  const cost = aFlows(facts, C.cost);
  const operatingIncome = aFlows(facts, C.operatingIncome);
  const netIncome = aFlows(facts, C.netIncome);
  const ocf = aFlows(facts, C.ocf);
  const capex = aFlows(facts, C.capex);
  const depAmort = aFlows(facts, C.depAmort);
  const interestExpense = aFlows(facts, C.interestExpense);

  const assets = aInst(facts, C.assets);
  const equity = aInst(facts, C.equity);
  const cash = aInst(facts, C.cash);
  const longTermDebt = aInst(facts, C.longTermDebt);
  const shortTermDebt = aInst(facts, C.shortTermDebt);

  const fy = endsDesc(netIncome).find((e) => assets.has(e));
  if (!fy) throw new Error("SEC: insufficient data for multiples");

  const sharesOut = latestSharesOutstanding(facts);

  const rev = pick(revenue, fy);
  const ni = pick(netIncome, fy);
  const eq = pick(equity, fy);
  const ta = pick(assets, fy);
  const totalDebt = pick(longTermDebt, fy) + pick(shortTermDebt, fy);
  const op = pick(ocf, fy);
  const fcf = op - pick(capex, fy);

  // Some filers don't tag gross profit or operating income (ORCL, banks). Where
  // a line is absent, leave the dependent ratio undefined rather than fabricate it.
  const hasGross = gross.has(fy) || cost.has(fy);
  const grossVal = grossAt(fy, rev, gross, cost);
  const hasEbit = operatingIncome.has(fy);
  const ebit = pick(operatingIncome, fy);
  const ebitda = ebit + pick(depAmort, fy);

  const marketCap = price != null && sharesOut ? price * sharesOut : undefined;
  const ev = marketCap != null ? marketCap + totalDebt - pick(cash, fy) : undefined;
  const div = (a: number, b: number): number | undefined =>
    b !== 0 && Number.isFinite(a) && Number.isFinite(b) ? a / b : undefined;

  return {
    marketCap,
    enterpriseValue: ev,
    // P/E = marketCap / net income (equivalent to price / EPS, but works even
    // when EPS isn't tagged, e.g. ABNB).
    pe: marketCap != null && ni > 0 ? div(marketCap, ni) : undefined,
    ps: marketCap != null ? div(marketCap, rev) : undefined,
    pb: marketCap != null ? div(marketCap, eq) : undefined,
    pfcf: marketCap != null ? div(marketCap, fcf) : undefined,
    pocf: marketCap != null ? div(marketCap, op) : undefined,
    evToEbitda: ev != null && hasEbit ? div(ev, ebitda) : undefined,
    evToSales: ev != null ? div(ev, rev) : undefined,
    evToFcf: ev != null ? div(ev, fcf) : undefined,
    earningsYield: marketCap != null ? div(ni, marketCap) : undefined,
    fcfYield: marketCap != null ? div(fcf, marketCap) : undefined,
    grossMargin: hasGross ? div(grossVal, rev) : undefined,
    operatingMargin: hasEbit ? div(ebit, rev) : undefined,
    netMargin: div(ni, rev),
    ebitdaMargin: hasEbit ? div(ebitda, rev) : undefined,
    roa: div(ni, ta),
    roe: div(ni, eq),
    debtToEquity: div(totalDebt, eq),
    interestCoverage: hasEbit ? div(ebit, pick(interestExpense, fy)) : undefined,
  };
}
