import "dotenv/config";
import { Queue, type ConnectionOptions } from "bullmq";
import { BULL_PREFIX, JOBS_QUEUE_NAME, JOB_NAMES } from "../src/lib/jobs/jobNames";
import { bullConnection } from "../src/lib/bull";

const EXPECTED = [
  { stage: "trend", jobName: JOB_NAMES.TREND_EXPAND_REFRESH, idPrefix: "trend-expand-refresh-", everyMs: 21600000 },
  { stage: "supplier", jobName: JOB_NAMES.SUPPLIER_DISCOVER, idPrefix: "supplier-discover-", everyMs: 21600000 },
  { stage: "marketplace", jobName: JOB_NAMES.SCAN_MARKETPLACE_PRICE, idPrefix: "marketplace-scan-", everyMs: 14400000 },
  { stage: "matching", jobName: JOB_NAMES.MATCH_PRODUCT, idPrefix: "match-product-", everyMs: 14400000 },
  { stage: "profit", jobName: JOB_NAMES.EVAL_PROFIT, idPrefix: "eval-profit-", everyMs: 14400000 },
];

async function main() {
  const queue = new Queue(JOBS_QUEUE_NAME, {
    connection: bullConnection as ConnectionOptions,
    prefix: BULL_PREFIX,
  });

  const [repeatables, schedulers] = await Promise.all([
    queue.getRepeatableJobs(0, 500),
    queue.getJobSchedulers(0, 500),
  ]);
  const summary = EXPECTED.map((item) => {
    const matchingRepeatables = repeatables.filter(
      (entry) =>
        entry.name === item.jobName &&
        Number(entry.every ?? 0) === item.everyMs
    );
    const matchingSchedulers = schedulers.filter(
      (entry) =>
        entry.name === item.jobName &&
        Number(entry.every ?? 0) === item.everyMs
    );
    const allMatches = [...matchingSchedulers, ...matchingRepeatables];
    return {
      stage: item.stage,
      jobName: item.jobName,
      expectedEveryMs: item.everyMs,
      matchedEntries: allMatches.length,
      active: allMatches.length > 0,
      nextRun: allMatches[0]?.next ? new Date(Number(allMatches[0].next)).toISOString() : null,
    };
  });

  console.log(JSON.stringify({ queue: JOBS_QUEUE_NAME, prefix: BULL_PREFIX, summary }, null, 2));
  await queue.close();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
