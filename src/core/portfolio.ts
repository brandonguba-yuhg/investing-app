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
