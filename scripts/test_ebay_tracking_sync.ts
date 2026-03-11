import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });
dotenv.config();

async function main() {
  const orderId = String(process.argv[2] ?? "").trim();
  const supplierOrderId = String(process.argv[3] ?? "").trim() || undefined;
  const runLive = String(process.argv[4] ?? "false").toLowerCase() === "true";

  if (!orderId) {
    throw new Error(
      "Usage: pnpm exec tsx scripts/test_ebay_tracking_sync.ts <orderId> [supplierOrderId] [runLive=true|false]"
    );
  }

  const {
    getTrackingSyncReadiness,
    prepareTrackingSyncPayload,
  } = await import("../src/lib/orders/trackingSync");
  const { syncTrackingToEbay, getTrackingSyncAttemptState } = await import(
    "../src/lib/orders/syncTrackingToEbay"
  );

  const readiness = await getTrackingSyncReadiness({ orderId, supplierOrderId });
  console.log(JSON.stringify({ step: "readiness", readiness }, null, 2));

  if (!readiness.ready) {
    return;
  }

  const payload = await prepareTrackingSyncPayload({ orderId, supplierOrderId });
  console.log(
    JSON.stringify(
      {
        step: "payload",
        payloadPreview: {
          orderId: payload.orderId,
          marketplaceOrderId: payload.marketplaceOrderId,
          supplierOrderId: payload.supplierOrderId,
          supplierKey: payload.supplierKey,
          orderStatus: payload.orderStatus,
          purchaseStatus: payload.purchaseStatus,
          tracking: payload.tracking,
          itemCount: payload.items.length,
        },
      },
      null,
      2
    )
  );

  if (!runLive) {
    console.log(
      JSON.stringify(
        {
          step: "execution",
          mode: "dry",
          note: "Live call skipped. Pass runLive=true and ENABLE_EBAY_TRACKING_SYNC=true for real eBay submission.",
        },
        null,
        2
      )
    );
    return;
  }

  const result = await syncTrackingToEbay({
    orderId,
    supplierOrderId,
    actorId: "scripts/test_ebay_tracking_sync.ts",
  });
  console.log(JSON.stringify({ step: "execution", mode: "live", result }, null, 2));

  if (result.supplierOrderId) {
    const state = await getTrackingSyncAttemptState({
      orderId,
      supplierOrderId: result.supplierOrderId,
    });
    console.log(JSON.stringify({ step: "attempt_state", state }, null, 2));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
