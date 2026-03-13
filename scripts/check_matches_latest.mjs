import { spawnSync } from "node:child_process";

console.warn(
  "[DEPRECATED] scripts/check_matches_latest.mjs is deprecated. Use node scripts/check_matches.mjs instead."
);

const result = spawnSync("node", ["scripts/check_matches.mjs", ...process.argv.slice(2)], {
  stdio: "inherit",
});

if (result.error) {
  throw result.error;
}

process.exit(result.status ?? 0);
