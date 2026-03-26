import "dotenv/config";
import { BULL_PREFIX, JOBS_QUEUE_NAME } from "../src/lib/jobs/jobNames";
import { getUpstreamRecurringScheduleSnapshot } from "../src/lib/jobs/enqueueUpstreamSchedules";

async function main() {
  const summary = await getUpstreamRecurringScheduleSnapshot();
  const missingStages = summary.filter((item) => !item.active).map((item) => item.stage);
  const nextRunMissingStages = summary.filter((item) => item.active && !item.nextRun).map((item) => item.stage);

  console.log(
    JSON.stringify(
      {
        queue: JOBS_QUEUE_NAME,
        prefix: BULL_PREFIX,
        configuredStages: summary.filter((item) => item.active).length,
        totalStages: summary.length,
        missingStages,
        nextRunMissingStages,
        summary,
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
