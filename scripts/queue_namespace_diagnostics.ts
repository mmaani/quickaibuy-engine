import "dotenv/config";
import {
  assertSafeQueueNamespace,
  getQueueNamespaceDiagnostics,
} from "../src/lib/queueNamespace";

function main() {
  const diagnostics = getQueueNamespaceDiagnostics();

  try {
    assertSafeQueueNamespace("queue-namespace-diagnostics");
  } catch (error) {
    console.log(
      JSON.stringify(
        {
          status: "FAILED",
          reason: error instanceof Error ? error.message : String(error),
          diagnostics,
        },
        null,
        2
      )
    );
    process.exit(1);
  }

  console.log(
    JSON.stringify(
      {
        status: "OK",
        diagnostics,
      },
      null,
      2
    )
  );
}

main();
