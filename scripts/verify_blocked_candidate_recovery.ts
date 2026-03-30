import pg from "pg";
import { getRequiredDatabaseUrl, loadRuntimeEnv } from "./lib/runtimeEnv.mjs";

loadRuntimeEnv();

const { Client } = pg;

const DEFAULT_CANDIDATE_IDS = [
  "0cb07a90-4398-4584-89e2-675c5ae45fa8",
  "1d247785-d960-44c6-ab76-a8f2d29a8bed",
];

type JsonRecord = Record<string, unknown>;

function asRecord(value: unknown): JsonRecord | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as JsonRecord;
}

function parseStages(details: unknown) {
  const root = asRecord(details);
  const stages = Array.isArray(root?.stages) ? root.stages : [];
  const stageKeys = new Set([
    "supplier_refresh",
    "marketplace_refresh",
    "shipping_refresh",
    "match_recompute",
    "profit_recompute",
    "listing_prepare",
    "publish_ready_promotion",
    "guarded_publish_execution",
  ]);
  return stages
    .map((entry) => asRecord(entry))
    .filter((entry): entry is JsonRecord => Boolean(entry))
    .filter((entry) => stageKeys.has(String(entry.key ?? "")))
    .map((entry) => ({
      key: String(entry.key ?? ""),
      status: String(entry.status ?? ""),
      reasonCode: entry.reasonCode ?? null,
      counts: asRecord(entry.counts) ?? {},
    }));
}

async function main() {
  const inputIds = process.argv.slice(2).map((value) => value.trim()).filter(Boolean);
  const candidateIds = inputIds.length ? inputIds : DEFAULT_CANDIDATE_IDS;

  const client = new Client({
    connectionString: getRequiredDatabaseUrl(),
    ssl: { rejectUnauthorized: false },
  });

  await client.connect();
  try {
    const candidateSnapshot = await client.query(
      `
      WITH latest_listing AS (
        SELECT DISTINCT ON (l.candidate_id, lower(l.marketplace_key))
          l.id::text AS listing_id,
          l.candidate_id::text AS candidate_id,
          lower(l.marketplace_key) AS marketplace_key,
          l.status AS listing_status,
          l.payload AS listing_payload,
          l.response AS listing_response,
          l.updated_at AS listing_updated_at
        FROM listings l
        ORDER BY l.candidate_id, lower(l.marketplace_key), l.updated_at DESC NULLS LAST, l.created_at DESC NULLS LAST, l.id DESC
      ),
      latest_supplier_snapshot AS (
        SELECT DISTINCT ON (lower(pr.supplier_key), pr.supplier_product_id)
          lower(pr.supplier_key) AS supplier_key,
          pr.supplier_product_id,
          pr.id::text AS supplier_snapshot_id,
          pr.snapshot_ts
        FROM products_raw pr
        ORDER BY lower(pr.supplier_key), pr.supplier_product_id, pr.snapshot_ts DESC NULLS LAST, pr.id DESC
      )
      SELECT
        pc.id::text AS candidate_id,
        lower(pc.marketplace_key) AS marketplace_key,
        lower(pc.supplier_key) AS supplier_key,
        pc.supplier_product_id,
        pc.marketplace_listing_id,
        pc.decision_status,
        pc.listing_eligible,
        pc.listing_block_reason,
        pc.reason AS decision_reason,
        pc.calc_ts,
        ll.listing_id,
        ll.listing_status,
        ll.listing_payload,
        ll.listing_response,
        ll.listing_updated_at,
        lss.supplier_snapshot_id,
        lss.snapshot_ts AS supplier_snapshot_ts,
        pc.estimated_fees -> 'selectedSupplierOption' ->> 'shippingValidity' AS shipping_validity,
        pc.estimated_fees -> 'selectedSupplierOption' ->> 'shippingErrorReason' AS shipping_error_reason,
        pc.estimated_fees -> 'selectedSupplierOption' ->> 'shippingMethod' AS shipping_method,
        pc.estimated_fees -> 'selectedSupplierOption' ->> 'shippingTransparencyState' AS shipping_transparency_state,
        pc.estimated_fees -> 'selectedSupplierOption' ->> 'shippingOriginCountry' AS shipping_origin_country,
        pc.estimated_fees -> 'selectedSupplierOption' ->> 'shippingDestinationCountry' AS shipping_destination_country,
        pc.estimated_fees -> 'selectedSupplierOption' ->> 'deliveryEstimateMinDays' AS delivery_estimate_min_days,
        pc.estimated_fees -> 'selectedSupplierOption' ->> 'deliveryEstimateMaxDays' AS delivery_estimate_max_days
      FROM profitable_candidates pc
      LEFT JOIN latest_listing ll
        ON ll.candidate_id = pc.id::text
       AND ll.marketplace_key = lower(pc.marketplace_key)
      LEFT JOIN latest_supplier_snapshot lss
        ON lss.supplier_key = lower(pc.supplier_key)
       AND lss.supplier_product_id = pc.supplier_product_id
      WHERE pc.id = ANY($1::uuid[])
      ORDER BY pc.calc_ts DESC NULLS LAST
      `,
      [candidateIds]
    );

    const auditEvents = await client.query(
      `
      SELECT
        id::text AS id,
        event_ts,
        event_type,
        entity_type,
        entity_id::text AS entity_id,
        actor_type,
        actor_id,
        details
      FROM audit_log
      WHERE entity_id::text = ANY($1::text[])
         OR (
          entity_type = 'SYSTEM'
          AND event_type = 'AUTONOMOUS_OPS_BACKBONE_COMPLETED'
         )
      ORDER BY event_ts DESC
      LIMIT 120
      `,
      [candidateIds]
    );

    const jobsSummary = await client.query(
      `
      SELECT
        count(*) FILTER (
          WHERE upper(coalesce(status, '')) IN ('QUEUED', 'RUNNING')
            AND (job_type = 'SCAN_MARKETPLACE_PRICE' OR lower(job_type) = 'scan_marketplace_price')
        )::int AS marketplace_refresh_pending,
        count(*) FILTER (
          WHERE upper(coalesce(status, '')) IN ('QUEUED', 'RUNNING')
            AND (job_type = 'supplier:discover' OR lower(job_type) = 'supplier:discover')
        )::int AS supplier_refresh_pending
      FROM jobs
      `
    );

    const stageAttribution = auditEvents.rows
      .filter((row) => row.event_type === "AUTONOMOUS_OPS_BACKBONE_COMPLETED")
      .slice(0, 5)
      .map((row) => ({
        eventTs: row.event_ts,
        actorType: row.actor_type,
        actorId: row.actor_id,
        stages: parseStages(row.details),
      }));

    const byCandidate = candidateSnapshot.rows.map((row) => {
      const listingPayload = asRecord(row.listing_payload);
      const listingResponse = asRecord(row.listing_response);
      const payloadGate = asRecord(listingResponse?.payloadGate);
      const payloadGateErrors = Array.isArray(payloadGate?.errors)
        ? payloadGate.errors.map((entry) => String(entry ?? "").trim()).filter(Boolean)
        : [];
      const shipFromCountry = String(listingPayload?.shipFromCountry ?? "").trim() || null;
      const handlingDaysMin = listingPayload?.handlingDaysMin ?? null;
      const handlingDaysMax = listingPayload?.handlingDaysMax ?? null;
      const shippingDaysMin = listingPayload?.shippingDaysMin ?? null;
      const shippingDaysMax = listingPayload?.shippingDaysMax ?? null;
      const candidateAudit = auditEvents.rows
        .filter((entry) => String(entry.entity_id ?? "") === String(row.candidate_id))
        .slice(0, 20)
        .map((entry) => ({
          id: entry.id,
          eventTs: entry.event_ts,
          eventType: entry.event_type,
          entityType: entry.entity_type,
          actorType: entry.actor_type,
          actorId: entry.actor_id,
          details: entry.details,
        }));

      const recoveryTargeting = {
        reEvaluationNeeded:
          row.listing_eligible === false ||
          String(row.decision_status ?? "").toUpperCase() === "MANUAL_REVIEW",
        supplierRefreshLikelyTarget:
          /STALE_SUPPLIER|SUPPLIER EVIDENCE|MISSING_SHIP_FROM_COUNTRY|MISSING_SHIPPING_TRANSPARENCY|MISSING_SHIPPING_INTELLIGENCE|SHIPPING_CONFIDENCE_TOO_LOW/i.test(
            String(row.listing_block_reason ?? "")
          ),
        marketplaceRefreshLikelyTarget:
          /STALE_MARKETPLACE|marketplace snapshot age/i.test(String(row.listing_block_reason ?? "")) ||
          payloadGateErrors.length > 0,
        refreshJobsPending: {
          marketplace: Number(jobsSummary.rows[0]?.marketplace_refresh_pending ?? 0),
          supplier: Number(jobsSummary.rows[0]?.supplier_refresh_pending ?? 0),
        },
      };

      return {
        candidateId: row.candidate_id,
        candidate: {
          decisionStatus: row.decision_status,
          listingEligible: row.listing_eligible,
          listingBlockReason: row.listing_block_reason,
          reviewState: row.decision_reason,
          calcTs: row.calc_ts,
          supplierKey: row.supplier_key,
          supplierProductId: row.supplier_product_id,
          marketplaceKey: row.marketplace_key,
          marketplaceListingId: row.marketplace_listing_id,
        },
        listing: {
          listingId: row.listing_id,
          listingStatus: row.listing_status,
          listingUpdatedAt: row.listing_updated_at,
          payloadGateErrors,
        },
        shipping: {
          shippingValidity: row.shipping_validity,
          shippingErrorReason: row.shipping_error_reason,
          shippingMethod: row.shipping_method,
          shippingTransparencyState: row.shipping_transparency_state,
          shipFromCountry,
          shippingOriginCountry: row.shipping_origin_country,
          shippingDestinationCountry: row.shipping_destination_country,
          handlingDaysMin,
          handlingDaysMax,
          shippingDaysMin,
          shippingDaysMax,
          deliveryEstimateMinDays: row.delivery_estimate_min_days,
          deliveryEstimateMaxDays: row.delivery_estimate_max_days,
          supplierSnapshotId: row.supplier_snapshot_id,
          supplierSnapshotTs: row.supplier_snapshot_ts,
        },
        recoveryTargeting,
        autonomousStageAttribution: stageAttribution,
        relatedAuditEvents: candidateAudit,
      };
    });

    console.log(
      JSON.stringify(
        {
          ok: true,
          readOnly: true,
          candidateIds,
          generatedAt: new Date().toISOString(),
          candidates: byCandidate,
        },
        null,
        2
      )
    );
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error("verify_blocked_candidate_recovery failed", error);
  process.exit(1);
});

