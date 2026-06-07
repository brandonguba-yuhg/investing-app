// Static calendar of the big market-moving U.S. macro releases. These dates are
// published ~a year ahead and rarely move, so we hardcode them rather than pay
// for an economic-calendar API (FMP's is a paid endpoint; Yahoo has none).
//
// ⚠️ Refresh once a year against the official schedules:
//   CPI:  https://www.bls.gov/schedule/news_release/cpi.htm
//   Jobs: https://www.bls.gov/schedule/news_release/empsit.htm
//   FOMC: https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm
//
// `date` is the day the market reacts: the BLS release day (8:30 AM ET) or the
// FOMC decision day (the second day of each two-day meeting, statement 2:00 PM ET).

import type { UpcomingEvent } from "./types.js";

interface StaticMacroEvent {
  date: string; // YYYY-MM-DD
  title: string;
  detail: string;
}

// 2026 schedule. Titles name the reference period the data covers, which is the
// month before the release for CPI/jobs.
const MACRO_2026: StaticMacroEvent[] = [
  // ---- CPI inflation (BLS) ----
  { date: "2026-01-13", title: "CPI Inflation Report", detail: "December 2025 data · 8:30 AM ET" },
  { date: "2026-02-13", title: "CPI Inflation Report", detail: "January 2026 data · 8:30 AM ET" },
  { date: "2026-03-11", title: "CPI Inflation Report", detail: "February 2026 data · 8:30 AM ET" },
  { date: "2026-04-10", title: "CPI Inflation Report", detail: "March 2026 data · 8:30 AM ET" },
  { date: "2026-05-12", title: "CPI Inflation Report", detail: "April 2026 data · 8:30 AM ET" },
  { date: "2026-06-10", title: "CPI Inflation Report", detail: "May 2026 data · 8:30 AM ET" },
  { date: "2026-07-14", title: "CPI Inflation Report", detail: "June 2026 data · 8:30 AM ET" },
  { date: "2026-08-12", title: "CPI Inflation Report", detail: "July 2026 data · 8:30 AM ET" },
  { date: "2026-09-11", title: "CPI Inflation Report", detail: "August 2026 data · 8:30 AM ET" },
  { date: "2026-10-14", title: "CPI Inflation Report", detail: "September 2026 data · 8:30 AM ET" },
  { date: "2026-11-10", title: "CPI Inflation Report", detail: "October 2026 data · 8:30 AM ET" },
  { date: "2026-12-10", title: "CPI Inflation Report", detail: "November 2026 data · 8:30 AM ET" },

  // ---- Jobs report / nonfarm payrolls (BLS Employment Situation) ----
  { date: "2026-07-02", title: "Jobs Report (Nonfarm Payrolls)", detail: "June 2026 data · 8:30 AM ET" },
  { date: "2026-08-07", title: "Jobs Report (Nonfarm Payrolls)", detail: "July 2026 data · 8:30 AM ET" },
  { date: "2026-09-04", title: "Jobs Report (Nonfarm Payrolls)", detail: "August 2026 data · 8:30 AM ET" },
  { date: "2026-10-02", title: "Jobs Report (Nonfarm Payrolls)", detail: "September 2026 data · 8:30 AM ET" },
  { date: "2026-11-06", title: "Jobs Report (Nonfarm Payrolls)", detail: "October 2026 data · 8:30 AM ET" },
  { date: "2026-12-04", title: "Jobs Report (Nonfarm Payrolls)", detail: "November 2026 data · 8:30 AM ET" },

  // ---- FOMC rate decisions (Federal Reserve, decision day) ----
  { date: "2026-01-28", title: "Fed Interest-Rate Decision (FOMC)", detail: "Rate decision + press conference · 2:00 PM ET" },
  { date: "2026-03-18", title: "Fed Interest-Rate Decision (FOMC)", detail: "Rate decision + projections · 2:00 PM ET" },
  { date: "2026-04-29", title: "Fed Interest-Rate Decision (FOMC)", detail: "Rate decision + press conference · 2:00 PM ET" },
  { date: "2026-06-17", title: "Fed Interest-Rate Decision (FOMC)", detail: "Rate decision + projections · 2:00 PM ET" },
  { date: "2026-07-29", title: "Fed Interest-Rate Decision (FOMC)", detail: "Rate decision + press conference · 2:00 PM ET" },
  { date: "2026-09-16", title: "Fed Interest-Rate Decision (FOMC)", detail: "Rate decision + projections · 2:00 PM ET" },
  { date: "2026-10-28", title: "Fed Interest-Rate Decision (FOMC)", detail: "Rate decision + press conference · 2:00 PM ET" },
  { date: "2026-12-09", title: "Fed Interest-Rate Decision (FOMC)", detail: "Rate decision + projections · 2:00 PM ET" },
];

/**
 * Macro events from `fromDate` (inclusive) through `fromDate + horizonDays`,
 * sorted ascending. `fromDate` is a YYYY-MM-DD string.
 */
export function getUpcomingMacroEvents(fromDate: string, horizonDays: number): UpcomingEvent[] {
  const from = new Date(`${fromDate}T00:00:00`);
  const to = new Date(from);
  to.setDate(to.getDate() + horizonDays);

  return MACRO_2026.filter((e) => {
    const d = new Date(`${e.date}T00:00:00`);
    return d >= from && d <= to;
  })
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((e) => ({
      date: e.date,
      title: e.title,
      category: "macro" as const,
      importance: "high" as const,
      detail: e.detail,
    }));
}
