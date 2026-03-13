import { spawnSync } from "node:child_process";

console.warn(
  "[DEPRECATED] scripts/run_marketplace_scan_monitoring_latest.ts is deprecated. Use pnpm exec tsx scripts/run_marketplace_scan_monitoring.ts instead."
);

const result = spawnSync(
  "pnpm",
  ["exec", "tsx", "scripts/run_marketplace_scan_monitoring.ts", ...process.argv.slice(2)],
  { stdio: "inherit" }
);

if (result.error) {
  throw result.error;
}

process.exit(result.status ?? 0);
