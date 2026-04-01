import "dotenv/config";
import { Pool } from "pg";
import { JOB_NAMES } from "../src/lib/jobNames";

const STAGES = [
  { stage: "trend", names: [JOB_NAMES.TREND_INGEST, JOB_NAMES.TREND_EXPAND, JOB_NAMES.TREND_EXPAND_REFRESH] },
  { stage: "supplier", names: [JOB_NAMES.SUPPLIER_DISCOVER] },
  { stage: "marketplace", names: [JOB_NAMES.SCAN_MARKETPLACE_PRICE] },
  { stage: "matching", names: [JOB_NAMES.MATCH_PRODUCT] },
  { stage: "profit", names: [JOB_NAMES.EVAL_PROFIT] },
  { stage: "listing_performance", names: [JOB_NAMES.LISTING_OPTIMIZE] },
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
    let recentWorkerActivityTs: string | null = null;
    const now = Date.now();
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
      const latestSuccess = result.rows[0]?.latest_success ?? null;
      const latestFailure = result.rows[0]?.latest_failure ?? null;
      const latestSuccessTs = latestSuccess ? new Date(String(latestSuccess)).getTime() : NaN;
      const staleThresholdMs =
        stage.stage === "trend" || stage.stage === "supplier" || stage.stage === "listing_performance"
          ? 8 * 60 * 60 * 1000
          : 6 * 60 * 60 * 1000;
      summary.push({
        stage: stage.stage,
        jobNames: stage.names,
        latestSuccess,
        latestFailure,
        successCount: Number(result.rows[0]?.success_count ?? 0),
        failureCount: Number(result.rows[0]?.failure_count ?? 0),
        minutesSinceLatestSuccess: Number.isFinite(latestSuccessTs)
          ? Math.floor((now - latestSuccessTs) / (60 * 1000))
          : null,
        staleThresholdMinutes: Math.floor(staleThresholdMs / (60 * 1000)),
        stale:
          !Number.isFinite(latestSuccessTs) ||
          now - latestSuccessTs > staleThresholdMs,
      });

      const stageLatest = String(latestSuccess ?? "");
      if (stageLatest && (!recentWorkerActivityTs || new Date(stageLatest) > new Date(recentWorkerActivityTs))) {
        recentWorkerActivityTs = stageLatest;
      }
    }

    const workerAlive =
      recentWorkerActivityTs != null &&
      Number.isFinite(new Date(recentWorkerActivityTs).getTime()) &&
      now - new Date(recentWorkerActivityTs).getTime() <= 30 * 60 * 1000;
    const workerIdleMinutes =
      recentWorkerActivityTs != null && Number.isFinite(new Date(recentWorkerActivityTs).getTime())
        ? Math.floor((now - new Date(recentWorkerActivityTs).getTime()) / (60 * 1000))
        : null;

    const staleStages = summary
      .filter((stage) => stage.stale)
      .map((stage) => stage.stage);

    console.log(
      JSON.stringify(
        {
          worker: "jobs.worker",
          now: new Date(now).toISOString(),
          recentWorkerActivityTs,
          workerAlive,
          workerIdleMinutes,
          staleStages,
          summary,
        },
        null,
        2
      )
    );
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
