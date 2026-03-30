import pg from "pg";
import { getRequiredDatabaseUrl, loadRuntimeEnv } from "./lib/runtimeEnv.mjs";

loadRuntimeEnv();

const { Client } = pg;

type JsonRecord = Record<string, unknown>;
type TargetMode =
  | "latest-blocked"
  | "fresh-blocked"
  | "shipping-origin"
  | "payload-completeness"
  | "approved-not-listing-ready"
  | "manual-review-near-ready";

type CandidateSeedRow = {
  candidate_id: string;
  listing_id: string | null;
  supplier_key: string | null;
  supplier_product_id: string | null;
  marketplace_key: string | null;
  marketplace_listing_id: string | null;
  decision_status: string | null;
  listing_eligible: boolean | null;
  listing_block_reason: string | null;
  decision_reason: string | null;
  calc_ts: string | null;
  estimated_fees: unknown;
  risk_flags: unknown;
  listing_status: string | null;
  listing_payload: unknown;
  listing_response: unknown;
  listing_updated_at: string | null;
  supplier_snapshot_id: string | null;
  supplier_snapshot_ts: string | null;
};

type Options = {
  candidateIds: string[];
  supplierKey: string | null;
  supplierProductId: string | null;
  targetMode: TargetMode;
  limit: number;
};

const DEFAULT_LIMIT = 8;

function asRecord(value: unknown): JsonRecord | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as JsonRecord;
}

function asFiniteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (value == null) return null;
  const text = String(value).trim();
  if (!text) return null;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : null;
}

function asString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function mediaImageArraysFromPayload(payload: JsonRecord | null): unknown[] {
  const media = asRecord(payload?.media);
  return [
    ...(Array.isArray(payload?.images) ? payload.images : []),
    ...(Array.isArray(payload?.imageGallery) ? payload.imageGallery : []),
    ...(Array.isArray(payload?.galleryImages) ? payload.galleryImages : []),
    ...(Array.isArray(payload?.variantImages) ? payload.variantImages : []),
    ...(Array.isArray(payload?.descriptionImages) ? payload.descriptionImages : []),
    ...(Array.isArray(media?.images) ? (media.images as unknown[]) : []),
    ...(Array.isArray(media?.galleryImages) ? (media.galleryImages as unknown[]) : []),
    ...(Array.isArray(media?.variantImages) ? (media.variantImages as unknown[]) : []),
    ...(Array.isArray(media?.descriptionImages) ? (media.descriptionImages as unknown[]) : []),
  ];
}

function parseCodes(listingBlockReason: unknown): string[] {
  const raw = String(listingBlockReason ?? "").trim();
  if (!raw) return [];
  const markerIndex = raw.toUpperCase().indexOf("CODES:");
  const body = markerIndex >= 0 ? raw.slice(markerIndex + "CODES:".length) : raw;
  return body
    .split(",")
    .map((part) => part.trim().toUpperCase())
    .filter(Boolean);
}

function parseArgs(): Options {
  const args = process.argv.slice(2);
  const options: Options = {
    candidateIds: [],
    supplierKey: null,
    supplierProductId: null,
    targetMode: "latest-blocked",
    limit: DEFAULT_LIMIT,
  };

  for (const arg of args) {
    const value = arg.trim();
    if (!value) continue;
    if (value.startsWith("--candidate-id=")) {
      options.candidateIds.push(value.slice("--candidate-id=".length).trim());
      continue;
    }
    if (value.startsWith("--supplier-key=")) {
      options.supplierKey = value.slice("--supplier-key=".length).trim().toLowerCase() || null;
      continue;
    }
    if (value.startsWith("--supplier-product-id=")) {
      options.supplierProductId = value.slice("--supplier-product-id=".length).trim() || null;
      continue;
    }
    if (value.startsWith("--target=")) {
      const mode = value.slice("--target=".length).trim().toLowerCase() as TargetMode;
      if (
        [
          "latest-blocked",
          "fresh-blocked",
          "shipping-origin",
          "payload-completeness",
          "approved-not-listing-ready",
          "manual-review-near-ready",
        ].includes(mode)
      ) {
        options.targetMode = mode;
      }
      continue;
    }
    if (value.startsWith("--limit=")) {
      const parsed = Number(value.slice("--limit=".length).trim());
      if (Number.isFinite(parsed) && parsed > 0) {
        options.limit = Math.min(Math.floor(parsed), 50);
      }
      continue;
    }
    if (value.startsWith("--")) continue;
    options.candidateIds.push(value);
  }

  return options;
}

function classifyShipping(codes: string[], estimatedFees: unknown) {
  const fees = asRecord(estimatedFees);
  const shippingBreakdown = asRecord(fees?.shippingBreakdown);
  const selectedSupplierOption = asRecord(fees?.selectedSupplierOption);

  const shippingTransparencyState =
    asString(shippingBreakdown?.shippingTransparencyState)?.toUpperCase() ??
    asString(selectedSupplierOption?.shippingTransparencyState)?.toUpperCase() ??
    null;
  const originCountry =
    asString(shippingBreakdown?.originCountry) ?? asString(selectedSupplierOption?.shippingOriginCountry);
  const originConfidence =
    asFiniteNumber(shippingBreakdown?.originConfidence) ??
    asFiniteNumber(selectedSupplierOption?.shippingOriginConfidence);
  const originSource =
    asString(shippingBreakdown?.originSource) ?? asString(selectedSupplierOption?.shippingOriginSource);
  const originValidity =
    asString(shippingBreakdown?.originValidity)?.toUpperCase() ??
    asString(selectedSupplierOption?.shippingOriginValidity)?.toUpperCase() ??
    null;
  const sourceConfidence =
    asFiniteNumber(shippingBreakdown?.sourceConfidence) ??
    asFiniteNumber(selectedSupplierOption?.shippingSourceConfidence);
  const shippingErrorReason =
    asString(shippingBreakdown?.shippingErrorReason)?.toUpperCase() ??
    asString(selectedSupplierOption?.shippingErrorReason)?.toUpperCase() ??
    null;
  const hasCanonicalShipping = Boolean(shippingBreakdown || selectedSupplierOption);
  const hasShippingSignal =
    asFiniteNumber(shippingBreakdown?.totalShippingUsd) != null ||
    asFiniteNumber(shippingBreakdown?.baseShippingCostUsd) != null ||
    asFiniteNumber(selectedSupplierOption?.selectedShippingCostUsd) != null ||
    asFiniteNumber(shippingBreakdown?.deliveryEstimateMinDays) != null ||
    asFiniteNumber(shippingBreakdown?.deliveryEstimateMaxDays) != null ||
    asFiniteNumber(selectedSupplierOption?.deliveryEstimateMinDays) != null ||
    asFiniteNumber(selectedSupplierOption?.deliveryEstimateMaxDays) != null ||
    shippingTransparencyState === "PRESENT";

  const shippingPresent = hasCanonicalShipping && hasShippingSignal;

  let shippingBlockReason: "SHIPPING_MISSING" | "SHIPPING_PRESENT_BUT_ORIGIN_UNRESOLVED" | "SHIPPING_TRANSPARENCY_INCOMPLETE" | null = null;
  if (
    shippingPresent &&
    (
    codes.includes("MISSING_SHIP_FROM_COUNTRY") ||
    codes.includes("SHIP_FROM_UNRESOLVED_DESTINATION_CONTEXT") ||
    shippingErrorReason === "MISSING_SHIP_FROM_COUNTRY" ||
    (!originCountry && originValidity === "WEAK_OR_UNRESOLVED")
    )
  ) {
    shippingBlockReason = "SHIPPING_PRESENT_BUT_ORIGIN_UNRESOLVED";
  } else if (
    shippingPresent &&
    (
      shippingTransparencyState === "MISSING" ||
      codes.includes("SHIPPING_TRANSPARENCY_INCOMPLETE") ||
      shippingErrorReason === "MISSING_SHIPPING_TRANSPARENCY"
    )
  ) {
    shippingBlockReason = "SHIPPING_TRANSPARENCY_INCOMPLETE";
  } else if (!shippingPresent || codes.includes("SHIPPING_SIGNAL_MISSING")) {
    shippingBlockReason = "SHIPPING_MISSING";
  }

  const explanation =
    shippingBlockReason === "SHIPPING_PRESENT_BUT_ORIGIN_UNRESOLVED"
      ? "Shipping present, but ship-from country unresolved."
      : shippingBlockReason === "SHIPPING_TRANSPARENCY_INCOMPLETE"
        ? "Shipping present, transparency incomplete."
        : shippingBlockReason === "SHIPPING_MISSING"
          ? "Shipping signal is missing from canonical supplier evidence."
          : "Shipping signal and origin evidence are sufficient.";

  return {
    shipping_present: shippingPresent,
    shipping_transparency_state: shippingTransparencyState,
    origin_country: originCountry,
    origin_confidence: originConfidence ?? sourceConfidence,
    origin_source: originSource,
    origin_validity: originValidity,
    shipping_block_reason: shippingBlockReason,
    shipping_explanation: explanation,
  };
}

function classifyMedia(codes: string[], estimatedFees: unknown) {
  const fees = asRecord(estimatedFees);
  const payload = asRecord(fees?.supplierRawPayload) ?? asRecord(fees?.sourcePayload);
  const media = asRecord(payload?.media);
  const images = mediaImageArraysFromPayload(payload);
  const imageCount =
    asFiniteNumber(payload?.imageGalleryCount) ?? asFiniteNumber(media?.imageCount) ?? images.length;
  const videoCount = Math.max(
    asFiniteNumber(payload?.videoCount) ?? 0,
    asFiniteNumber(media?.videoCount) ?? 0,
    Array.isArray(payload?.videoUrls) ? payload.videoUrls.length : 0,
    Array.isArray(media?.videoUrls) ? (media.videoUrls as unknown[]).length : 0
  );
  const mediaPresent = (imageCount ?? 0) > 0 || (videoCount ?? 0) > 0;

  const weakMedia =
    codes.includes("MEDIA_PRESENT_QUALITY_WEAK") || codes.includes("MEDIA_SIGNAL_WEAK") || codes.includes("MEDIA_WEAK");
  const mediaMissing = codes.includes("MEDIA_MISSING") || !mediaPresent;

  const mediaQuality = mediaMissing ? "MISSING" : weakMedia ? "WEAK" : "STRONG";
  const mediaSource =
    asString(payload?.sourceProvider) ?? asString(payload?.provider) ?? asString(payload?.supplierName) ?? null;
  const mediaConfidence =
    asFiniteNumber(media?.confidence) ??
    asFiniteNumber(payload?.mediaConfidence) ??
    (mediaMissing ? 0 : weakMedia ? 0.5 : 0.9);

  const mediaExplanation =
    mediaQuality === "MISSING"
      ? "Media is absent in canonical payload."
      : mediaQuality === "WEAK"
        ? "Media present but low quality."
        : "Media present with acceptable quality.";

  return {
    media_present: mediaPresent,
    media_quality: mediaQuality,
    media_source: mediaSource,
    media_confidence: mediaConfidence,
    media_explanation: mediaExplanation,
  };
}

function getTargetFilter(mode: TargetMode): string {
  if (mode === "shipping-origin") {
    return `
      AND (
        coalesce(pc.listing_block_reason, '') ILIKE '%MISSING_SHIP_FROM_COUNTRY%'
        OR coalesce(pc.listing_block_reason, '') ILIKE '%SHIP_FROM_UNRESOLVED_DESTINATION_CONTEXT%'
        OR coalesce(pc.estimated_fees -> 'selectedSupplierOption' ->> 'shippingOriginValidity', '') = 'WEAK_OR_UNRESOLVED'
      )
    `;
  }
  if (mode === "payload-completeness") {
    return `
      AND (
        coalesce(pc.listing_block_reason, '') ILIKE '%SHIPPING_SIGNAL_MISSING%'
        OR coalesce(pc.listing_block_reason, '') ILIKE '%MEDIA_MISSING%'
        OR coalesce(pc.listing_block_reason, '') ILIKE '%MISSING_SHIPPING_TRANSPARENCY%'
      )
    `;
  }
  if (mode === "approved-not-listing-ready") {
    return `
      AND upper(coalesce(pc.decision_status, '')) = 'APPROVED'
      AND (
        pc.listing_eligible = false
        OR coalesce(ll.status, '') NOT IN ('READY_TO_PUBLISH', 'PUBLISH_IN_PROGRESS', 'ACTIVE')
      )
    `;
  }
  if (mode === "manual-review-near-ready") {
    return `
      AND upper(coalesce(pc.decision_status, '')) = 'MANUAL_REVIEW'
      AND (
        coalesce(pc.listing_block_reason, '') = ''
        OR coalesce(pc.listing_block_reason, '') ILIKE '%SHIPPING%'
        OR coalesce(pc.listing_block_reason, '') ILIKE '%MEDIA%'
      )
    `;
  }
  if (mode === "fresh-blocked") {
    return `
      AND pc.listing_eligible = false
      AND pc.calc_ts >= (NOW() - INTERVAL '72 hours')
    `;
  }
  return `
    AND (
      pc.listing_eligible = false
      OR upper(coalesce(pc.decision_status, '')) = 'MANUAL_REVIEW'
    )
  `;
}

function parseStages(details: unknown) {
  const root = asRecord(details);
  const stages = Array.isArray(root?.stages) ? root.stages : [];
  return stages
    .map((entry) => asRecord(entry))
    .filter((entry): entry is JsonRecord => Boolean(entry))
    .map((entry) => ({
      key: String(entry.key ?? ""),
      status: String(entry.status ?? ""),
      reasonCode: entry.reasonCode ?? null,
      counts: asRecord(entry.counts) ?? {},
      details: asRecord(entry.details) ?? null,
    }));
}

function recoveryDecision(codes: string[], row: CandidateSeedRow) {
  const listingEligible = Boolean(row.listing_eligible);
  const decisionStatus = String(row.decision_status ?? "").toUpperCase();

  if (!listingEligible || decisionStatus === "MANUAL_REVIEW") {
    if (codes.some((code) => code.includes("STALE_MARKETPLACE"))) {
      return "Candidate targeted for marketplace refresh + re-evaluation.";
    }
    if (codes.some((code) => code.includes("STALE_SUPPLIER") || code.includes("SUPPLIER_"))) {
      return "Candidate targeted for supplier refresh + re-evaluation.";
    }
    return "Candidate targeted for guarded re-evaluation on canonical path.";
  }

  if (decisionStatus === "APPROVED") {
    return "Candidate approved; verify preview/preparation pipeline for listing readiness.";
  }

  return "No immediate recovery targeting required.";
}

async function resolveCandidates(client: pg.Client, options: Options): Promise<CandidateSeedRow[]> {
  if (options.candidateIds.length) {
    const result = await client.query<CandidateSeedRow>(
      `
      WITH latest_listing AS (
        SELECT DISTINCT ON (l.candidate_id, lower(l.marketplace_key))
          l.id::text AS listing_id,
          l.candidate_id::text AS candidate_id,
          lower(l.marketplace_key) AS marketplace_key,
          l.status,
          l.payload,
          l.response,
          l.updated_at
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
        ll.listing_id,
        lower(pc.supplier_key) AS supplier_key,
        pc.supplier_product_id,
        lower(pc.marketplace_key) AS marketplace_key,
        pc.marketplace_listing_id,
        pc.decision_status,
        pc.listing_eligible,
        pc.listing_block_reason,
        pc.reason AS decision_reason,
        pc.calc_ts::text,
        pc.estimated_fees,
        pc.risk_flags,
        ll.status AS listing_status,
        ll.payload AS listing_payload,
        ll.response AS listing_response,
        ll.updated_at::text AS listing_updated_at,
        lss.supplier_snapshot_id,
        lss.snapshot_ts::text AS supplier_snapshot_ts
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
      [options.candidateIds]
    );
    return result.rows;
  }

  if (options.supplierKey && options.supplierProductId) {
    const result = await client.query<CandidateSeedRow>(
      `
      WITH latest_listing AS (
        SELECT DISTINCT ON (l.candidate_id, lower(l.marketplace_key))
          l.id::text AS listing_id,
          l.candidate_id::text AS candidate_id,
          lower(l.marketplace_key) AS marketplace_key,
          l.status,
          l.payload,
          l.response,
          l.updated_at
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
        ll.listing_id,
        lower(pc.supplier_key) AS supplier_key,
        pc.supplier_product_id,
        lower(pc.marketplace_key) AS marketplace_key,
        pc.marketplace_listing_id,
        pc.decision_status,
        pc.listing_eligible,
        pc.listing_block_reason,
        pc.reason AS decision_reason,
        pc.calc_ts::text,
        pc.estimated_fees,
        pc.risk_flags,
        ll.status AS listing_status,
        ll.payload AS listing_payload,
        ll.response AS listing_response,
        ll.updated_at::text AS listing_updated_at,
        lss.supplier_snapshot_id,
        lss.snapshot_ts::text AS supplier_snapshot_ts
      FROM profitable_candidates pc
      LEFT JOIN latest_listing ll
        ON ll.candidate_id = pc.id::text
       AND ll.marketplace_key = lower(pc.marketplace_key)
      LEFT JOIN latest_supplier_snapshot lss
        ON lss.supplier_key = lower(pc.supplier_key)
       AND lss.supplier_product_id = pc.supplier_product_id
      WHERE lower(pc.supplier_key) = $1
        AND pc.supplier_product_id = $2
      ORDER BY pc.calc_ts DESC NULLS LAST
      LIMIT $3
      `,
      [options.supplierKey, options.supplierProductId, options.limit]
    );
    return result.rows;
  }

  const result = await client.query<CandidateSeedRow>(
    `
    WITH latest_listing AS (
      SELECT DISTINCT ON (l.candidate_id, lower(l.marketplace_key))
        l.id::text AS listing_id,
        l.candidate_id::text AS candidate_id,
        lower(l.marketplace_key) AS marketplace_key,
        l.status,
        l.payload,
        l.response,
        l.updated_at
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
      ll.listing_id,
      lower(pc.supplier_key) AS supplier_key,
      pc.supplier_product_id,
      lower(pc.marketplace_key) AS marketplace_key,
      pc.marketplace_listing_id,
      pc.decision_status,
      pc.listing_eligible,
      pc.listing_block_reason,
      pc.reason AS decision_reason,
      pc.calc_ts::text,
      pc.estimated_fees,
      pc.risk_flags,
      ll.status AS listing_status,
      ll.payload AS listing_payload,
      ll.response AS listing_response,
      ll.updated_at::text AS listing_updated_at,
      lss.supplier_snapshot_id,
      lss.snapshot_ts::text AS supplier_snapshot_ts
    FROM profitable_candidates pc
    LEFT JOIN latest_listing ll
      ON ll.candidate_id = pc.id::text
     AND ll.marketplace_key = lower(pc.marketplace_key)
    LEFT JOIN latest_supplier_snapshot lss
      ON lss.supplier_key = lower(pc.supplier_key)
     AND lss.supplier_product_id = pc.supplier_product_id
    WHERE 1=1
      ${getTargetFilter(options.targetMode)}
    ORDER BY pc.calc_ts DESC NULLS LAST
    LIMIT $1
    `,
    [options.limit]
  );

  return result.rows;
}

async function main() {
  const options = parseArgs();
  let databaseUrl: string;
  try {
    databaseUrl = getRequiredDatabaseUrl();
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.error(
      JSON.stringify(
        {
          ok: false,
          error: "DB_RUNTIME_UNAVAILABLE",
          message:
            "Validation requires a DB-enabled runtime with DATABASE_URL or DATABASE_URL_DIRECT configured.",
          detail,
        },
        null,
        2
      )
    );
    process.exit(2);
  }

  const client = new Client({
    connectionString: databaseUrl,
    ssl: { rejectUnauthorized: false },
  });

  await client.connect();

  try {
    const candidates = await resolveCandidates(client, options);
    const candidateIds = candidates.map((row) => row.candidate_id);
    const listingIds = candidates.map((row) => row.listing_id).filter((value): value is string => Boolean(value));
    const entityIds = [...new Set([...candidateIds, ...listingIds])];

    const auditEvents = entityIds.length
      ? await client.query(
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
          LIMIT 300
          `,
          [entityIds]
        )
      : { rows: [] as Array<Record<string, unknown>> };

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

    const backboneStages = auditEvents.rows
      .filter((row) => String(row.event_type ?? "") === "AUTONOMOUS_OPS_BACKBONE_COMPLETED")
      .slice(0, 5)
      .map((row) => ({
        eventTs: row.event_ts,
        actorType: row.actor_type,
        actorId: row.actor_id,
        stages: parseStages(row.details),
      }));

    const candidatePayload = candidates.map((row) => {
      const codes = parseCodes(row.listing_block_reason);
      const listingPayload = asRecord(row.listing_payload);
      const listingResponse = asRecord(row.listing_response);
      const payloadGate = asRecord(listingResponse?.payloadGate);
      const payloadGateErrors = Array.isArray(payloadGate?.errors)
        ? payloadGate.errors.map((entry) => String(entry ?? "").trim()).filter(Boolean)
        : [];

      const shipping = classifyShipping(codes, row.estimated_fees);
      const media = classifyMedia(codes, row.estimated_fees);

      const candidateAudit = auditEvents.rows
        .filter((entry) =>
          [row.candidate_id, row.listing_id].filter(Boolean).includes(String(entry.entity_id ?? ""))
        )
        .slice(0, 25)
        .map((entry) => ({
          id: entry.id,
          eventTs: entry.event_ts,
          eventType: entry.event_type,
          entityType: entry.entity_type,
          entityId: entry.entity_id,
          actorType: entry.actor_type,
          actorId: entry.actor_id,
          details: entry.details,
        }));

      const latestRecoveryAttempt = candidateAudit.find((entry) =>
        [
          "LISTING_REEVALUATED_PAUSED_REQUIRES_RESUME",
          "LISTING_REEVALUATED_AFTER_REFRESH",
          "LISTING_REFRESH_ENQUEUED_FOR_RECOVERY",
          "LISTING_REPROMOTION_READY",
          "LISTING_BLOCKED_STALE_MARKETPLACE",
          "LISTING_BLOCKED_SUPPLIER_DRIFT",
        ].includes(String(entry.eventType ?? ""))
      );

      const latestStage = backboneStages[0]?.stages ?? [];
      const shippingStage = latestStage.find((stage) => stage.key === "shipping_recovery");
      const matchStage = latestStage.find((stage) => stage.key === "match_recompute");
      const profitStage = latestStage.find((stage) => stage.key === "profit_recompute");

      const recoveryTrace = {
        targetingDecision: recoveryDecision(codes, row),
        lastRecoveryAttempt: latestRecoveryAttempt ?? null,
        recoveryStageOutput: {
          blockedOutcomes:
            (Array.isArray(shippingStage?.details?.blockedOutcomes)
              ? shippingStage?.details?.blockedOutcomes
              : null) ?? null,
          persistedQuotes: shippingStage?.counts.persistedQuotes ?? null,
          recomputedCandidates:
            profitStage?.counts.recomputedCandidates ?? matchStage?.counts.recomputedCandidates ?? null,
        },
        recoveryFailureOrSkipReason:
          latestRecoveryAttempt == null
            ? "No candidate/listing-scoped recovery audit event found yet; verify autonomous recovery cycle execution."
            : String(
                asString(asRecord(latestRecoveryAttempt.details)?.reason) ??
                  asString(asRecord(latestRecoveryAttempt.details)?.nextAction) ??
                  "Recovery event recorded"
              ),
      };

      return {
        candidateId: row.candidate_id,
        lookupKeys: {
          candidateId: row.candidate_id,
          supplierKey: row.supplier_key,
          supplierProductId: row.supplier_product_id,
          marketplaceKey: row.marketplace_key,
          marketplaceListingId: row.marketplace_listing_id,
          listingId: row.listing_id,
        },
        candidate: {
          decisionStatus: row.decision_status,
          listingEligible: row.listing_eligible,
          listingBlockReason: row.listing_block_reason,
          decisionReason: row.decision_reason,
          calcTs: row.calc_ts,
          recoveryCodes: codes,
        },
        listing: {
          listingStatus: row.listing_status,
          listingUpdatedAt: row.listing_updated_at,
          shipFromCountry: asString(listingPayload?.shipFromCountry),
          payloadGateErrors,
        },
        shippingDiagnostics: shipping,
        mediaDiagnostics: media,
        recoveryTargeting: {
          reEvaluationNeeded:
            row.listing_eligible === false || String(row.decision_status ?? "").toUpperCase() === "MANUAL_REVIEW",
          supplierRefreshLikelyTarget:
            /STALE_SUPPLIER|SUPPLIER|MISSING_SHIP_FROM_COUNTRY|MISSING_SHIPPING_TRANSPARENCY|SHIPPING/i.test(
              String(row.listing_block_reason ?? "")
            ),
          marketplaceRefreshLikelyTarget:
            /STALE_MARKETPLACE|marketplace snapshot age/i.test(String(row.listing_block_reason ?? "")) ||
            payloadGateErrors.length > 0,
          refreshJobsPending: {
            marketplace: Number(jobsSummary.rows[0]?.marketplace_refresh_pending ?? 0),
            supplier: Number(jobsSummary.rows[0]?.supplier_refresh_pending ?? 0),
          },
        },
        recoveryTrace,
        autonomousStageAttribution: backboneStages,
        relatedAuditEvents: candidateAudit,
      };
    });

    console.log(
      JSON.stringify(
        {
          ok: true,
          readOnly: true,
          generatedAt: new Date().toISOString(),
          target: options.targetMode,
          limit: options.limit,
          candidateCount: candidatePayload.length,
          lookup: {
            candidateIds: options.candidateIds,
            supplierKey: options.supplierKey,
            supplierProductId: options.supplierProductId,
          },
          candidates: candidatePayload,
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
