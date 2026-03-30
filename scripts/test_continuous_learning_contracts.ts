import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CONTINUOUS_LEARNING_SCHEDULE } from "@/lib/jobs/enqueueContinuousLearningSchedules";
import { JOB_NAMES } from "@/lib/jobNames";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

async function main() {
  const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const pipelineWritersPath = path.join(rootDir, "src/lib/learningHub/pipelineWriters.ts");
  const freshnessPath = path.join(rootDir, "src/lib/learningHub/freshness.ts");
  const controlPlanePath = path.join(rootDir, "src/lib/controlPlane/getControlPlaneOverview.ts");
  const workerPath = path.join(rootDir, "src/workers/jobs.worker.ts");

  const [pipelineWriters, freshness, controlPlane, worker] = await Promise.all([
    readFile(pipelineWritersPath, "utf8"),
    readFile(freshnessPath, "utf8"),
    readFile(controlPlanePath, "utf8"),
    readFile(workerPath, "utf8"),
  ]);

  assert(JOB_NAMES.CONTINUOUS_LEARNING_REFRESH === "learning:continuous-refresh", "job name drifted");
  assert(CONTINUOUS_LEARNING_SCHEDULE.orchestrationOrder.length === 9, "unexpected stage count");
  assert(pipelineWriters.includes("writePipelineLearningEvent"), "canonical learning writer missing");
  assert(!pipelineWriters.includes("async function writeStageEvidence"), "legacy stage writer still present");
  assert(pipelineWriters.includes("recordCustomerOutcomeLearning"), "customer outcome learning missing");
  assert(freshness.includes("supplier_intelligence"), "supplier freshness policy missing");
  assert(freshness.includes("control_plane_scorecards"), "control-plane freshness policy missing");
  assert(controlPlane.includes("continuousLearning"), "control-plane continuous learning payload missing");
  assert(controlPlane.includes("staleWarnings"), "control-plane stale warnings missing");
  assert(worker.includes("CONTINUOUS_LEARNING_REFRESH_COMPLETED"), "worker audit event missing");

  console.log("continuous-learning contracts: ok");
  console.log(`job: ${JOB_NAMES.CONTINUOUS_LEARNING_REFRESH}`);
  console.log(`cadence_hours: ${CONTINUOUS_LEARNING_SCHEDULE.everyMs / (60 * 60 * 1000)}`);
  console.log(`stages: ${CONTINUOUS_LEARNING_SCHEDULE.orchestrationOrder.join(",")}`);
  process.exit(0);
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
