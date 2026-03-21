import { classifyError } from "./lib/runtimeDiagnostics";
import { loadRuntimeEnv } from "./lib/runtimeEnv.mjs";

loadRuntimeEnv();

async function main() {
  const limit = Number(process.argv[2] ?? "50");

  const { getOrderTrackingConsoleRows, getTrackingSyncReadiness } = await import(
    "../src/lib/orders/trackingSync"
  );

  let rows: Awaited<ReturnType<typeof getOrderTrackingConsoleRows>>;
  try {
    rows = await getOrderTrackingConsoleRows(limit);
  } catch (error) {
    const c = classifyError(error);
    console.log(
      JSON.stringify(
        {
          status: "FAILED",
          class: c.status,
          reason: c.reason,
          nextStep: c.nextStep,
          detail: c.detail,
        },
        null,
        2
      )
    );
    process.exit(1);
    return;
  }

  if (!rows.length) {
    console.log(
      JSON.stringify(
        {
          status: "NO_TEST_ORDER_AVAILABLE",
          reason: "No orders found in current environment.",
          checkedRows: 0,
          nextStep: "Sync/import at least one eBay order, then rerun this helper.",
        },
        null,
        2
      )
    );
    return;
  }

  const blockingCounts = new Map<string, number>();
  for (const row of rows) {
    const readiness = await getTrackingSyncReadiness({ orderId: row.orderId });
    if (readiness.ready) {
      console.log(
        JSON.stringify(
          {
            status: "OK",
            readyOrderId: row.orderId,
            marketplaceOrderId: row.ebayOrderId,
            checkedRows: rows.length,
            nextStep: `Run: pnpm exec tsx scripts/test_ebay_tracking_sync.ts ${row.orderId}`,
          },
          null,
          2
        )
      );
      return;
    }

    for (const reason of readiness.blockingReasons) {
      blockingCounts.set(reason, (blockingCounts.get(reason) ?? 0) + 1);
    }
  }

  console.log(
    JSON.stringify(
      {
        status: "NO_TEST_ORDER_AVAILABLE",
        reason: "Orders exist, but none are ready for tracking sync validation.",
        checkedRows: rows.length,
        topBlockingReasons: [...blockingCounts.entries()]
          .sort((a, b) => b[1] - a[1])
          .slice(0, 5)
          .map(([reason, count]) => ({ reason, count })),
        nextStep: "Complete missing purchase/tracking fields on one order, then rerun this helper.",
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  const c = classifyError(error);
  console.log(
    JSON.stringify(
      {
        status: "FAILED",
        class: c.status,
        reason: c.reason,
        nextStep: c.nextStep,
        detail: c.detail,
      },
      null,
      2
    )
  );
  process.exit(1);
});
