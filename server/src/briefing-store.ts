// Keeps the daily market briefing warm so users never trigger a multi-minute
// live web-search run. The briefing is generated in the background (on boot and
// on an interval) and mirrored to a JSON file so it survives process restarts.
// Railway wipes the container filesystem on each redeploy, but the boot warm-up
// regenerates within a minute or two, and we serve the previous day's briefing
// instantly in the meantime rather than blocking the request.

import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import * as ai from "./ai.js";
import type { MarketBriefing } from "./types.js";

const FILE =
  process.env.BRIEFING_CACHE_PATH || path.join(os.tmpdir(), "investing-briefing.json");

// Regenerate every 6 hours so the briefing stays current through the day.
const REFRESH_MS = 6 * 60 * 60 * 1000;

let current: MarketBriefing | null = null;
// Dedupe concurrent generations: a single in-flight promise shared by callers.
let generating: Promise<MarketBriefing> | null = null;

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/** The latest briefing we have (may be a previous day's), or null if none yet. */
export function getCurrent(): MarketBriefing | null {
  return current;
}

/** True when we already hold today's briefing. */
export function isFresh(): boolean {
  return current?.date === today();
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

/** Generate a fresh briefing now, deduping concurrent calls. */
export function refresh(): Promise<MarketBriefing> {
  if (generating) return generating;
  generating = ai
    .getMarketBriefing()
    .then(async (b) => {
      current = b;
      await persist(b);
      console.log(`[briefing] refreshed ${b.date}`);
      return b;
    })
    .finally(() => {
      generating = null;
    });
  return generating;
}

/**
 * Kick off a background regeneration if we don't already hold today's briefing.
 * Non-blocking: callers serve whatever they have and let this update in place.
 */
export function ensureFresh(): void {
  if (isFresh() || generating) return;
  void refresh().catch((e) =>
    console.error("[briefing] background refresh failed:", e instanceof Error ? e.message : e),
  );
}

/** Warm the cache on boot and refresh on an interval. No-op if AI is disabled. */
export function startScheduler(): void {
  if (!ai.aiEnabled()) return;
  ensureFresh();
  const timer = setInterval(() => {
    void refresh().catch((e) =>
      console.error("[briefing] scheduled refresh failed:", e instanceof Error ? e.message : e),
    );
  }, REFRESH_MS);
  // Don't keep the event loop alive just for the refresh timer.
  timer.unref?.();
}
