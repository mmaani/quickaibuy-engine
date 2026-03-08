#!/usr/bin/env node
import fs from "node:fs";
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import dotenv from "dotenv";

const environment = process.argv[2] || "production";
const localEnvFile = ".env.local";
const pulledEnvFile = `.env.vercel.${environment}.compare.tmp`;

const keysToCompare = [
  "DATABASE_URL",
  "DATABASE_URL_DIRECT",
  "REVIEW_CONSOLE_USERNAME",
  "REVIEW_CONSOLE_PASSWORD",
  "BULL_PREFIX",
  "JOBS_QUEUE_NAME",
  "ENGINE_QUEUE_NAME",
  "APP_ENV",
  "APP_URL",
  "VERCEL_ENV",
  "NEXT_PUBLIC_VERCEL_ENV",
];

function shortHash(input) {
  return crypto.createHash("sha256").update(input).digest("hex").slice(0, 10);
}

function maskValue(key, value) {
  if (value == null || value === "") return "missing";
  if (key.includes("DATABASE_URL")) {
    try {
      const parsed = new URL(value);
      const dbName = parsed.pathname.replace(/^\//, "") || "-";
      return `${parsed.hostname}/${dbName}#${shortHash(value)}`;
    } catch {
      return `invalid-url#${shortHash(value)}`;
    }
  }
  if (key.includes("PASSWORD") || key.includes("TOKEN") || key.includes("SECRET")) {
    return `set(len=${value.length},sha=${shortHash(value)})`;
  }
  return `${value}#${shortHash(value)}`;
}

function compareValues(a, b) {
  if ((a ?? "") === (b ?? "")) return "same";
  return "different";
}

if (!fs.existsSync(localEnvFile)) {
  console.error(`${localEnvFile} not found`);
  process.exit(1);
}

const pull = spawnSync(
  "pnpm",
  ["dlx", "vercel", "env", "pull", pulledEnvFile, "--environment", environment],
  { stdio: "pipe", encoding: "utf8" }
);

if (pull.status !== 0) {
  console.error("Failed to pull Vercel env.");
  console.error(pull.stderr || pull.stdout);
  process.exit(pull.status ?? 1);
}

const local = dotenv.parse(fs.readFileSync(localEnvFile, "utf8"));
const remote = dotenv.parse(fs.readFileSync(pulledEnvFile, "utf8"));

const rows = keysToCompare.map((key) => {
  const localValue = local[key];
  const remoteValue = remote[key];
  return {
    key,
    comparison: compareValues(localValue, remoteValue),
    local: maskValue(key, localValue),
    vercel: maskValue(key, remoteValue),
  };
});

let threshold = null;
try {
  const source = fs.readFileSync("src/lib/review/console.ts", "utf8");
  const m = source.match(/LOW_MATCH_CONFIDENCE_THRESHOLD\s*=\s*([0-9.]+)/);
  if (m) threshold = Number(m[1]);
} catch {}

console.log(
  JSON.stringify(
    {
      environment,
      pulledEnvFile,
      lowMatchConfidenceThresholdFromSource: threshold,
      comparisons: rows,
      summary: {
        sameCount: rows.filter((r) => r.comparison === "same").length,
        differentCount: rows.filter((r) => r.comparison === "different").length,
      },
    },
    null,
    2
  )
);

try {
  fs.unlinkSync(pulledEnvFile);
} catch {}
