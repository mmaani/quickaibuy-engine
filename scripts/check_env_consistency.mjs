#!/usr/bin/env node
import fs from "node:fs";
import dotenv from "dotenv";

const FILES = [".env.local", ".env.vercel", ".env"];

function loadEnv(path) {
  if (!fs.existsSync(path)) return null;
  return dotenv.parse(fs.readFileSync(path, "utf8"));
}

function loadActiveEnvMetadata(path) {
  if (!fs.existsSync(path)) return null;
  try {
    return JSON.parse(fs.readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

function parseDb(value) {
  if (!value) return null;
  try {
    const url = new URL(value);
    const host = url.hostname;
    const projectHost = host.replace("-pooler", "");
    return {
      host,
      projectHost,
      pooled: host.includes("-pooler."),
      database: url.pathname.replace(/^\//, "") || null,
      sslmode: url.searchParams.get("sslmode") || null,
    };
  } catch {
    return { invalid: true };
  }
}

function buildSummary(file, env) {
  if (!env) {
    return { exists: false };
  }

  const value = (key) => {
    const raw = env[key];
    return typeof raw === "string" ? raw.trim() || null : null;
  };

  return {
    exists: true,
    app_env: value("APP_ENV"),
    vercel_env: value("VERCEL_ENV"),
    next_public_vercel_env: value("NEXT_PUBLIC_VERCEL_ENV"),
    bull_prefix: value("BULL_PREFIX"),
    jobs_queue_name: value("JOBS_QUEUE_NAME"),
    engine_queue_name: value("ENGINE_QUEUE_NAME"),
    db: parseDb(env.DATABASE_URL),
    db_direct: parseDb(env.DATABASE_URL_DIRECT),
    has_redis: Boolean(env.REDIS_URL),
    has_upstash: Boolean(env.UPSTASH_REDIS_REST_URL) && Boolean(env.UPSTASH_REDIS_REST_TOKEN),
  };
}

function compareProject(summaryA, summaryB) {
  if (!summaryA?.db?.projectHost || !summaryB?.db?.projectHost) return null;
  return summaryA.db.projectHost === summaryB.db.projectHost;
}

const envs = Object.fromEntries(FILES.map((file) => [file, buildSummary(file, loadEnv(file))]));
const activeEnv = loadActiveEnvMetadata(".env.active.json");
const warnings = [];

if (envs[".env.vercel"]?.exists && envs[".env.vercel"]?.vercel_env !== "production") {
  warnings.push(".env.vercel should reflect VERCEL_ENV=production");
}
const localExpectedEnv =
  activeEnv?.source === ".env.prod" ? "production" : activeEnv?.source === ".env.dev" ? "development" : null;
const localExpectedBullPrefix =
  activeEnv?.source === ".env.prod" ? "qaib-prod" : activeEnv?.source === ".env.dev" ? "qaib-dev" : null;

if (
  envs[".env.local"]?.exists &&
  localExpectedEnv &&
  envs[".env.local"]?.app_env &&
  envs[".env.local"].app_env !== localExpectedEnv
) {
  warnings.push(`.env.local should declare APP_ENV=${localExpectedEnv} to mirror ${activeEnv.source}`);
}
if (
  envs[".env.local"]?.exists &&
  localExpectedBullPrefix &&
  envs[".env.local"]?.bull_prefix &&
  envs[".env.local"].bull_prefix !== localExpectedBullPrefix
) {
  warnings.push(`.env.local should use BULL_PREFIX=${localExpectedBullPrefix} to mirror ${activeEnv.source}`);
}
if (
  envs[".env.vercel"]?.exists &&
  envs[".env.vercel"]?.bull_prefix &&
  envs[".env.vercel"].bull_prefix !== "qaib-prod"
) {
  warnings.push(".env.vercel should use BULL_PREFIX=qaib-prod");
}
if (
  envs[".env.vercel"]?.exists &&
  envs[".env.vercel"]?.jobs_queue_name &&
  envs[".env.vercel"].jobs_queue_name !== "jobs-prod"
) {
  warnings.push(".env.vercel should use JOBS_QUEUE_NAME=jobs-prod");
}
if (
  envs[".env.local"]?.db &&
  envs[".env.local"]?.db_direct &&
  envs[".env.local"].db.projectHost !== envs[".env.local"].db_direct.projectHost
) {
  warnings.push(".env.local DATABASE_URL and DATABASE_URL_DIRECT point to different Neon projects");
}
if (
  envs[".env.vercel"]?.db &&
  envs[".env.vercel"]?.db_direct &&
  envs[".env.vercel"].db.projectHost !== envs[".env.vercel"].db_direct.projectHost
) {
  warnings.push(".env.vercel DATABASE_URL and DATABASE_URL_DIRECT point to different Neon projects");
}
if (
  envs[".env"]?.exists &&
  envs[".env.local"]?.exists &&
  compareProject(envs[".env"], envs[".env.local"]) === false
) {
  warnings.push(".env and .env.local point to different Neon projects");
}

const recommendations = [
  "Keep .env.local aligned with the active env source recorded in .env.active.json.",
  "Keep .env.vercel mapped to the production Vercel/Neon branch.",
  "Use .env only as a local fallback; it should not contradict .env.local.",
];

console.log(
  JSON.stringify(
    {
      status: warnings.length ? "WARN" : "OK",
      active_env: activeEnv,
      files: envs,
      project_alignment: {
        env_matches_local: compareProject(envs[".env"], envs[".env.local"]),
        local_matches_vercel: compareProject(envs[".env.local"], envs[".env.vercel"]),
      },
      warnings,
      recommendations,
    },
    null,
    2
  )
);
