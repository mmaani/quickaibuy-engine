import { spawnSync } from "node:child_process";

console.warn(
  "[DEPRECATED] scripts/workers/check_listing_previews_latest.mjs is deprecated. Use node scripts/check_listing_previews_ready_source.mjs instead."
);

const result = spawnSync("node", ["scripts/check_listing_previews_ready_source.mjs", ...process.argv.slice(2)], {
  stdio: "inherit",
});

if (result.error) {
  throw result.error;
}

process.exit(result.status ?? 0);
