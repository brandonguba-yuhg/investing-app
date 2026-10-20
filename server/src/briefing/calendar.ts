// Ported verbatim from the Voyance briefing bundle (lib/briefing/calendar.ts).
// Trading-calendar helpers, all reasoned in America/New_York.
//
// MAINTENANCE: NYSE holidays are hardcoded. Add the next year every December.
// If this list goes stale the freshness gate fails closed (you get "unavailable"
// on a holiday) rather than publishing a stale brief — which is the safe direction,
// but check it annually anyway.

const NYSE_HOLIDAYS = new Set<string>([
  // 2026
  "2026-01-01", "2026-01-19", "2026-02-16", "2026-04-03", "2026-05-25",
  "2026-06-19", "2026-07-03", "2026-09-07", "2026-11-26", "2026-12-25",
  // 2027
  "2027-01-01", "2027-01-18", "2027-02-15", "2027-03-26", "2027-05-31",
  "2027-06-18", "2027-07-05", "2027-09-06", "2027-11-25", "2027-12-24",
]);

/** Close + settle buffer. Before this, "today" has no final close to describe. */
const SESSION_SETTLED_ET_MINUTES = 16 * 60 + 15; // 4:15pm ET

interface EtParts {
  date: string; // YYYY-MM-DD
  minutes: number; // minutes since ET midnight
  weekday: number; // 0=Sun
}

function etParts(at: Date): EtParts {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
    weekday: "short",
  });
  const p: Record<string, string> = {};
  for (const part of fmt.formatToParts(at)) p[part.type] = part.value;
  const weekdayMap: Record<string, number> = {
    Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
  };
  return {
    date: `${p.year}-${p.month}-${p.day}`,
    minutes: Number(p.hour === "24" ? "0" : p.hour) * 60 + Number(p.minute),
    weekday: weekdayMap[p.weekday],
  };
}

function shiftDays(isoDate: string, delta: number): string {
  const d = new Date(`${isoDate}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

function weekdayOf(isoDate: string): number {
  return new Date(`${isoDate}T12:00:00Z`).getUTCDay();
}

export function isTradingDay(isoDate: string): boolean {
  const wd = weekdayOf(isoDate);
  return wd !== 0 && wd !== 6 && !NYSE_HOLIDAYS.has(isoDate);
}

export function previousTradingDay(isoDate: string): string {
  let cursor = shiftDays(isoDate, -1);
  for (let i = 0; i < 10; i++) {
    if (isTradingDay(cursor)) return cursor;
    cursor = shiftDays(cursor, -1);
  }
  throw new Error(`No trading day found within 10 days before ${isoDate}`);
}

/**
 * The session a brief generated at `at` must describe.
 * Run at 6:30am ET Tue -> Monday's close. Run at 5:00pm ET Tue -> Tuesday's close.
 */
export function expectedSessionDate(at: Date = new Date()): string {
  const { date, minutes } = etParts(at);
  if (isTradingDay(date) && minutes >= SESSION_SETTLED_ET_MINUTES) return date;
  return previousTradingDay(date);
}

export { etParts };
