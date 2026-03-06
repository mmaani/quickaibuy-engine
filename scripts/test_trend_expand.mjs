import fs from "fs";

function loadEnvFile(file) {
  if (!fs.existsSync(file)) return false;

  const text = fs.readFileSync(file, "utf8");
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;

    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();

    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }

    if (!(key in process.env)) {
      process.env[key] = val;
    }
  }

  return true;
}

loadEnvFile(".env.local");
loadEnvFile(".env.development.local");
loadEnvFile(".env");
loadEnvFile(".env.development");

const trendSignalId = process.argv[2];

if (!trendSignalId) {
  console.error("Usage: node --import tsx scripts/test_trend_expand.mjs <trendSignalId>");
  process.exit(1);
}

const { expandTrendSignal } = await import("../src/lib/trends/expandTrendSignal.ts");
const result = await expandTrendSignal(trendSignalId);

console.log(JSON.stringify(result, null, 2));
