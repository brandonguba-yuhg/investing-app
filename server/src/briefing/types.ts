// Ported verbatim from Voyance briefing bundle (lib/briefing/types.ts). These
// types describe the structured payload the model must produce and the shape
// the freshness gate operates on. They are additive next to server/src/types.ts's
// MarketBriefing — the store composes both.

/** A single quoted market level. Every one must carry its own citation. */
export interface Level {
  value: number;
  change_pct: number | null;
  source_url: string;
}

/** The structured contract the model must satisfy. Prose is secondary to this. */
export interface BriefingPayload {
  /** ISO date (YYYY-MM-DD) of the trading session described. Model-declared, then gated. */
  session_date: string;
  /** Most recent date, ISO, appearing in any source the model relied on. */
  latest_source_date: string;
  headline: string;
  /** 2-5 sentences. No numbers that don't also appear in `levels`. */
  summary: string;
  levels: {
    spx: Level;
    ndx: Level;
    dji: Level;
    vix?: Level;
    ust10y?: Level;
  };
  drivers: Array<{ title: string; detail: string; source_url: string }>;
  /** Forward calendar: what lands next and why it matters. */
  ahead: Array<{ when: string; event: string; why: string }>;
  /**
   * Which edition this is. "premarket" (7:00am ET) and "open" (9:40am ET) are
   * the morning briefings; "recap" is the after-close fallback used on a cold
   * start before the day's first edition. Absent on older briefs = recap.
   */
  edition?: BriefingEdition;
  /** YYYY-MM-DD the briefing is for. Morning editions: today. Recap: session_date. */
  brief_date?: string;
  /** Today's moves (SPY/QQQ/DIA) as of this edition. */
  moves?: MarketMove[];
  /** On the "open" edition: the 7am pre-market moves, to show any flip in direction. */
  premarket_moves?: MarketMove[];
}

export type BriefingEdition = "premarket" | "open" | "recap";

/** An index ETF's move vs the previous close, from Nasdaq.com's delayed quotes. */
export interface MarketMove {
  symbol: string;      // SPY, QQQ, DIA
  name: string;        // the index it tracks
  price: number;
  change_pct: number;
  as_of: string;       // Nasdaq's timestamp text, e.g. "Oct 21, 2026 9:38 AM ET"
  source_url: string;
}

/**
 * What the store persists per accepted brief. Only the payload + retrieval
 * metadata that the freshness gate needs — no per-user scoping, since this
 * codebase has no server-side favorites or user_id.
 */
export interface StoredBriefing {
  session_date: string;
  scope_type: "global";
  scope_key: "";
  payload: BriefingPayload;
  sources: string[];
  model: string;
  generated_at: string;
}

export interface Violation {
  code: string;
  detail: string;
}

/** What ai.getMarketBriefing() returns — raw model output plus retrieval facts. */
export interface GenerationResult {
  payload: unknown;          // unvalidated — the gate decides
  searchUrls: string[];      // URLs the web_search tool actually returned
  searchCount: number;       // number of searches actually executed
  model: string;
}
