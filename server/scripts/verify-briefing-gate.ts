// Ported verbatim from the Voyance bundle (scripts/verify-briefing-gate.ts).
// Only the import paths were adjusted to point at server/src/briefing.
//
// Run with:  npm run verify-gate  (from server/)
// Requires Node 22.6+ for --experimental-strip-types.
// 16 assertions, zero dependencies, zero API calls, zero cost.

import { expectedSessionDate, isTradingDay } from "../src/briefing/calendar.ts";
import { assertFreshness } from "../src/briefing/freshness.ts";
import type { GenerationResult, StoredBriefing } from "../src/briefing/types.ts";

let fails = 0;
const check = (name: string, cond: boolean) => {
  if (!cond) { fails++; console.log("FAIL " + name); } else console.log("ok   " + name);
};

// --- calendar
check("sat is not trading", !isTradingDay("2026-08-15"));
check("jul3 2026 holiday", !isTradingDay("2026-07-03"));
check("tue is trading", isTradingDay("2026-08-11"));
// 2026-08-11 18:00Z = 2:00pm ET -> before settle -> prior session Aug 10
check("pre-close -> prior day", expectedSessionDate(new Date("2026-08-11T18:00:00Z")) === "2026-08-10");
// 2026-08-11 21:45Z = 5:45pm ET -> today
check("post-close -> today", expectedSessionDate(new Date("2026-08-11T21:45:00Z")) === "2026-08-11");
// Monday 10:30 ET -> Friday
check("monday am -> friday", expectedSessionDate(new Date("2026-08-17T14:30:00Z")) === "2026-08-14");

// --- freshness
const good = {
  session_date: "2026-08-11",
  latest_source_date: "2026-08-11",
  headline: "Indexes ease a second day off records",
  summary: "Large caps led a modest decline while small caps finished higher. Energy outperformed as crude firmed.",
  levels: {
    spx: { value: 7728.20, change_pct: -0.32, source_url: "https://finance.yahoo.com/quote/%5EGSPC/" },
    ndx: { value: 26445.45, change_pct: -0.60, source_url: "https://finance.yahoo.com/quote/%5EGSPC/" },
    dji: { value: 53791.85, change_pct: -0.34, source_url: "https://www.washingtonpost.com/business/2026/08/11/x" },
  },
  drivers: [{ title: "Crude firms", detail: "Brent held near the upper end of its range.", source_url: "https://www.washingtonpost.com/business/2026/08/11/x" }],
  ahead: [{ when: "Wednesday", event: "July CPI", why: "Sets the September path." }],
};
const urls = [
  "https://finance.yahoo.com/quote/%5EGSPC/",
  "https://www.washingtonpost.com/business/2026/08/11/x",
];
const mk = (payload: any, over: Partial<GenerationResult> = {}): GenerationResult =>
  ({ payload, searchUrls: urls, searchCount: 4, model: "m", ...over });

const prev: StoredBriefing = {
  session_date: "2026-08-10", scope_type: "global", scope_key: "",
  payload: { ...good, levels: { spx: { value: 7753.11, change_pct: -0.06, source_url: urls[0] },
    ndx: { value: 26605.36, change_pct: -0.32, source_url: urls[0] },
    dji: { value: 53975.98, change_pct: -0.11, source_url: urls[1] } } } as any,
  sources: urls, model: "m", generated_at: new Date().toISOString(),
};

const codes = (r: any) => r.violations.map((v: any) => v.code);

check("clean payload passes", assertFreshness({ result: mk(good), expectedSession: "2026-08-11", previous: prev }).ok);
check("no search rejected",
  codes(assertFreshness({ result: mk(good, { searchCount: 0, searchUrls: [] }), expectedSession: "2026-08-11" })).includes("SEARCH_NOT_EXECUTED"));
check("wrong session rejected",
  codes(assertFreshness({ result: mk(good), expectedSession: "2026-08-12" })).includes("SESSION_MISMATCH"));
check("stale sources rejected",
  codes(assertFreshness({ result: mk({ ...good, latest_source_date: "2026-08-06" }), expectedSession: "2026-08-11" })).includes("SOURCE_DATE_STALE"));
check("fabricated citation rejected",
  codes(assertFreshness({ result: mk({ ...good, drivers: [{ ...good.drivers[0], source_url: "https://reuters.com/made-up" }] }), expectedSession: "2026-08-11" })).includes("FABRICATED_CITATION"));
check("single domain rejected",
  codes(assertFreshness({ result: mk({ ...good, levels: { ...good.levels, dji: { ...good.levels.dji, source_url: urls[0] } }, drivers: [{ ...good.drivers[0], source_url: urls[0] }] }), expectedSession: "2026-08-11" })).includes("SOURCE_DIVERSITY"));
check("frozen level rejected",
  codes(assertFreshness({ result: mk({ ...good, levels: { ...good.levels, spx: { ...good.levels.spx, value: 7753.11 } } }), expectedSession: "2026-08-11", previous: prev })).includes("FROZEN_LEVEL"));
check("teleported level rejected",
  codes(assertFreshness({ result: mk({ ...good, levels: { ...good.levels, spx: { ...good.levels.spx, value: 6100.00 } } }), expectedSession: "2026-08-11", previous: prev })).includes("LEVEL_DISCONTINUITY"));
check("unbacked prose number rejected",
  codes(assertFreshness({ result: mk({ ...good, summary: good.summary + " The index settled at 7,900.11 on the day." }), expectedSession: "2026-08-11", previous: prev })).includes("UNBACKED_PROSE_NUMBER"));
check("declared level in prose is allowed",
  !codes(assertFreshness({ result: mk({ ...good, summary: good.summary + " The S&P 500 closed at 7,728.20." }), expectedSession: "2026-08-11", previous: prev })).includes("UNBACKED_PROSE_NUMBER"));

console.log(fails === 0 ? "\nALL PASS" : `\n${fails} FAILURES`);
process.exit(fails === 0 ? 0 : 1);
