import dotenv from "dotenv";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import type { db as DbClient } from "@/lib/db";
import type { markListingReadyToPublish as MarkListingReadyToPublishFn } from "@/lib/listings/markListingReadyToPublish";
import type { computeRecoveryState as ComputeRecoveryStateFn } from "@/lib/listings/recoveryState";
import type { reevaluateListingForRecovery as ReevaluateListingForRecoveryFn } from "@/lib/listings/recovery";
import type { resumePausedListing as ResumePausedListingFn } from "@/lib/listings/resumePausedListing";
import type { runInventoryRiskMonitor as RunInventoryRiskMonitorFn } from "@/lib/risk/inventoryRiskMonitor";
import type { runListingExecution as RunListingExecutionFn } from "@/workers/listingExecute.worker";
import type { runListingMonitor as RunListingMonitorFn } from "@/workers/listingMonitor.worker";

dotenv.config({ path: ".env.local" });
dotenv.config();

let db: typeof DbClient;
let markListingReadyToPublish: typeof MarkListingReadyToPublishFn;
let computeRecoveryState: typeof ComputeRecoveryStateFn;
let reevaluateListingForRecovery: typeof ReevaluateListingForRecoveryFn;
let resumePausedListing: typeof ResumePausedListingFn;
let runInventoryRiskMonitor: typeof RunInventoryRiskMonitorFn;
let runListingExecution: typeof RunListingExecutionFn;
let runListingMonitor: typeof RunListingMonitorFn;

const FIXTURE_SUPPLIER_KEY = "paused-lifecycle-validation";
const FIXTURE_MARKETPLACE_KEY = "ebay";
const FIXTURE_MARKETPLACE_PRICE = 64.99;
const FIXTURE = {
  listingId: "15450a73-e919-4631-b5cb-7d51177c0001",
  candidateId: "15450a73-e919-4631-b5cb-7d51177c0101",
  supplierProductId: "paused-lifecycle-guardrail",
  marketplaceListingId: "paused-lifecycle-ebay-guardrail",
  baselineSupplierSnapshotId: "15450a73-e919-4631-b5cb-7d51177c0201",
  marketplaceSnapshotId: "15450a73-e919-4631-b5cb-7d51177c0301",
  idempotencyKey: "paused-lifecycle-guardrail",
} as const;

const ACTORS = {
  riskPause: "scripts/test_paused_listing_lifecycle_guardrails:risk-pause",
  riskPausedStability: "scripts/test_paused_listing_lifecycle_guardrails:risk-paused-stability",
  executePaused: "scripts/test_paused_listing_lifecycle_guardrails:execute-paused",
  executePreview: "scripts/test_paused_listing_lifecycle_guardrails:execute-preview",
  monitor: "scripts/test_paused_listing_lifecycle_guardrails:monitor",
  resume: "scripts/test_paused_listing_lifecycle_guardrails:resume",
  promotePaused: "scripts/test_paused_listing_lifecycle_guardrails:promote-paused",
  reevaluatePaused: "scripts/test_paused_listing_lifecycle_guardrails:reevaluate-paused",
  reevaluatePreview: "scripts/test_paused_listing_lifecycle_guardrails:reevaluate-preview",
  promoteReady: "scripts/test_paused_listing_lifecycle_guardrails:promote-ready",
} as const;

type ListingSnapshot = {
  listingId: string;
  candidateId: string;
  listingStatus: string;
  decisionStatus: string;
  listingEligible: boolean;
  listingBlockReason: string | null;
  inventoryRisk: unknown;
  lastPublishError: string | null;
};

type AuditRow = {
  actorId: string | null;
  eventType: string;
  details: unknown;
  eventTs: Date | string;
};

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

async function upsertById(updateStatement: ReturnType<typeof sql>, insertStatement: ReturnType<typeof sql>) {
  const result = await db.execute<{ id: string }>(updateStatement);
  if ((result.rows?.length ?? 0) > 0) {
    return;
  }
  await db.execute(insertStatement);
}

async function resetFixtureState() {
  await db.execute(sql`
    DELETE FROM audit_log
    WHERE entity_type = 'LISTING'
      AND entity_id = ${FIXTURE.listingId}
      AND actor_id LIKE 'scripts/test_paused_listing_lifecycle_guardrails:%'
  `);

  await db.execute(sql`
    DELETE FROM marketplace_prices
    WHERE marketplace_key = ${FIXTURE_MARKETPLACE_KEY}
      AND marketplace_listing_id = ${FIXTURE.marketplaceListingId}
  `);

  await db.execute(sql`
    DELETE FROM products_raw
    WHERE supplier_key = ${FIXTURE_SUPPLIER_KEY}
      AND supplier_product_id = ${FIXTURE.supplierProductId}
  `);

  await upsertById(
    sql`
      UPDATE profitable_candidates
      SET
        supplier_key = ${FIXTURE_SUPPLIER_KEY},
        supplier_product_id = ${FIXTURE.supplierProductId},
        marketplace_key = ${FIXTURE_MARKETPLACE_KEY},
        marketplace_listing_id = ${FIXTURE.marketplaceListingId},
        calc_ts = NOW(),
        supplier_snapshot_id = ${FIXTURE.baselineSupplierSnapshotId},
        market_price_snapshot_id = ${FIXTURE.marketplaceSnapshotId},
        estimated_fees = ${JSON.stringify({ marketplace: "ebay", total: 6.25 })}::jsonb,
        estimated_shipping = 4.5,
        estimated_cogs = 20,
        estimated_profit = 14.15,
        margin_pct = 21.77,
        roi_pct = 52.41,
        risk_flags = ARRAY['FIXTURE'],
        decision_status = 'APPROVED',
        reason = 'Paused lifecycle validation fixture',
        approved_ts = NOW(),
        approved_by = 'paused-lifecycle-validation',
        listing_eligible = TRUE,
        listing_eligible_ts = NOW(),
        listing_block_reason = NULL
      WHERE id = ${FIXTURE.candidateId}
      RETURNING id
    `,
    sql`
      INSERT INTO profitable_candidates (
        id,
        supplier_key,
        supplier_product_id,
        marketplace_key,
        marketplace_listing_id,
        calc_ts,
        supplier_snapshot_id,
        market_price_snapshot_id,
        estimated_fees,
        estimated_shipping,
        estimated_cogs,
        estimated_profit,
        margin_pct,
        roi_pct,
        risk_flags,
        decision_status,
        reason,
        approved_ts,
        approved_by,
        listing_eligible,
        listing_eligible_ts,
        listing_block_reason
      ) VALUES (
        ${FIXTURE.candidateId},
        ${FIXTURE_SUPPLIER_KEY},
        ${FIXTURE.supplierProductId},
        ${FIXTURE_MARKETPLACE_KEY},
        ${FIXTURE.marketplaceListingId},
        NOW(),
        ${FIXTURE.baselineSupplierSnapshotId},
        ${FIXTURE.marketplaceSnapshotId},
        ${JSON.stringify({ marketplace: "ebay", total: 6.25 })}::jsonb,
        4.5,
        20,
        14.15,
        21.77,
        52.41,
        ARRAY['FIXTURE'],
        'APPROVED',
        'Paused lifecycle validation fixture',
        NOW(),
        'paused-lifecycle-validation',
        TRUE,
        NOW(),
        NULL
      )
    `
  );

  await upsertById(
    sql`
      UPDATE listings
      SET
        candidate_id = ${FIXTURE.candidateId},
        marketplace_key = ${FIXTURE_MARKETPLACE_KEY},
        status = 'ACTIVE',
        title = 'Paused Lifecycle Guardrail Fixture',
        price = ${FIXTURE_MARKETPLACE_PRICE},
        quantity = 2,
        payload = ${JSON.stringify({
          shipFromCountry: "US",
          fixture: true,
          scenario: "paused-lifecycle",
        })}::jsonb,
        response = '{}'::jsonb,
        publish_marketplace = NULL,
        publish_started_ts = NULL,
        publish_finished_ts = NULL,
        published_external_id = NULL,
        publish_attempt_count = 0,
        last_publish_error = NULL,
        listing_date = CURRENT_DATE,
        idempotency_key = ${FIXTURE.idempotencyKey},
        updated_at = NOW()
      WHERE id = ${FIXTURE.listingId}
      RETURNING id
    `,
    sql`
      INSERT INTO listings (
        id,
        candidate_id,
        marketplace_key,
        status,
        title,
        price,
        quantity,
        payload,
        response,
        publish_marketplace,
        publish_started_ts,
        publish_finished_ts,
        published_external_id,
        publish_attempt_count,
        last_publish_error,
        listing_date,
        idempotency_key
      ) VALUES (
        ${FIXTURE.listingId},
        ${FIXTURE.candidateId},
        ${FIXTURE_MARKETPLACE_KEY},
        'ACTIVE',
        'Paused Lifecycle Guardrail Fixture',
        ${FIXTURE_MARKETPLACE_PRICE},
        2,
        ${JSON.stringify({
          shipFromCountry: "US",
          fixture: true,
          scenario: "paused-lifecycle",
        })}::jsonb,
        '{}'::jsonb,
        NULL,
        NULL,
        NULL,
        NULL,
        0,
        NULL,
        CURRENT_DATE,
        ${FIXTURE.idempotencyKey}
      )
    `
  );

  await db.execute(sql`
    INSERT INTO products_raw (
      id,
      supplier_key,
      supplier_product_id,
      source_url,
      title,
      currency,
      price_min,
      price_max,
      availability_status,
      shipping_estimates,
      raw_payload,
      snapshot_ts
    ) VALUES (
      ${FIXTURE.baselineSupplierSnapshotId},
      ${FIXTURE_SUPPLIER_KEY},
      ${FIXTURE.supplierProductId},
      ${`https://fixtures.local/${FIXTURE.supplierProductId}`},
      'Paused lifecycle baseline',
      'USD',
      24.99,
      24.99,
      'IN_STOCK',
      ${JSON.stringify([{ shipFromCountry: "US", service: "Standard" }])}::jsonb,
      ${JSON.stringify({ stage: "BASELINE", availability: "IN_STOCK" })}::jsonb,
      NOW() - INTERVAL '4 hours'
    )
  `);

  await db.execute(sql`
    INSERT INTO marketplace_prices (
      id,
      marketplace_key,
      marketplace_listing_id,
      product_raw_id,
      supplier_key,
      supplier_product_id,
      trend_mode,
      matched_title,
      currency,
      price,
      shipping_price,
      availability_status,
      raw_payload,
      snapshot_ts
    ) VALUES (
      ${FIXTURE.marketplaceSnapshotId},
      ${FIXTURE_MARKETPLACE_KEY},
      ${FIXTURE.marketplaceListingId},
      ${FIXTURE.baselineSupplierSnapshotId},
      ${FIXTURE_SUPPLIER_KEY},
      ${FIXTURE.supplierProductId},
      FALSE,
      'Paused lifecycle baseline',
      'USD',
      ${FIXTURE_MARKETPLACE_PRICE},
      0,
      'IN_STOCK',
      ${JSON.stringify({ fixture: true, scenario: "paused-lifecycle" })}::jsonb,
      NOW() - INTERVAL '2 hours'
    )
  `);
}

async function insertSupplierSnapshot(input: {
  availability: "IN_STOCK" | "OUT_OF_STOCK";
  stage: "RISK_TRIGGER" | "RECOVERY";
}) {
  await db.execute(sql`
    INSERT INTO products_raw (
      id,
      supplier_key,
      supplier_product_id,
      source_url,
      title,
      currency,
      price_min,
      price_max,
      availability_status,
      shipping_estimates,
      raw_payload,
      snapshot_ts
    ) VALUES (
      ${randomUUID()},
      ${FIXTURE_SUPPLIER_KEY},
      ${FIXTURE.supplierProductId},
      ${`https://fixtures.local/${FIXTURE.supplierProductId}`},
      ${`Paused lifecycle ${input.stage}`},
      'USD',
      24.99,
      24.99,
      ${input.availability},
      ${JSON.stringify([{ shipFromCountry: "US", service: "Standard" }])}::jsonb,
      ${JSON.stringify({ stage: input.stage, availability: input.availability })}::jsonb,
      NOW()
    )
  `);
}

async function getListingSnapshot(): Promise<ListingSnapshot> {
  const result = await db.execute<ListingSnapshot>(sql`
    SELECT
      l.id AS "listingId",
      l.candidate_id AS "candidateId",
      l.status AS "listingStatus",
      pc.decision_status AS "decisionStatus",
      pc.listing_eligible AS "listingEligible",
      pc.listing_block_reason AS "listingBlockReason",
      (l.response::jsonb)->'inventoryRisk' AS "inventoryRisk",
      l.last_publish_error AS "lastPublishError"
    FROM listings l
    INNER JOIN profitable_candidates pc
      ON pc.id = l.candidate_id
    WHERE l.id = ${FIXTURE.listingId}
    LIMIT 1
  `);

  const row = result.rows?.[0];
  if (!row) {
    throw new Error(`Listing fixture missing: ${FIXTURE.listingId}`);
  }
  return row;
}

async function getAuditRows(): Promise<AuditRow[]> {
  const result = await db.execute<AuditRow>(sql`
    SELECT actor_id AS "actorId", event_type AS "eventType", details, event_ts AS "eventTs"
    FROM audit_log
    WHERE entity_type = 'LISTING'
      AND entity_id = ${FIXTURE.listingId}
      AND actor_id LIKE 'scripts/test_paused_listing_lifecycle_guardrails:%'
    ORDER BY event_ts ASC, event_type ASC
  `);

  return result.rows ?? [];
}

function hasAuditEvent(auditRows: AuditRow[], eventType: string, actorId?: string): boolean {
  return auditRows.some(
    (row) => row.eventType === eventType && (actorId == null || row.actorId === actorId)
  );
}

async function main() {
  ({ db } = await import("@/lib/db"));
  ({ markListingReadyToPublish } = await import("@/lib/listings/markListingReadyToPublish"));
  ({ computeRecoveryState } = await import("@/lib/listings/recoveryState"));
  ({ reevaluateListingForRecovery } = await import("@/lib/listings/recovery"));
  ({ resumePausedListing } = await import("@/lib/listings/resumePausedListing"));
  ({ runInventoryRiskMonitor } = await import("@/lib/risk/inventoryRiskMonitor"));
  ({ runListingExecution } = await import("@/workers/listingExecute.worker"));
  ({ runListingMonitor } = await import("@/workers/listingMonitor.worker"));

  await resetFixtureState();
  await insertSupplierSnapshot({ availability: "OUT_OF_STOCK", stage: "RISK_TRIGGER" });

  const before = await getListingSnapshot();
  assert(before.listingStatus === "ACTIVE", `Expected ACTIVE before monitor, got ${before.listingStatus}`);

  const pauseResult = await runInventoryRiskMonitor({
    listingIds: [FIXTURE.listingId],
    actorId: ACTORS.riskPause,
    marketplaceKey: "ebay",
  });
  assert(pauseResult.autoPaused === 1, `Expected 1 auto-paused listing, got ${pauseResult.autoPaused}`);

  const afterPause = await getListingSnapshot();
  assert(afterPause.listingStatus === "PAUSED", `Expected PAUSED after risk monitor, got ${afterPause.listingStatus}`);

  const pausedPublishAttempt = await runListingExecution({
    listingId: FIXTURE.listingId,
    limit: 1,
    marketplaceKey: "ebay",
    dryRun: true,
    actorId: ACTORS.executePaused,
  });
  assert(pausedPublishAttempt.executed === 0, "PAUSED listing should not execute publish path");
  assert(pausedPublishAttempt.skipped === 1, "PAUSED listing should be explicitly skipped by publish worker");

  const promoteWhilePaused = await markListingReadyToPublish({
    listingId: FIXTURE.listingId,
    actorId: ACTORS.promotePaused,
    actorType: "ADMIN",
  });
  assert(!promoteWhilePaused.ok, "PAUSED listing must not promote directly to READY_TO_PUBLISH");
  assert(
    String(promoteWhilePaused.reason ?? "").includes("requires explicit operator resume"),
    `Expected explicit resume guardrail, got ${promoteWhilePaused.reason ?? "no reason"}`
  );

  const pausedReevaluation = await reevaluateListingForRecovery({
    listingId: FIXTURE.listingId,
    actorId: ACTORS.reevaluatePaused,
    actorType: "ADMIN",
  });
  assert(
    pausedReevaluation.recoveryState === "PAUSED_REQUIRES_RESUME",
    `Expected PAUSED_REQUIRES_RESUME, got ${pausedReevaluation.recoveryState ?? "none"}`
  );

  const pausedRiskRerun = await runInventoryRiskMonitor({
    listingIds: [FIXTURE.listingId],
    actorId: ACTORS.riskPausedStability,
    marketplaceKey: "ebay",
  });
  assert(
    pausedRiskRerun.activeListingsScanned === 0,
    `PAUSED listing should not re-enter ACTIVE risk scan path, got ${pausedRiskRerun.activeListingsScanned}`
  );

  const monitorResult = await runListingMonitor({
    limit: 200,
    marketplaceKey: "ebay",
    actorId: ACTORS.monitor,
  });
  assert(monitorResult.pausedStable >= 1, "Listing monitor should classify PAUSED listing as stable");

  await insertSupplierSnapshot({ availability: "IN_STOCK", stage: "RECOVERY" });

  const resumeResult = await resumePausedListing({
    listingId: FIXTURE.listingId,
    actorId: ACTORS.resume,
    actorType: "ADMIN",
  });
  assert(resumeResult.ok, `Expected resume to succeed, got ${resumeResult.reason ?? "no reason"}`);

  const afterResume = await getListingSnapshot();
  assert(afterResume.listingStatus === "PREVIEW", `Expected PREVIEW after resume, got ${afterResume.listingStatus}`);

  const previewRecoveryState = computeRecoveryState({
    decisionStatus: afterResume.decisionStatus,
    listingEligible: afterResume.listingEligible,
    listingStatus: afterResume.listingStatus,
    listingBlockReason: afterResume.listingBlockReason,
  });
  assert(
    previewRecoveryState.recoveryState === "READY_FOR_REPROMOTION",
    `Expected READY_FOR_REPROMOTION in PREVIEW, got ${previewRecoveryState.recoveryState}`
  );

  const previewReevaluation = await reevaluateListingForRecovery({
    listingId: FIXTURE.listingId,
    actorId: ACTORS.reevaluatePreview,
    actorType: "ADMIN",
  });
  assert(previewReevaluation.ok, `Expected preview re-evaluation to succeed, got ${previewReevaluation.reason ?? "no reason"}`);
  assert(
    previewReevaluation.decision === "READY_FOR_REPROMOTION",
    `Expected READY_FOR_REPROMOTION decision, got ${previewReevaluation.decision ?? "none"}`
  );

  const previewPublishAttempt = await runListingExecution({
    listingId: FIXTURE.listingId,
    limit: 1,
    marketplaceKey: "ebay",
    dryRun: true,
    actorId: ACTORS.executePreview,
  });
  assert(previewPublishAttempt.executed === 0, "PREVIEW listing must not auto-publish");
  assert(previewPublishAttempt.skipped === 0, "PREVIEW listing should not enter publish execution queue");

  const beforePromotion = await getListingSnapshot();
  assert(
    beforePromotion.listingStatus === "PREVIEW",
    `Expected PREVIEW before explicit promotion, got ${beforePromotion.listingStatus}`
  );

  const promoteReady = await markListingReadyToPublish({
    listingId: FIXTURE.listingId,
    actorId: ACTORS.promoteReady,
    actorType: "ADMIN",
  });
  assert(promoteReady.ok, `Expected promotion to READY_TO_PUBLISH, got ${promoteReady.reason ?? "no reason"}`);

  const final = await getListingSnapshot();
  assert(
    final.listingStatus === "READY_TO_PUBLISH",
    `Expected READY_TO_PUBLISH after explicit promotion, got ${final.listingStatus}`
  );

  const auditRows = await getAuditRows();
  assert(hasAuditEvent(auditRows, "INVENTORY_RISK_AUTO_PAUSED", ACTORS.riskPause), "Missing INVENTORY_RISK_AUTO_PAUSED audit row");
  assert(hasAuditEvent(auditRows, "LISTING_PAUSED_INVENTORY_RISK", ACTORS.riskPause), "Missing LISTING_PAUSED_INVENTORY_RISK audit row");
  assert(hasAuditEvent(auditRows, "LISTING_PUBLISH_BLOCKED_PAUSED", ACTORS.executePaused), "Missing LISTING_PUBLISH_BLOCKED_PAUSED audit row");
  assert(hasAuditEvent(auditRows, "LISTING_MONITOR_PAUSED_STABLE", ACTORS.monitor), "Missing LISTING_MONITOR_PAUSED_STABLE audit row");
  assert(hasAuditEvent(auditRows, "LISTING_REEVALUATED_PAUSED_REQUIRES_RESUME", ACTORS.reevaluatePaused), "Missing LISTING_REEVALUATED_PAUSED_REQUIRES_RESUME audit row");
  assert(hasAuditEvent(auditRows, "LISTING_RESUME_REQUESTED", ACTORS.resume), "Missing LISTING_RESUME_REQUESTED audit row");
  assert(hasAuditEvent(auditRows, "LISTING_RESUMED_TO_PREVIEW", ACTORS.resume), "Missing LISTING_RESUMED_TO_PREVIEW audit row");
  assert(hasAuditEvent(auditRows, "LISTING_REPROMOTION_READY", ACTORS.reevaluatePreview), "Missing LISTING_REPROMOTION_READY audit row");
  assert(hasAuditEvent(auditRows, "LISTING_READY_TO_PUBLISH", ACTORS.promoteReady), "Missing LISTING_READY_TO_PUBLISH audit row");

  console.log(
    JSON.stringify(
      {
        fixture: FIXTURE,
        assertions: {
          noAutoResume: pausedRiskRerun.activeListingsScanned === 0 && afterPause.listingStatus === "PAUSED",
          noAutoRepublish: previewPublishAttempt.executed === 0 && beforePromotion.listingStatus === "PREVIEW",
          explicitResumeRequired: !promoteWhilePaused.ok,
          explicitRepromotionRequired: beforePromotion.listingStatus === "PREVIEW" && promoteReady.ok,
          pausedStableInMonitor: monitorResult.pausedStable >= 1,
          publishWorkerRejectsPaused: pausedPublishAttempt.skipped === 1,
        },
        before,
        afterPause,
        afterResume,
        final,
        results: {
          pauseResult,
          pausedPublishAttempt,
          promoteWhilePaused,
          pausedReevaluation,
          pausedRiskRerun,
          monitorResult,
          resumeResult,
          previewRecoveryState,
          previewReevaluation,
          previewPublishAttempt,
          promoteReady,
        },
        auditEventTypes: auditRows.map((row) => ({
          actorId: row.actorId,
          eventType: row.eventType,
        })),
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
