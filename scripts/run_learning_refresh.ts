import { runContinuousLearningRefresh } from "@/lib/learningHub/continuousLearning";

async function main() {
  const result = await runContinuousLearningRefresh({
    trigger: "manual_cli",
    forceFull: true,
  });

  const failed = result.stages.filter((stage) => stage.status === "failed");
  const totalDomains = result.freshness.domains.length;
  const freshDomains =
    totalDomains - result.freshness.staleDomainCount - result.freshness.warningDomainCount;
  console.log(
    JSON.stringify(
      {
        ok: result.ok,
        generatedAt: result.generatedAt,
        trigger: result.trigger,
        failedStages: failed.map((stage) => ({ key: stage.key, error: stage.error ?? null })),
        freshness: {
          totalDomains,
          freshDomains,
          warningDomainCount: result.freshness.warningDomainCount,
          staleDomainCount: result.freshness.staleDomainCount,
          autonomyPauseReasons: result.freshness.autonomyPauseReasons,
        },
      },
      null,
      2
    )
  );

  if (!result.ok) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(
    JSON.stringify(
      {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      },
      null,
      2
    )
  );
  process.exitCode = 1;
});
