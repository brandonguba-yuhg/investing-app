import type { Quote } from "./types";
import type { WatchlistEntry } from "./watchlist";

export interface PositionStats {
  /** Total cost paid for the position. */
  cost: number;
  /** Current market value of the position. */
  value: number;
  /** Absolute gain/loss vs cost. */
  gain: number;
  /** Percentage gain/loss vs cost. */
  gainPct: number;
  /** Today's $ change for the position (using the quote's day change). */
  dayChange: number;
}

/**
 * Compute position stats for a single entry given its current quote.
 * Returns null if there's no live position (shares + costBasis must be set).
 */
export function positionStats(
  entry: WatchlistEntry,
  quote: Quote | undefined,
): PositionStats | null {
  if (!entry.shares || !entry.costBasis || !quote) return null;
  const value = entry.shares * quote.price;
  const cost = entry.shares * entry.costBasis;
  const gain = value - cost;
  const gainPct = cost !== 0 ? (gain / cost) * 100 : 0;
  const dayChange = entry.shares * quote.change;
  return { cost, value, gain, gainPct, dayChange };
}

export interface PortfolioTotals {
  /** Sum of market values for all positions with quotes. */
  value: number;
  /** Sum of cost basis for all positions. */
  cost: number;
  gain: number;
  gainPct: number;
  dayChange: number;
  /** Number of entries with a live position. */
  positionsCount: number;
}

/** Aggregate totals across many positions. Entries without positions are ignored. */
export function portfolioTotals(
  entries: WatchlistEntry[],
  quotesBySymbol: Record<string, Quote | undefined>,
): PortfolioTotals {
  let value = 0;
  let cost = 0;
  let dayChange = 0;
  let positionsCount = 0;
  for (const e of entries) {
    const stats = positionStats(e, quotesBySymbol[e.symbol]);
    if (!stats) continue;
    value += stats.value;
    cost += stats.cost;
    dayChange += stats.dayChange;
    positionsCount += 1;
  }
  const gain = value - cost;
  const gainPct = cost !== 0 ? (gain / cost) * 100 : 0;
  return { value, cost, gain, gainPct, dayChange, positionsCount };
}

export interface AllocationSlice {
  /** Symbol (for holdings) or sector name (for sectors). */
  key: string;
  /** Current market value attributed to this slice. */
  value: number;
  /** Share of total portfolio value, 0–100. */
  pct: number;
}

export interface PortfolioBreakdown {
  /** Per-holding allocation, largest first. */
  byHolding: AllocationSlice[];
  /** Per-sector allocation, largest first. */
  bySector: AllocationSlice[];
  /** Largest single holding's share of the portfolio (0–100). */
  topHoldingPct: number;
  /** Number of positions (holdings with shares + cost). */
  holdingsCount: number;
  /** Number of distinct sectors represented. */
  sectorsCount: number;
}

/**
 * Break the portfolio down by holding and by sector, weighted by current
 * market value. Only positions with shares + cost + a live quote are counted.
 * Returns null when there's nothing to allocate.
 *
 * `sectorBySymbol` maps a ticker to its sector; missing entries fall back to
 * "Unknown" so the slice still sums to 100%.
 */
export function portfolioBreakdown(
  entries: WatchlistEntry[],
  quotesBySymbol: Record<string, Quote | undefined>,
  sectorBySymbol: Record<string, string | undefined>,
): PortfolioBreakdown | null {
  const holdingValues: Array<{ symbol: string; value: number }> = [];
  let total = 0;
  for (const e of entries) {
    const stats = positionStats(e, quotesBySymbol[e.symbol]);
    if (!stats || stats.value <= 0) continue;
    holdingValues.push({ symbol: e.symbol, value: stats.value });
    total += stats.value;
  }
  if (total <= 0 || holdingValues.length === 0) return null;

  const byHolding: AllocationSlice[] = holdingValues
    .map((h) => ({ key: h.symbol, value: h.value, pct: (h.value / total) * 100 }))
    .sort((a, b) => b.value - a.value);

  const sectorMap = new Map<string, number>();
  for (const h of holdingValues) {
    const sector = sectorBySymbol[h.symbol]?.trim() || "Unknown";
    sectorMap.set(sector, (sectorMap.get(sector) ?? 0) + h.value);
  }
  const bySector: AllocationSlice[] = Array.from(sectorMap.entries())
    .map(([key, value]) => ({ key, value, pct: (value / total) * 100 }))
    .sort((a, b) => b.value - a.value);

  return {
    byHolding,
    bySector,
    topHoldingPct: byHolding[0]?.pct ?? 0,
    holdingsCount: byHolding.length,
    sectorsCount: bySector.length,
  };
}
