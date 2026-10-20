// Keeps the daily market briefing warm so users never trigger a multi-minute
// live web-search run. The briefing is generated in the background (on boot and
// on an interval), validated through the eight-gate freshness contract in
// briefing/freshness.ts, and mirrored to a JSON file so it survives process
// restarts. Railway wipes the container filesystem on each redeploy, but the
// boot warm-up regenerates within a minute or two, and we serve the previous
// day's briefing instantly in the meantime rather than blocking the request.
//
// Failure mode this design prevents: the pipeline silently returning 200 with
// numbers from the model's training data or last week. Nothing reaches `current`
// unless it passes all eight gates. Rejections land in briefing-failures.log
// with their violation codes — do NOT loosen the gate to force a green run.

import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import * as ai from "./ai.js";
import { expectedSessionDate, isTradingDay, previousTradingDay } from "./briefing/calendar.js";
import { dueEdition, generateMorningBriefing } from "./briefing/morning.js";
import { assertFreshness } from "./briefing/freshness.js";
import { generateFreeBriefing, LevelsNotReadyError } from "./briefing/free.js";
import type {
  BriefingPayload,
  GenerationResult,
  StoredBriefing,
  Violation,
} from "./briefing/types.js";
import type { MarketBriefing } from "./types.js";

const FILE =
  process.env.BRIEFING_CACHE_PATH || path.join(os.tmpdir(), "investing-briefing.json");

// Rejected runs get one JSON-per-line entry here for post-mortem. Append-only;
// nothing reads this at runtime. Kept next to the cache file so both live in
// the same tmpdir on Railway (wiped per deploy — that's fine, this is a log).
const FAILURES_LOG =
  process.env.BRIEFING_FAILURES_PATH ||
  path.join(os.tmpdir(), "investing-briefing-failures.log");

// The briefing is a morning product: a "premarket" edition at 7:00am ET and an
// "open" edition at 9:40am ET on trading days (see briefing/morning.ts). The
// scheduler checks every minute whether an edition is due; checks are free
// when nothing is.
const CHECK_MS = 60 * 1000;
// After a failed attempt, don't retry on every page load. Data that simply
// isn't out yet (opening quotes, the prior close) is retried sooner than a
// gate rejection.
const RETRY_NOT_READY_MS = 5 * 60 * 1000;
const RETRY_REJECTED_MS = 20 * 60 * 1000;

const EDITION_RANK = { recap: 0, premarket: 1, open: 2 } as const;

// "free" (default): FRED/Nasdaq closes + RSS news + Gemini free tier / template.
// "claude": the original Claude + web_search run (bills the Anthropic account).
const PROVIDER = (process.env.BRIEFING_PROVIDER ?? "free").toLowerCase();

let retryAt = 0;

let current: MarketBriefing | null = null;
// Dedupe concurrent generations: a single in-flight promise shared by callers.
let generating: Promise<MarketBriefing | null> | null = null;

/** The latest briefing we have (may be a previous day's), or null if none yet. */
export function getCurrent(): MarketBriefing | null {
  return current;
}

/** True when we already hold the briefing that's due now. */
export function isFresh(): boolean {
  if (!current) return false;
  if (PROVIDER === "claude") {
    // Claude provider still produces the after-close recap.
    const held = current.payload?.session_date ?? current.date;
    return held === expectedSessionDate();
  }
  const due = dueEdition(new Date(), isTradingDay);
  // Outside the morning window (overnight, weekends) keep the latest edition.
  if (!due) return true;
  const p = current.payload;
  return (
    p?.brief_date === due.today &&
    EDITION_RANK[p.edition ?? "recap"] >= EDITION_RANK[due.edition]
  );
}

/** Load a persisted briefing from disk into memory (best-effort). */
export async function loadFromDisk(): Promise<void> {
  try {
    const raw = await fs.readFile(FILE, "utf8");
    const parsed = JSON.parse(raw) as MarketBriefing;
    if (parsed?.date && Array.isArray(parsed.items)) {
      current = parsed;
      console.log(`[briefing] loaded ${parsed.date} from disk`);
    }
  } catch {
    // No cached file yet — that's fine, the warm-up will create one.
  }
}

async function persist(b: MarketBriefing): Promise<void> {
  try {
    await fs.writeFile(FILE, JSON.stringify(b), "utf8");
  } catch (e) {
    console.error("[briefing] failed to persist:", e instanceof Error ? e.message : e);
  }
}

/** Append a rejected run to the failures log. Best-effort. */
async function logFailure(entry: {
  attempted_at: string;
  expected_session: string;
  violations: Violation[];
  warnings: Violation[];
  raw: unknown;
}): Promise<void> {
  try {
    await fs.appendFile(FAILURES_LOG, JSON.stringify(entry) + "\n", "utf8");
  } catch (e) {
    console.error("[briefing] failed to log failure:", e instanceof Error ? e.message : e);
  }
}

/**
 * Build the client-facing MarketBriefing from a gate-accepted payload.
 * Derives the legacy fields (headline/overview/items/sources) the frontend
 * already renders, and keeps the full validated payload as `.payload` so
 * future UI can render the levels table directly.
 */
function buildBriefing(
  payload: BriefingPayload,
  result: GenerationResult,
): MarketBriefing {
  const items = payload.drivers.map((d) => ({
    heading: ai.stripCitations(d.title),
    summary: ai.stripCitations(d.detail),
    url: d.source_url,
  }));

  // Sources shown in the "Sources (N)" UI panel — derived from cited URLs in
  // the accepted payload (not all retrieval hits). We only surface what the
  // brief actually leans on.
  const cited = new Set<string>();
  for (const lvl of Object.values(payload.levels)) {
    if (lvl?.source_url) cited.add(lvl.source_url);
  }
  for (const m of payload.moves ?? []) cited.add(m.source_url);
  for (const d of payload.drivers) if (d.source_url) cited.add(d.source_url);
  const sources = [...cited].map((url) => ({ title: hostOf(url) ?? url, url }));

  return {
    date: payload.brief_date ?? payload.session_date,
    headline: ai.stripCitations(payload.headline),
    overview: ai.stripCitations(payload.summary),
    items,
    sources: sources.length ? sources : undefined,
    generatedAt: new Date().toISOString(),
    model: result.model,
    payload,
  };
}

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

/** Adapt the in-memory MarketBriefing to a StoredBriefing for the gate's continuity check. */
function currentAsStored(): StoredBriefing | null {
  if (!current?.payload) return null;
  return {
    session_date: current.payload.session_date,
    scope_type: "global",
    scope_key: "",
    payload: current.payload,
    sources: [],
    model: current.model,
    generated_at: current.generatedAt,
  };
}

/**
 * Generate a fresh briefing now, deduping concurrent calls.
 *
 * On accept, returns the new briefing and updates `current`.
 * On reject, logs violations, leaves `current` unchanged, and returns null.
 * Callers should treat null as "keep serving what you have."
 */
export function refresh(): Promise<MarketBriefing | null> {
  if (generating) return generating;
  generating = doRefresh().finally(() => {
    generating = null;
  });
  return generating;
}

async function doRefresh(): Promise<MarketBriefing | null> {
  if (PROVIDER === "claude") return recap(expectedSessionDate(), true);

  const due = dueEdition(new Date(), isTradingDay);
  if (due) {
    const session = previousTradingDay(due.today);
    // Hand the 7am moves to the 9:40 run so it can call out a flip in direction.
    const premarket =
      due.edition === "open" &&
      current?.payload?.brief_date === due.today &&
      current.payload.edition === "premarket"
        ? current.payload.moves
        : undefined;
    const brief = await runGated(
      () => generateMorningBriefing(due.edition, due.today, session, premarket),
      session,
      `${due.edition} edition for ${due.today}`,
    );
    if (brief || current) return brief;
    // Cold start (each Railway deploy wipes the cache) and the edition's data
    // isn't out yet: show the last close's recap meanwhile.
  }
  // Cold start outside the morning window (overnight, weekends, or before the
  // day's first edition): publish a recap of the last completed session.
  return recap(expectedSessionDate(), true);
}

/** After-close recap of `session`; on a cold start, falls back one session. */
async function recap(session: string, allowFallback: boolean): Promise<MarketBriefing | null> {
  const brief = await runGated(
    () => (PROVIDER === "claude" ? ai.getMarketBriefing() : generateFreeBriefing(session)),
    session,
    `recap of ${session}`,
  );
  // Between 4:15pm and whenever FRED posts the close, the newest session isn't
  // available yet; rather than "preparing" all evening, show the one before.
  if (!brief && allowFallback && !current) return recap(previousTradingDay(session), false);
  return brief;
}

/** Generate, run the eight-gate freshness check, and publish if it passes. */
async function runGated(
  generate: () => Promise<GenerationResult>,
  expectedSession: string,
  label: string,
): Promise<MarketBriefing | null> {
  let result: GenerationResult;
  try {
    result = await generate();
  } catch (e) {
    if (e instanceof LevelsNotReadyError) {
      retryAt = Date.now() + RETRY_NOT_READY_MS;
      console.log(`[briefing] waiting (${label}): ${e.message}`);
      return null;
    }
    retryAt = Date.now() + RETRY_REJECTED_MS;
    throw e;
  }

  const outcome = assertFreshness({
    result,
    expectedSession,
    previous: currentAsStored(),
  });

  if (!outcome.ok || !outcome.payload) {
    retryAt = Date.now() + RETRY_REJECTED_MS;
    const codes = outcome.violations.map((v) => v.code).join(", ");
    console.warn(`[briefing] REJECTED ${label} — ${codes || "no codes"}`);
    for (const v of outcome.violations) {
      console.warn(`[briefing]   ${v.code}: ${v.detail}`);
    }
    await logFailure({
      attempted_at: new Date().toISOString(),
      expected_session: expectedSession,
      violations: outcome.violations,
      warnings: outcome.warnings,
      raw: result.payload,
    });
    return null;
  }

  for (const w of outcome.warnings) {
    console.warn(`[briefing] warning ${w.code}: ${w.detail}`);
  }

  const brief = buildBriefing(outcome.payload, result);
  current = brief;
  await persist(brief);
  console.log(
    `[briefing] accepted ${label} via ${result.model}` +
      ` (${result.searchCount} sources, ${result.searchUrls.length} URLs retrieved)`,
  );
  return brief;
}

/**
 * Kick off a background regeneration if we don't already hold the briefing
 * that's due. Non-blocking: callers serve whatever they have and let this
 * update in place.
 */
export function ensureFresh(): void {
  if (isFresh() || generating) return;
  if (Date.now() < retryAt) return;
  void refresh().catch((e) =>
    console.error("[briefing] background refresh failed:", e instanceof Error ? e.message : e),
  );
}

/** The free provider needs no keys; the Claude provider needs ANTHROPIC_API_KEY. */
export function enabled(): boolean {
  return PROVIDER === "claude" ? ai.aiEnabled() : true;
}

/** Warm the cache on boot and check every minute whether an edition is due. */
export function startScheduler(): void {
  if (!enabled()) return;
  ensureFresh();
  const timer = setInterval(ensureFresh, CHECK_MS);
  // Don't keep the event loop alive just for the refresh timer.
  timer.unref?.();
}
