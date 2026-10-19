// Manual smoke test: run the free briefing pipeline + freshness gate once, no server.
// Usage (from server/): npx tsx scripts/try-free-briefing.ts
import "dotenv/config";
import { expectedSessionDate } from "../src/briefing/calendar.js";
import { assertFreshness } from "../src/briefing/freshness.js";
import { generateFreeBriefing } from "../src/briefing/free.js";

const session = expectedSessionDate();
const result = await generateFreeBriefing(session);
const outcome = assertFreshness({ result, expectedSession: session });
console.log(JSON.stringify(result.payload, null, 2));
console.log(`model=${result.model} sources=${result.searchCount} urls=${result.searchUrls.length}`);
console.log(outcome.ok ? "GATE: ACCEPTED" : "GATE: REJECTED", outcome.violations, outcome.warnings);
