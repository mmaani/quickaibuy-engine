#!/usr/bin/env node
import fs from "node:fs";
import dotenv from "dotenv";
import { Pool } from "pg";

const dotenvPath = process.env.DOTENV_CONFIG_PATH?.trim() || ".env.local";

dotenv.config({ path: dotenvPath });
dotenv.config();

const verbose = process.env.DIAG_VERBOSE === "1";

function classify(error) {
  const detail =
    error instanceof Error
      ? error.message || error.stack || error.name || String(error)
      : String(error);
  const lower = detail.toLowerCase();

  if (lower.includes("eai_again") || lower.includes("enotfound") || lower.includes("dns")) {
    return {
      class: "DNS_FAILURE",
      reason: "Database hostname DNS lookup failed",
      nextStep: "Verify Neon hostname resolution and retry in 30-60 seconds.",
      detail,
    };
  }
  if (
    lower.includes("econnrefused") ||
    lower.includes("timeout") ||
    lower.includes("etimedout") ||
    lower.includes("enetunreach")
  ) {
    return {
      class: "NETWORK_UNREACHABLE",
      reason: "Database network endpoint unreachable",
      nextStep: "Check database endpoint/network routing and retry.",
      detail,
    };
  }
  if (lower.includes("password") || lower.includes("auth") || lower.includes("permission")) {
    return {
      class: "AUTH_FAILURE",
      reason: "Database authentication failed",
      nextStep: "Verify DATABASE_URL credentials and retry.",
      detail,
    };
  }
  if (lower.includes("missing") || lower.includes("invalid")) {
    return {
      class: "CONFIG_MISSING",
      reason: "Database configuration missing or invalid",
      nextStep: "Set DATABASE_URL or DATABASE_URL_DIRECT correctly.",
      detail,
    };
  }
  return {
    class: "UNKNOWN",
    reason: "Database fingerprint check failed",
    nextStep: "Run with DIAG_VERBOSE=1 for full stack details.",
    detail,
  };
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runFingerprint(pool, connectionString) {
  const dbMeta = await pool.query(`
    SELECT
      current_database() AS db_name,
      current_user AS db_user,
      inet_server_addr()::text AS server_addr,
      inet_server_port() AS server_port
  `);

  const approvedCount = await pool.query(
    `SELECT count(*)::int AS n FROM profitable_candidates WHERE decision_status = 'APPROVED'`
  );

  const latestApproved = await pool.query(
    `
      SELECT id, decision_status, calc_ts
      FROM profitable_candidates
      WHERE decision_status = 'APPROVED'
      ORDER BY calc_ts DESC NULLS LAST
      LIMIT 5
    `
  );

  const listingsExistsRes = await pool.query(`
    SELECT EXISTS (
      SELECT 1
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name = 'listings'
    ) AS exists
  `);
  const listingsExists = Boolean(listingsExistsRes.rows[0]?.exists);
  const listingsCount = listingsExists
    ? await pool.query(`SELECT count(*)::int AS n FROM listings`)
    : { rows: [{ n: 0 }] };

  let dbUrlHost = null;
  let dbUrlName = null;
  try {
    const parsed = new URL(connectionString);
    dbUrlHost = parsed.hostname;
    dbUrlName = parsed.pathname.replace(/^\//, "") || null;
  } catch {}

  return {
    status: "OK",
    envFileChecked: fs.existsSync(dotenvPath) ? dotenvPath : null,
    dbUrlFingerprint: {
      host: dbUrlHost,
      databaseName: dbUrlName,
    },
    runtimeDb: dbMeta.rows[0] ?? null,
    approvedCandidatesCount: approvedCount.rows[0]?.n ?? 0,
    latestApprovedCandidates: latestApproved.rows,
    listingsTableExists: listingsExists,
    listingsCount: listingsCount.rows[0]?.n ?? 0,
  };
}

async function main() {
  const connectionString = process.env.DATABASE_URL_DIRECT || process.env.DATABASE_URL;
  if (!connectionString) {
    const payload = {
      status: "FAILED",
      class: "CONFIG_MISSING",
      reason: "Missing DATABASE_URL or DATABASE_URL_DIRECT",
      nextStep: `Set DATABASE_URL in ${dotenvPath} or runtime env and retry.`,
    };
    console.log(JSON.stringify(payload, null, 2));
    process.exit(1);
    return;
  }

  const pool = new Pool({
    connectionString,
    ssl: { rejectUnauthorized: true },
  });

  const maxAttempts = 3;
  let lastError = null;

  try {
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        const payload = await runFingerprint(pool, connectionString);
        payload.attempt = attempt;
        payload.maxAttempts = maxAttempts;
        console.log(JSON.stringify(payload, null, 2));
        return;
      } catch (error) {
        lastError = error;
        const msg = (error instanceof Error ? error.message : String(error)).toLowerCase();
        const shouldRetry = msg.includes("eai_again");
        if (!shouldRetry || attempt === maxAttempts) {
          throw error;
        }
        await wait(500);
      }
    }
  } catch (error) {
    const c = classify(error);
    const payload = {
      status: "FAILED",
      class: c.class,
      reason: c.reason,
      nextStep: c.nextStep,
      detail: c.detail,
    };
    console.log(JSON.stringify(payload, null, 2));
    if (verbose) {
      console.error(lastError ?? error);
    }
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  const c = classify(error);
  console.log(
    JSON.stringify(
      {
        status: "FAILED",
        class: c.class,
        reason: c.reason,
        nextStep: c.nextStep,
        detail: c.detail,
      },
      null,
      2
    )
  );
  if (verbose) {
    console.error(error);
  }
  process.exit(1);
});
