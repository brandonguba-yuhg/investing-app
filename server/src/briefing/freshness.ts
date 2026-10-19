// Ported verbatim from the Voyance briefing bundle (lib/briefing/freshness.ts).
// The only adjustment is the type import path — the eight gates, their
// thresholds, and the exact code paths are unchanged from the spec.
//
// Do NOT weaken this file. Every constant here is load-bearing: a rejected run
// is the system working. See HANDOFF.md violation-code table for the correct
// response when a code fires.

import type {
  BriefingPayload, GenerationResult, Level, StoredBriefing, Violation,
} from "./types.js";

/**
 * FRESHNESS ASSERTION
 *
 * The failure mode this exists to prevent: the pipeline keeps returning 200 while
 * quietly serving numbers from the model's training data, or from last Thursday.
 * A briefing that is confidently wrong at 7am is worse than no briefing, because
 * you will read it as fact.
 *
 * So: nothing reaches the store unless it clears every gate below.
 * On any violation the run is recorded and the reader is
 * told the brief is unavailable. There is no fallback to yesterday's copy.
 */

const MAX_PLAUSIBLE_DAILY_MOVE_PCT = 15;
const MAX_PLAUSIBLE_LEVEL_DRIFT = 0.12; // vs. the last accepted briefing
const MIN_SOURCE_DOMAINS = 2;

function host(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return null;
  }
}

function isNum(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

function isIsoDate(v: unknown): v is string {
  return typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
}

/** Collect every source_url anywhere in the payload. */
function citedUrls(p: BriefingPayload): string[] {
  const out: string[] = [];
  for (const lvl of Object.values(p.levels ?? {})) {
    if (lvl && typeof (lvl as Level).source_url === "string") out.push((lvl as Level).source_url);
  }
  for (const d of p.drivers ?? []) if (d?.source_url) out.push(d.source_url);
  return out;
}

/** Index-magnitude numbers written in prose, e.g. "7,728.20" or "26445.45". */
function proseIndexNumbers(text: string): number[] {
  const matches = text.match(/\b\d{1,3}(?:,\d{3})+(?:\.\d+)?\b|\b\d{4,6}\.\d{1,2}\b/g) ?? [];
  return matches
    .map((m) => Number(m.replace(/,/g, "")))
    .filter((n) => Number.isFinite(n) && n >= 1000);
}

function shapeViolations(p: any): Violation[] {
  const v: Violation[] = [];
  const req = (cond: boolean, code: string, detail: string) => {
    if (!cond) v.push({ code, detail });
  };

  req(isIsoDate(p?.session_date), "SCHEMA", "session_date missing or not YYYY-MM-DD");
  req(isIsoDate(p?.latest_source_date), "SCHEMA", "latest_source_date missing or not YYYY-MM-DD");
  req(typeof p?.headline === "string" && p.headline.length > 0, "SCHEMA", "headline missing");
  req(typeof p?.summary === "string" && p.summary.length > 40, "SCHEMA", "summary missing or too short");
  req(Array.isArray(p?.drivers) && p.drivers.length >= 1, "SCHEMA", "drivers must have >= 1 entry");
  req(Array.isArray(p?.ahead), "SCHEMA", "ahead must be an array");

  for (const key of ["spx", "ndx", "dji"] as const) {
    const lvl = p?.levels?.[key];
    req(isNum(lvl?.value), "SCHEMA", `levels.${key}.value missing or not a number`);
    req(typeof lvl?.source_url === "string" && lvl.source_url.length > 0,
      "UNCITED_LEVEL", `levels.${key} has no source_url`);
  }
  return v;
}

export interface FreshnessInput {
  result: GenerationResult;
  expectedSession: string;
  /** Last accepted briefing for this same scope, if any. Used for continuity checks. */
  previous?: StoredBriefing | null;
}

export interface FreshnessOutcome {
  ok: boolean;
  violations: Violation[];
  /** Non-blocking observations worth logging. */
  warnings: Violation[];
  payload?: BriefingPayload;
}

export function assertFreshness(input: FreshnessInput): FreshnessOutcome {
  const { result, expectedSession, previous } = input;
  const violations: Violation[] = [];
  const warnings: Violation[] = [];

  // GATE 1 — retrieval actually happened. A brief written without searching is,
  // by definition, from memory.
  if (result.searchCount < 1) {
    violations.push({ code: "SEARCH_NOT_EXECUTED", detail: "web_search ran 0 times" });
  }
  if (result.searchUrls.length === 0) {
    violations.push({ code: "NO_RETRIEVED_SOURCES", detail: "web_search returned no URLs" });
  }

  // GATE 2 — the output is the shape we contracted for.
  const shape = shapeViolations(result.payload);
  violations.push(...shape);
  if (shape.some((s) => s.code === "SCHEMA")) {
    return { ok: false, violations, warnings };
  }
  const p = result.payload as BriefingPayload;

  // GATE 3 — it describes the session we asked for, not whichever one it felt like.
  if (p.session_date !== expectedSession) {
    violations.push({
      code: "SESSION_MISMATCH",
      detail: `declared ${p.session_date}, expected ${expectedSession}`,
    });
  }

  // GATE 4 — the evidence is at least as new as the session being described.
  if (p.latest_source_date < expectedSession) {
    violations.push({
      code: "SOURCE_DATE_STALE",
      detail: `newest source dated ${p.latest_source_date}, session is ${expectedSession}`,
    });
  }

  // GATE 5 — every citation traces to something retrieval actually returned.
  // This is the gate that catches invented sources, which is the most dangerous
  // failure because it looks exactly like a real one.
  const retrievedHosts = new Set(result.searchUrls.map(host).filter(Boolean) as string[]);
  const retrievedExact = new Set(
    result.searchUrls.map((u) => {
      const h = host(u);
      try { return h ? h + new URL(u).pathname.replace(/\/$/, "") : null; } catch { return null; }
    }).filter(Boolean) as string[],
  );

  const cited = citedUrls(p);
  const citedHosts = new Set<string>();
  for (const url of cited) {
    const h = host(url);
    if (!h) {
      violations.push({ code: "MALFORMED_CITATION", detail: url });
      continue;
    }
    citedHosts.add(h);
    if (!retrievedHosts.has(h)) {
      violations.push({ code: "FABRICATED_CITATION", detail: `${url} was never retrieved this run` });
      continue;
    }
    let exact: string | null = null;
    try { exact = h + new URL(url).pathname.replace(/\/$/, ""); } catch { /* noop */ }
    if (exact && !retrievedExact.has(exact)) {
      warnings.push({ code: "CITATION_PATH_DRIFT", detail: `host matched but path not in results: ${url}` });
    }
  }
  if (citedHosts.size < MIN_SOURCE_DOMAINS) {
    violations.push({
      code: "SOURCE_DIVERSITY",
      detail: `${citedHosts.size} distinct domain(s), need >= ${MIN_SOURCE_DOMAINS}`,
    });
  }

  // GATE 6 — the numbers are physically plausible.
  for (const [key, lvl] of Object.entries(p.levels)) {
    if (!lvl) continue;
    const l = lvl as Level;
    if (isNum(l.change_pct) && Math.abs(l.change_pct) > MAX_PLAUSIBLE_DAILY_MOVE_PCT) {
      violations.push({
        code: "IMPLAUSIBLE_MOVE",
        detail: `${key} change_pct ${l.change_pct}% exceeds ±${MAX_PLAUSIBLE_DAILY_MOVE_PCT}%`,
      });
    }
  }

  // GATE 7 — continuity against the last accepted brief. Catches both a level that
  // teleported and a level that didn't move at all (a copied row).
  if (previous?.payload?.levels) {
    for (const key of ["spx", "ndx", "dji"] as const) {
      const now = p.levels[key]?.value;
      const then = previous.payload.levels[key]?.value;
      if (!isNum(now) || !isNum(then) || then === 0) continue;
      const drift = Math.abs(now / then - 1);
      if (drift > MAX_PLAUSIBLE_LEVEL_DRIFT) {
        violations.push({
          code: "LEVEL_DISCONTINUITY",
          detail: `${key} moved ${(drift * 100).toFixed(1)}% vs ${previous.session_date} (${then} -> ${now})`,
        });
      }
      if (now === then) {
        violations.push({
          code: "FROZEN_LEVEL",
          detail: `${key} identical to ${previous.session_date} close (${now})`,
        });
      }
    }
  }

  // GATE 8 — prose can't smuggle in numbers the structured block doesn't back.
  const declared = new Set(
    Object.values(p.levels)
      .filter(Boolean)
      .map((l) => Number((l as Level).value.toFixed(2))),
  );
  const proseBody = [p.headline, p.summary, ...(p.drivers ?? []).map((d) => d.detail)].join(" ");
  for (const n of proseIndexNumbers(proseBody)) {
    const backed = [...declared].some((d) => Math.abs(d - n) < 0.51);
    if (!backed) {
      violations.push({
        code: "UNBACKED_PROSE_NUMBER",
        detail: `"${n}" appears in prose but matches no declared level`,
      });
    }
  }

  return { ok: violations.length === 0, violations, warnings, payload: p };
}
