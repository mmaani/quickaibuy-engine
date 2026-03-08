#!/usr/bin/env node
import fs from "node:fs";
import dotenv from "dotenv";
import { Pool } from "pg";

dotenv.config({ path: ".env.local" });
dotenv.config();

const connectionString = process.env.DATABASE_URL_DIRECT || process.env.DATABASE_URL;
if (!connectionString) {
  console.error("Missing DATABASE_URL or DATABASE_URL_DIRECT.");
  process.exit(1);
}

const pool = new Pool({
  connectionString,
  ssl: { rejectUnauthorized: true },
});

async function main() {
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

  const payload = {
    envFileChecked: fs.existsSync(".env.local") ? ".env.local" : null,
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

  console.log(JSON.stringify(payload, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await pool.end();
  });
