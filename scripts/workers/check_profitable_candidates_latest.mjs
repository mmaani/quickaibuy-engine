import { spawnSync } from "node:child_process";

console.warn(
  "[DEPRECATED] scripts/workers/check_profitable_candidates_latest.mjs is deprecated. Use node scripts/check_profitable_candidates.mjs instead."
);

const result = spawnSync("node", ["scripts/check_profitable_candidates.mjs", ...process.argv.slice(2)], {
  stdio: "inherit",
});

if (result.error) {
  throw result.error;
}

process.exit(result.status ?? 0);
