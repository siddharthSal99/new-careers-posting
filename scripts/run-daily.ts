// Runs the daily check locally: `npm run daily` (add `-- --dry-run` to skip sending email).
import { closeDb } from "../lib/db";
import { runDaily } from "../lib/run";

const summary = await runDaily({ dryRun: process.argv.includes("--dry-run") });
console.log(JSON.stringify(summary, null, 2));
await closeDb();
