import { cache, TTL } from "./cache.js";
import { getDividends as fetchDividends, type DividendRaw } from "./fmp.js";
import type { DividendInfo, DividendPayment, Ticker } from "./types.js";

const DAY_MS = 86_400_000;
// If the most recent payment is older than this, treat the company as no longer
// paying a dividend (e.g. it was cut) rather than projecting stale income.
const STALE_DAYS = 540;

const FREQUENCY_MULTIPLIER: Record<string, number> = {
  annual: 1,
  "semi-annual": 2,
  semiannual: 2,
  quarterly: 4,
  "bi-monthly": 6,
  monthly: 12,
  weekly: 52,
};

function amountOf(r: DividendRaw): number {
  const v = r.dividend ?? r.adjDividend ?? 0;
  return Number.isFinite(v) && v > 0 ? v : 0;
}

/**
 * Turn FMP's raw dividend history into a digestible summary: current run-rate,
 * trailing-twelve-month total, last/next ex-dates, and recent payments.
 *
 * Pure given its input, so it's easy to reason about and test.
 */
export function computeDividendInfo(
  symbol: Ticker,
  raw: DividendRaw[],
  today: Date = new Date(),
): DividendInfo {
  const rows = (raw ?? [])
    .filter((r) => r.date && amountOf(r) > 0)
    .map((r) => ({
      exDate: r.date as string,
      paymentDate: r.paymentDate || undefined,
      amount: amountOf(r),
      frequency: r.frequency?.trim() || undefined,
    }))
    .sort((a, b) => (a.exDate < b.exDate ? 1 : -1)); // newest first

  if (rows.length === 0) {
    return { symbol, paysDividend: false, history: [] };
  }

  const todayStr = today.toISOString().slice(0, 10);
  const past = rows.filter((r) => r.exDate <= todayStr);
  const future = rows.filter((r) => r.exDate > todayStr);
  const latest = past[0] ?? rows[0];

  // Trailing-twelve-month dividends actually paid.
  const yearAgo = new Date(today.getTime() - 365 * DAY_MS).toISOString().slice(0, 10);
  const ttmRows = past.filter((r) => r.exDate >= yearAgo);
  const ttmDividend = ttmRows.reduce((s, r) => s + r.amount, 0);

  // Annualize the latest payment by its stated frequency, falling back to how
  // many payments actually landed in the trailing year.
  const freqKey = latest.frequency?.toLowerCase();
  const mult =
    (freqKey && FREQUENCY_MULTIPLIER[freqKey]) || Math.max(ttmRows.length, 1);
  const forwardAnnual = latest.amount * mult;

  // Is the dividend still live? If the last payment is ancient, don't project.
  const lastExMs = new Date(`${latest.exDate}T00:00:00Z`).getTime();
  const paysDividend = today.getTime() - lastExMs <= STALE_DAYS * DAY_MS;

  const history: DividendPayment[] = rows.slice(0, 8).map((r) => ({
    exDate: r.exDate,
    paymentDate: r.paymentDate,
    amount: r.amount,
  }));

  return {
    symbol,
    paysDividend,
    frequency: latest.frequency,
    forwardAnnual: paysDividend ? forwardAnnual : undefined,
    ttmDividend: paysDividend ? ttmDividend : undefined,
    lastExDate: latest.exDate,
    lastPaymentDate: latest.paymentDate,
    nextExDate: future.length ? future[future.length - 1].exDate : undefined,
    history,
  };
}

export async function getDividendInfo(symbol: Ticker): Promise<DividendInfo> {
  return cache.wrap(`dividends:${symbol}`, TTL.dividends, async () => {
    const raw = await fetchDividends(symbol);
    return computeDividendInfo(symbol, raw);
  });
}
