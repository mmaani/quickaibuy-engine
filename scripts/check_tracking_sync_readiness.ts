import { loadRuntimeEnv } from "./lib/runtimeEnv.mjs";

loadRuntimeEnv();

async function main() {
  const orderIdArg = process.argv[2]?.trim() || null;
  const {
    getOrderTrackingConsoleRows,
    getTrackingSyncReadiness,
    prepareTrackingSyncPayload,
  } = await import("../src/lib/orders/trackingSync");

  if (orderIdArg) {
    const readiness = await getTrackingSyncReadiness({ orderId: orderIdArg });
    console.log(JSON.stringify({ mode: "single", orderId: orderIdArg, readiness }, null, 2));

    if (readiness.ready) {
      const payload = await prepareTrackingSyncPayload({ orderId: orderIdArg });
      console.log(JSON.stringify({ mode: "single", payload }, null, 2));
    }
    return;
  }

  const rows = await getOrderTrackingConsoleRows(20);
  const sampled = rows.slice(0, 5);

  const readiness = [] as Array<Record<string, unknown>>;
  for (const row of sampled) {
    const status = await getTrackingSyncReadiness({ orderId: row.orderId });
    readiness.push({
      orderId: row.orderId,
      ebayOrderId: row.ebayOrderId,
      status: row.status,
      ready: status.ready,
      blockingReasons: status.blockingReasons,
      missingFields: status.missingFields,
    });
  }

  console.log(
    JSON.stringify(
      {
        mode: "sample",
        totalRows: rows.length,
        sampled: sampled.map((r) => ({
          orderId: r.orderId,
          ebayOrderId: r.ebayOrderId,
          status: r.status,
          supplierKey: r.supplierKey,
          purchaseStatus: r.purchaseStatus,
          trackingStatus: r.trackingStatus,
          trackingCarrier: r.trackingCarrier,
        })),
        readiness,
      },
      null,
      2
    )
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
