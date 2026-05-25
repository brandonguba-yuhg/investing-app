import type {
  AltmanScore,
  CompositeScore,
  PiotroskiScore,
  QualityScores,
  ScoreCriterion,
} from "./types.js";

/** The fundamental inputs we need for a single fiscal year. */
export interface FundamentalRow {
  date: string;
  netIncome: number;
  totalAssets: number;
  operatingCashFlow: number;
  longTermDebt: number;
  currentAssets: number;
  currentLiabilities: number;
  grossProfit: number;
  revenue: number;
  ebit: number;
  retainedEarnings: number;
  totalLiabilities: number;
  sharesOutstanding: number;
}

const safeDiv = (a: number, b: number): number | undefined =>
  b !== 0 && Number.isFinite(a) && Number.isFinite(b) ? a / b : undefined;

// ---------- Piotroski F-Score (0–9) ----------

export function computePiotroski(
  curr: FundamentalRow,
  prior: FundamentalRow,
): PiotroskiScore {
  const roaCurr = safeDiv(curr.netIncome, curr.totalAssets);
  const roaPrior = safeDiv(prior.netIncome, prior.totalAssets);
  const ltdRatioCurr = safeDiv(curr.longTermDebt, curr.totalAssets);
  const ltdRatioPrior = safeDiv(prior.longTermDebt, prior.totalAssets);
  const currRatioCurr = safeDiv(curr.currentAssets, curr.currentLiabilities);
  const currRatioPrior = safeDiv(prior.currentAssets, prior.currentLiabilities);
  const gmCurr = safeDiv(curr.grossProfit, curr.revenue);
  const gmPrior = safeDiv(prior.grossProfit, prior.revenue);
  const atCurr = safeDiv(curr.revenue, curr.totalAssets);
  const atPrior = safeDiv(prior.revenue, prior.totalAssets);

  const criteria: ScoreCriterion[] = [
    {
      label: "Positive net income",
      pass: curr.netIncome > 0,
      detail: "Profitable this year",
    },
    {
      label: "Positive operating cash flow",
      pass: curr.operatingCashFlow > 0,
      detail: "Generates cash from operations",
    },
    {
      label: "Rising return on assets",
      pass: roaCurr != null && roaPrior != null && roaCurr > roaPrior,
      detail: "ROA improved vs last year",
    },
    {
      label: "Earnings backed by cash",
      pass: curr.operatingCashFlow > curr.netIncome,
      detail: "Operating cash flow exceeds net income (low accruals)",
    },
    {
      label: "Lower leverage",
      pass: ltdRatioCurr != null && ltdRatioPrior != null && ltdRatioCurr < ltdRatioPrior,
      detail: "Long-term debt ratio decreased",
    },
    {
      label: "Improving liquidity",
      pass: currRatioCurr != null && currRatioPrior != null && currRatioCurr > currRatioPrior,
      detail: "Current ratio increased",
    },
    {
      label: "No share dilution",
      pass: curr.sharesOutstanding <= prior.sharesOutstanding,
      detail: "Shares outstanding did not increase",
    },
    {
      label: "Rising gross margin",
      pass: gmCurr != null && gmPrior != null && gmCurr > gmPrior,
      detail: "Gross margin improved",
    },
    {
      label: "Rising asset turnover",
      pass: atCurr != null && atPrior != null && atCurr > atPrior,
      detail: "Revenue per dollar of assets improved",
    },
  ];

  return { score: criteria.filter((c) => c.pass).length, criteria };
}

// ---------- Altman Z-Score ----------

export function computeAltman(
  curr: FundamentalRow,
  marketCap: number | undefined,
): AltmanScore | undefined {
  const ta = curr.totalAssets;
  if (!ta) return undefined;

  const workingCapital = curr.currentAssets - curr.currentLiabilities;
  const a = workingCapital / ta;
  const b = curr.retainedEarnings / ta;
  const c = curr.ebit / ta;
  const d =
    marketCap && curr.totalLiabilities
      ? marketCap / curr.totalLiabilities
      : 0;
  const e = curr.revenue / ta;

  const components = [
    { label: "Working capital / assets", value: a, contribution: 1.2 * a },
    { label: "Retained earnings / assets", value: b, contribution: 1.4 * b },
    { label: "EBIT / assets", value: c, contribution: 3.3 * c },
    { label: "Mkt equity / liabilities", value: d, contribution: 0.6 * d },
    { label: "Revenue / assets", value: e, contribution: 1.0 * e },
  ];

  const z = components.reduce((sum, comp) => sum + comp.contribution, 0);
  const zone: AltmanScore["zone"] = z > 2.99 ? "safe" : z >= 1.81 ? "grey" : "distress";

  return { z, zone, components };
}

// ---------- Composite quality rating (0–100) ----------

export function computeComposite(
  curr: FundamentalRow,
  piotroski: PiotroskiScore,
  altman: AltmanScore | undefined,
): CompositeScore {
  // Financial strength from Piotroski (0–45).
  const piotroskiPts = Math.round((piotroski.score / 9) * 45);

  // Bankruptcy safety from Altman zone (0–25).
  const altmanPts =
    altman == null ? 12 : altman.zone === "safe" ? 25 : altman.zone === "grey" ? 13 : 0;

  // Profitability (0–30): net margin + ROE thresholds.
  const netMargin = safeDiv(curr.netIncome, curr.revenue) ?? 0;
  const equity = curr.totalAssets - curr.totalLiabilities;
  const roe = safeDiv(curr.netIncome, equity) ?? 0;
  let profitPts = 0;
  if (netMargin > 0) profitPts += 5;
  if (netMargin > 0.1) profitPts += 5;
  if (netMargin > 0.2) profitPts += 5;
  if (roe > 0.1) profitPts += 5;
  if (roe > 0.2) profitPts += 5;
  if (curr.operatingCashFlow > 0) profitPts += 5;

  const score = Math.max(0, Math.min(100, piotroskiPts + altmanPts + profitPts));
  const grade = toGrade(score);

  return {
    score,
    grade,
    breakdown: [
      { label: "Financial strength (Piotroski)", points: piotroskiPts, max: 45 },
      { label: "Bankruptcy safety (Altman)", points: altmanPts, max: 25 },
      { label: "Profitability", points: profitPts, max: 30 },
    ],
  };
}

function toGrade(score: number): string {
  if (score >= 90) return "A+";
  if (score >= 80) return "A";
  if (score >= 70) return "B";
  if (score >= 60) return "C";
  if (score >= 50) return "D";
  return "F";
}

// ---------- top-level assembly ----------

export function computeScores(
  curr: FundamentalRow | undefined,
  prior: FundamentalRow | undefined,
  marketCap: number | undefined,
): QualityScores {
  if (!curr || !prior) return { unavailable: true };
  const piotroski = computePiotroski(curr, prior);
  const altman = computeAltman(curr, marketCap);
  const composite = computeComposite(curr, piotroski, altman);
  return { asOf: curr.date, piotroski, altman, composite };
}
