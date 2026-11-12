// Prints which settings are set or missing, by name only, and never a value.
// Usage: npm run env:check            (this Mac: hosted names are informational)
//        npm run env:check -- --hosted (a server: hosted names are required too)
import { loadEnvConfig } from "@next/env";
import { envReport } from "../src/lib/env/required";

loadEnvConfig(process.cwd(), true, { info: () => {}, error: console.error });
const report = envReport(process.env, { hosted: process.argv.includes("--hosted") });
console.log(report.lines.join("\n"));
if (!report.ok) {
  console.log("\nA required setting is missing.");
  process.exit(1);
}
console.log("\nAll required settings are set.");
