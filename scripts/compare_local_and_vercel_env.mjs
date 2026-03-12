#!/usr/bin/env node
import fs from "node:fs";
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import dotenv from "dotenv";

const environment = process.argv[2] || "production";
const localEnvFile = ".env.local";
const pulledEnvFile = `.env.vercel.${environment}.compare.tmp`;
const verbose = process.env.DIAG_VERBOSE === "1";

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

function classifyPullFailure(stderr, stdout) {
  const text = `${stderr}\n${stdout}`.toLowerCase();

  if (text.includes("not logged in") || text.includes("login")) {
    return {
      class: "AUTH_FAILURE",
      reason: "Vercel CLI is not logged in",
      nextStep: "Run `vercel login` and retry `pnpm diag:env-compare`.",
    };
  }

  if (text.includes("link") || text.includes("project") || text.includes(".vercel")) {
    return {
      class: "CONFIG_MISSING",
      reason: "Vercel project is not linked",
      nextStep: "Run `vercel link` in this repo and retry.",
    };
  }

  if (text.includes("eai_again") || text.includes("enotfound") || text.includes("dns")) {
    return {
      class: "DNS_FAILURE",
      reason: "Vercel env pull failed due to DNS/network resolution",
      nextStep: "Retry after connectivity stabilizes.",
    };
  }

  return {
    class: "UNKNOWN",
    reason: "Vercel env pull failed",
    nextStep: "Run with DIAG_VERBOSE=1 and inspect stderr details.",
  };
}

if (!fs.existsSync(localEnvFile)) {
  console.log(
    JSON.stringify(
      {
        status: "FAILED",
        class: "CONFIG_MISSING",
        reason: ".env.local not found",
        nextStep: "Create .env.local and retry.",
      },
      null,
      2
    )
  );
  process.exit(1);
}

const pull = spawnSync(
  "pnpm",
  ["dlx", "vercel", "env", "pull", pulledEnvFile, "--environment", environment],
  { stdio: "pipe", encoding: "utf8" }
);

if (pull.status !== 0) {
  const c = classifyPullFailure(pull.stderr || "", pull.stdout || "");
  console.log(
    JSON.stringify(
      {
        status: "FAILED",
        class: c.class,
        reason: c.reason,
        nextStep: c.nextStep,
        detail: `${pull.stderr || ""}\n${pull.stdout || ""}`.trim(),
      },
      null,
      2
    )
  );
  if (verbose) {
    console.error(pull.stderr || pull.stdout);
  }
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
      status: "OK",
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
