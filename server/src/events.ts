// Builds the "Upcoming Events" feed shown under the home-page market briefing.
// Two free sources, no AI spend:
//   1. Static macro calendar (CPI / jobs / FOMC) — see macroEvents.ts.
//   2. FMP free-tier earnings calendar. We surface earnings from a handful of
//      mega-caps (so the default list stays market-moving) plus every company
//      on the caller's watchlist (so users can filter to just those).
// Earnings is best-effort: if FMP is unkeyed or the call fails, we still return
// the macro events. The client decides the display horizon (1 vs 6 weeks) and
// whether to show only watchlist earnings.

import { cache, TTL } from "./cache.js";
import * as fmp from "./fmp.js";
import { getUpcomingMacroEvents } from "./macroEvents.js";
import type { UpcomingEvent, UpcomingEvents } from "./types.js";

// Full look-ahead window (6 weeks). The client narrows this for its default view.
const HORIZON_DAYS = 42;

// Cap mega-cap earnings so a busy reporting week can't crowd out macro events.
// Watchlist earnings are never capped — the user explicitly cares about those.
const MAX_NOTABLE_EARNINGS = 8;

// Mega-caps whose earnings are notable to everyone, shown even without a watchlist.
const MAJOR_TICKERS = new Set([
  "AAPL", "MSFT", "NVDA", "GOOGL", "GOOG", "AMZN", "META", "TSLA", "AVGO",
  "JPM", "V", "MA", "WMT", "XOM", "UNH", "LLY", "JNJ", "ORCL", "NFLX", "AMD",
  "COST", "HD", "BAC", "CRM", "ADBE", "PEP", "KO", "DIS", "INTC", "CSCO",
]);

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00`);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

// The raw FMP calendar is cached by window (not by watchlist) so different
// watchlists reuse one upstream call. Filtering happens in-memory afterwards.
async function rawEarnings(from: string, to: string): Promise<fmp.EarningsEvent[]> {
  if (!fmp.fmpEnabled()) return [];
  try {
    return await cache.wrap(`earnings-raw:${from}:${to}`, TTL.events, () =>
      fmp.getEarningsCalendar(from, to),
    );
  } catch (err) {
    console.warn(
      `[events] earnings calendar unavailable: ${err instanceof Error ? err.message : err}`,
    );
    return [];
  }
}

function toEarningsEvent(e: fmp.EarningsEvent): UpcomingEvent {
  const sym = e.symbol.toUpperCase();
  const detail =
    typeof e.epsEstimated === "number" && Number.isFinite(e.epsEstimated)
      ? `EPS est. ${e.epsEstimated.toFixed(2)}`
      : "Quarterly earnings";
  return { date: e.date, title: `${sym} Earnings`, category: "earnings", importance: "medium", detail, symbol: sym };
}

export async function getUpcomingEvents(watchlist: string[] = []): Promise<UpcomingEvents> {
  const today = new Date().toISOString().slice(0, 10);
  const to = addDays(today, HORIZON_DAYS);

  const macro = getUpcomingMacroEvents(today, HORIZON_DAYS);
  const raw = await rawEarnings(today, to);

  const watch = new Set(watchlist.map((s) => s.toUpperCase()));
  const seen = new Set<string>();
  const watchlistEarnings: UpcomingEvent[] = [];
  const notableEarnings: UpcomingEvent[] = [];

  for (const e of raw.slice().sort((a, b) => a.date.localeCompare(b.date))) {
    const sym = e.symbol.toUpperCase();
    if (seen.has(sym)) continue;
    if (watch.has(sym)) {
      seen.add(sym);
      watchlistEarnings.push(toEarningsEvent(e));
    } else if (MAJOR_TICKERS.has(sym) && notableEarnings.length < MAX_NOTABLE_EARNINGS) {
      seen.add(sym);
      notableEarnings.push(toEarningsEvent(e));
    }
  }

  const events = [...macro, ...watchlistEarnings, ...notableEarnings].sort((a, b) =>
    a.date.localeCompare(b.date),
  );

  return { generatedAt: new Date().toISOString(), events };
}
