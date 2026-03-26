import "dotenv/config";
import { Pool } from "pg";
import { JOB_NAMES } from "../src/lib/jobNames";

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
    const [freshness, listings] = await Promise.all([
      pool.query(`
        with worker_truth as (
          select
            job_name,
            max(case when upper(status) = 'SUCCEEDED' then coalesce(finished_at, started_at) end) as latest_success,
            max(case when upper(status) = 'FAILED' then coalesce(finished_at, started_at) end) as latest_failure,
            count(*) filter (where upper(status) = 'SUCCEEDED')::int as success_count,
            count(*) filter (where upper(status) = 'FAILED')::int as failure_count
          from worker_runs
          where worker = 'jobs.worker'
            and job_name in (
              '${JOB_NAMES.TREND_EXPAND_REFRESH}',
              '${JOB_NAMES.SUPPLIER_DISCOVER}',
              '${JOB_NAMES.SCAN_MARKETPLACE_PRICE}',
              '${JOB_NAMES.MATCH_PRODUCT}',
              '${JOB_NAMES.EVAL_PROFIT}',
              '${JOB_NAMES.LISTING_OPTIMIZE}'
            )
          group by job_name
        )
        select * from worker_truth order by job_name asc
      `),
      pool.query(`
        select
          count(*) filter (where upper(status) = 'ACTIVE')::int as active_listings,
          count(*) filter (
            where upper(status) = 'ACTIVE'
              and (response->'listingPerformance') is not null
          )::int as listing_performance_rows_present,
          count(*) filter (
            where upper(status) = 'ACTIVE'
              and lower(coalesce(response->'listingPerformance'->'readiness'->>'commercialState', '')) = 'dead_listing'
          )::int as dead_listings,
          count(*) filter (
            where upper(status) = 'ACTIVE'
              and coalesce(response->'listingPerformance'->'readiness'->'weakSignals'->>'zeroViews', 'false') = 'true'
          )::int as zero_view_listings,
          count(*) filter (
            where upper(status) = 'ACTIVE'
              and coalesce(response->'listingPerformance'->'readiness'->'weakSignals'->>'lowTraffic', 'false') = 'true'
          )::int as low_traffic_listings,
          count(*) filter (
            where upper(status) = 'ACTIVE'
              and coalesce(response->'listingPerformance'->'optimization'->>'titleChanged', 'false') = 'true'
          )::int as title_optimized,
          count(*) filter (
            where upper(status) = 'ACTIVE'
              and coalesce(response->'listingPerformance'->'optimization'->>'itemSpecificsImproved', 'false') = 'true'
          )::int as specifics_improved,
          count(*) filter (
            where upper(status) = 'ACTIVE'
              and (response->'listingPerformance'->'promoted'->'adjustment') is not null
          )::int as promoted_adjusted
        from listings
        where lower(coalesce(marketplace_key, '')) = 'ebay'
      `),
    ]);

    const workerRows = freshness.rows;
    const listingMetrics = listings.rows[0] ?? {};
    const listingOptimizeRow = workerRows.find((row) => String(row.job_name) === JOB_NAMES.LISTING_OPTIMIZE) ?? null;
    const latestListingOptimizeTs = String(listingOptimizeRow?.latest_success ?? "").trim();
    const listingOptimizeRunning =
      Boolean(latestListingOptimizeTs) &&
      Number.isFinite(new Date(latestListingOptimizeTs).getTime()) &&
      Date.now() - new Date(latestListingOptimizeTs).getTime() <= 8 * 60 * 60 * 1000;
    const listingPerformanceRowsPresent = Number(listingMetrics.listing_performance_rows_present ?? 0) > 0;
    const revenuePathReady =
      Number(listingMetrics.active_listings ?? 0) === 0 ||
      (listingOptimizeRunning && listingPerformanceRowsPresent);

    console.log(
      JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          worker: freshness.rows,
          listingOptimizeRunning,
          listingPerformanceRowsPresent,
          revenuePathReady,
          listings: listingMetrics,
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
