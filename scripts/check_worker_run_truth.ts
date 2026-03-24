import "dotenv/config";
import { Pool } from "pg";
import { JOB_NAMES } from "../src/lib/jobNames";

const STAGES = [
  { stage: "trend", names: [JOB_NAMES.TREND_INGEST, JOB_NAMES.TREND_EXPAND, JOB_NAMES.TREND_EXPAND_REFRESH] },
  { stage: "supplier", names: [JOB_NAMES.SUPPLIER_DISCOVER] },
  { stage: "marketplace", names: [JOB_NAMES.SCAN_MARKETPLACE_PRICE] },
  { stage: "matching", names: [JOB_NAMES.MATCH_PRODUCT] },
  { stage: "profit", names: [JOB_NAMES.EVAL_PROFIT] },
];

function dbUrl() {
  return process.env.DATABASE_URL || process.env.DATABASE_URL_DIRECT || "";
}

async function main() {
  if (!dbUrl()) throw new Error("Missing DATABASE_URL or DATABASE_URL_DIRECT");
  const pool = new Pool({
    connectionString: dbUrl(),
    ssl: { rejectUnauthorized: false },
  });

  try {
    const summary = [];
    for (const stage of STAGES) {
      const result = await pool.query(
        `
          select
            max(case when upper(status) = 'SUCCEEDED' then coalesce(finished_at, started_at) end) as latest_success,
            max(case when upper(status) = 'FAILED' then coalesce(finished_at, started_at) end) as latest_failure,
            count(*) filter (where upper(status) = 'SUCCEEDED')::int as success_count,
            count(*) filter (where upper(status) = 'FAILED')::int as failure_count
          from worker_runs
          where worker = 'jobs.worker'
            and job_name = any($1::text[])
        `,
        [stage.names]
      );
      summary.push({
        stage: stage.stage,
        jobNames: stage.names,
        latestSuccess: result.rows[0]?.latest_success ?? null,
        latestFailure: result.rows[0]?.latest_failure ?? null,
        successCount: Number(result.rows[0]?.success_count ?? 0),
        failureCount: Number(result.rows[0]?.failure_count ?? 0),
      });
    }

    console.log(JSON.stringify({ worker: "jobs.worker", summary }, null, 2));
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

