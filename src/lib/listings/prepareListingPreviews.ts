import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { writeAuditLog } from "@/lib/audit/writeAuditLog";
import { listings, marketplacePrices, matches, productsRaw, profitableCandidates } from "@/lib/db/schema";
import { rankProducts } from "@/lib/ai/rankProducts";
import { isAiListingEngineEnabled } from "@/lib/ai/generateListingPack";
import { PRODUCT_PIPELINE_MATCH_PREFERRED_MIN } from "@/lib/products/pipelinePolicy";
import { buildListingPreview } from "./build_listing_preview";
import { buildListingPreviewIdempotencyKey } from "./idempotency";
import { CATEGORY_CONFIDENCE_THRESHOLD, classifyEbayCategory } from "./ebayCategoryClassifier";
import {
  findListingDuplicatesForCandidate,
  getDuplicateBlockDecision,
} from "./duplicateProtection";
import { markListingReadyToPublish } from "./markListingReadyToPublish";
import { normalizeEbayListingImages } from "./normalizeEbayImages";
import type { ListingPreviewMarketplace } from "./types";
import { validateListingPreview } from "./validate_listing_preview";

type PrepareListingPreviewsInput = {
  limit?: number;
  marketplace?: ListingPreviewMarketplace;
  forceRefresh?: boolean;
};

type PrepareListingPreviewForCandidateOptions = {
  marketplace?: ListingPreviewMarketplace;
  forceRefresh?: boolean;
};

type PrepareListingPreviewCounters = {
  scanned: number;
  created: number;
  updated: number;
  ready: number;
  reconciled: number;
  skipped: number;
  failed: number;
};

type PrepareListingPreviewResult = PrepareListingPreviewCounters & {
  ok: boolean;
  candidateId: string;
  marketplace: ListingPreviewMarketplace;
  forceRefresh: boolean;
};

type PrepareListingPreviewsResult = PrepareListingPreviewCounters & {
  ok: boolean;
  marketplace: ListingPreviewMarketplace;
  forceRefresh: boolean;
};

type CandidatePreviewSourceRow = {
  candidateId: string;
  supplierSnapshotId: string;
  marketPriceSnapshotId: string;
  supplierKey: string;
  supplierProductId: string;
  marketplaceKey: string;
  marketplaceListingId: string;
  estimatedProfit: unknown;
  marginPct: unknown;
  roiPct: unknown;
  supplierTitle: string | null;
  supplierSourceUrl: string | null;
  supplierImages: unknown;
  supplierRawPayload: unknown;
  supplierWarehouseCountry: string | null;
  shipFromCountry: string | null;
  shipFromLocation: string | null;
  marketplaceImageUrl: string | null;
  marketplaceTitle: string | null;
  marketplaceRawPayload: unknown;
  supplierPrice: unknown;
  marketplacePrice: unknown;
  matchId: string | null;
  matchConfidence: unknown;
  matchType: string | null;
  matchStatus: string | null;
};

type CandidateSelection = {
  candidateId?: string;
  marketplace: ListingPreviewMarketplace;
  limit?: number;
};

type ProcessingContext = {
  marketplace: ListingPreviewMarketplace;
  forceRefresh: boolean;
  actorType: "WORKER" | "ADMIN";
  actorId: string;
  source: "listing-readiness" | "review-console";
};

class PrepareListingPreviewError extends Error {
  statusCode: number;

  constructor(message: string, statusCode: number) {
    super(message);
    this.name = "PrepareListingPreviewError";
    this.statusCode = statusCode;
  }
}

function toNum(v: unknown): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function cleanString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function objectOrNull(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function extractSupplierShipFromCountry(row: CandidatePreviewSourceRow): {
  supplierWarehouseCountry: string | null;
  shipFromCountry: string | null;
  shipFromLocation: string | null;
} {
  const fromColumns = {
    supplierWarehouseCountry: cleanString(row.supplierWarehouseCountry),
    shipFromCountry: cleanString(row.shipFromCountry),
    shipFromLocation: cleanString(row.shipFromLocation),
  };

  const payload = objectOrNull(row.supplierRawPayload);
  if (!payload) return fromColumns;

  const shippingEstimate =
    Array.isArray(payload.shippingEstimates) && payload.shippingEstimates.length > 0
      ? objectOrNull(payload.shippingEstimates[0])
      : Array.isArray(payload.shipping_estimates) && payload.shipping_estimates.length > 0
        ? objectOrNull(payload.shipping_estimates[0])
        : objectOrNull(payload.shipping_estimates);
  const shipping = objectOrNull(payload.shipping);

  return {
    supplierWarehouseCountry:
      fromColumns.supplierWarehouseCountry ??
      cleanString(payload.supplierWarehouseCountry) ??
      cleanString(payload.supplier_warehouse_country) ??
      cleanString(payload.warehouse_country),
    shipFromCountry:
      fromColumns.shipFromCountry ??
      cleanString(payload.shipFromCountry) ??
      cleanString(payload.ship_from_country) ??
      cleanString(shippingEstimate?.ship_from_country) ??
      cleanString(shipping?.ship_from_country),
    shipFromLocation:
      fromColumns.shipFromLocation ??
      cleanString(payload.shipFromLocation) ??
      cleanString(payload.ship_from_location) ??
      cleanString(shippingEstimate?.ship_from_location) ??
      cleanString(shipping?.ship_from_location),
  };
}

function dedupeRows(rows: CandidatePreviewSourceRow[]): CandidatePreviewSourceRow[] {
  return Array.from(
    new Map(rows.map((row) => [`${row.candidateId}:${row.marketplaceKey}:${row.marketplaceListingId}`, row])).values()
  );
}

function rankCandidateRowsForProcessing(
  rows: CandidatePreviewSourceRow[],
  marketplace: ListingPreviewMarketplace
): CandidatePreviewSourceRow[] {
  if (marketplace !== "ebay" || !isAiListingEngineEnabled()) return rows;

  const feedbackScore = Number(process.env.EBAY_SELLER_FEEDBACK_SCORE ?? process.env.SELLER_FEEDBACK_SCORE ?? "0");
  return rankProducts(rows, {
    feedbackScore: Number.isFinite(feedbackScore) ? feedbackScore : 0,
    policyRiskTolerance: "low",
  });
}

async function blockCandidateForManualReview(input: {
  candidateId: string;
  actorType: "WORKER" | "ADMIN";
  actorId: string;
  eventType: string;
  marketplaceKey: ListingPreviewMarketplace;
  idempotencyKey: string;
  blockReason: string;
  details: Record<string, unknown>;
}) {
  await db.execute(sql`
    UPDATE profitable_candidates
    SET
      decision_status = 'MANUAL_REVIEW',
      listing_eligible = FALSE,
      listing_block_reason = ${input.blockReason},
      listing_eligible_ts = NOW()
    WHERE id = ${input.candidateId}
  `);

  await db.execute(sql`
    UPDATE listings
    SET
      status = 'PREVIEW',
      updated_at = NOW(),
      response = COALESCE(response, '{}'::jsonb) || jsonb_build_object(
        'autoDemotedFromReady', true,
        'autoDemoteReason', (${input.blockReason})::text
      )
    WHERE candidate_id = ${input.candidateId}
      AND status = 'READY_TO_PUBLISH'
  `);

  await writeAuditLog({
    actorType: input.actorType,
    actorId: input.actorId,
    entityType: "PROFITABLE_CANDIDATE",
    entityId: input.candidateId,
    eventType: input.eventType,
    details: {
      candidateId: input.candidateId,
      marketplaceKey: input.marketplaceKey,
      idempotencyKey: input.idempotencyKey,
      ...input.details,
    },
  });
}

async function fetchApprovedCandidateRows(selection: CandidateSelection): Promise<CandidatePreviewSourceRow[]> {
  const baseQuery = db
    .select({
      candidateId: profitableCandidates.id,
      supplierSnapshotId: profitableCandidates.supplierSnapshotId,
      marketPriceSnapshotId: profitableCandidates.marketPriceSnapshotId,
      supplierKey: profitableCandidates.supplierKey,
      supplierProductId: profitableCandidates.supplierProductId,
      marketplaceKey: profitableCandidates.marketplaceKey,
      marketplaceListingId: profitableCandidates.marketplaceListingId,
      estimatedProfit: profitableCandidates.estimatedProfit,
      marginPct: profitableCandidates.marginPct,
      roiPct: profitableCandidates.roiPct,
      supplierTitle: productsRaw.title,
      supplierSourceUrl: productsRaw.sourceUrl,
      supplierImages: productsRaw.images,
      supplierRawPayload: productsRaw.rawPayload,
      supplierWarehouseCountry: sql<string | null>`NULLIF(BTRIM(COALESCE(${productsRaw.rawPayload} ->> 'supplierWarehouseCountry', ${productsRaw.rawPayload} ->> 'supplier_warehouse_country', ${productsRaw.rawPayload} ->> 'warehouse_country')), '')`,
      shipFromCountry: sql<string | null>`NULLIF(BTRIM(COALESCE(${productsRaw.rawPayload} ->> 'shipFromCountry', ${productsRaw.rawPayload} ->> 'ship_from_country')), '')`,
      shipFromLocation: sql<string | null>`NULLIF(BTRIM(COALESCE(${productsRaw.rawPayload} ->> 'shipFromLocation', ${productsRaw.rawPayload} ->> 'ship_from_location')), '')`,
      marketplaceImageUrl: sql<string | null>`NULLIF(BTRIM(COALESCE(${marketplacePrices.imageUrl}, ${marketplacePrices.rawPayload} -> 'image' ->> 'imageUrl')), '')`,
      marketplaceTitle: sql<string | null>`NULLIF(BTRIM(${marketplacePrices.rawPayload} ->> 'title'), '')`,
      marketplaceRawPayload: marketplacePrices.rawPayload,
      supplierPrice: productsRaw.priceMin,
      marketplacePrice: marketplacePrices.price,
      matchId: matches.id,
      matchConfidence: matches.confidence,
      matchType: matches.matchType,
      matchStatus: matches.status,
    })
    .from(profitableCandidates)
    .innerJoin(
      productsRaw,
      eq(productsRaw.id, profitableCandidates.supplierSnapshotId)
    )
    .innerJoin(
      marketplacePrices,
      eq(marketplacePrices.id, profitableCandidates.marketPriceSnapshotId)
    )
    .leftJoin(
      matches,
      and(
        eq(matches.supplierKey, profitableCandidates.supplierKey),
        eq(matches.supplierProductId, profitableCandidates.supplierProductId),
        eq(matches.marketplaceKey, profitableCandidates.marketplaceKey),
        eq(matches.marketplaceListingId, profitableCandidates.marketplaceListingId)
      )
    )
    .where(
      and(
        eq(profitableCandidates.decisionStatus, "APPROVED"),
        eq(profitableCandidates.listingEligible, true),
        eq(profitableCandidates.marketplaceKey, selection.marketplace),
        selection.candidateId ? eq(profitableCandidates.id, selection.candidateId) : undefined
      )
    )
    .orderBy(desc(profitableCandidates.calcTs));

  const rows = selection.limit ? await baseQuery.limit(selection.limit) : await baseQuery;
  return dedupeRows(rows as CandidatePreviewSourceRow[]);
}

async function reconcileIneligibleReadyListings(context: ProcessingContext): Promise<number> {
  const result = await db.execute<{ id: string; candidateId: string }>(sql`
    UPDATE listings l
    SET
      status = 'PREVIEW',
      updated_at = NOW(),
      response = COALESCE(l.response, '{}'::jsonb) || jsonb_build_object(
        'autoDemotedFromReady', true,
        'autoDemoteReason', 'candidate no longer APPROVED/listing_eligible'
      )
    FROM profitable_candidates pc
    WHERE l.candidate_id = pc.id
      AND l.marketplace_key = ${context.marketplace}
      AND l.status = 'READY_TO_PUBLISH'
      AND (
        upper(coalesce(pc.decision_status, '')) <> 'APPROVED'
        OR coalesce(pc.listing_eligible, false) = false
      )
    RETURNING l.id AS id, l.candidate_id AS "candidateId"
  `);

  for (const row of result.rows ?? []) {
    await writeAuditLog({
      actorType: context.actorType,
      actorId: context.actorId,
      entityType: "LISTING",
      entityId: String(row.id),
      eventType: "LISTING_AUTO_DEMOTED_INELIGIBLE_READY",
      details: {
        listingId: String(row.id),
        candidateId: String(row.candidateId),
        marketplaceKey: context.marketplace,
        source: context.source,
      },
    });
  }

  return (result.rows ?? []).length;
}

async function processCandidatePreviewRows(
  rows: CandidatePreviewSourceRow[],
  context: ProcessingContext
): Promise<
  Pick<
    PrepareListingPreviewResult,
    "created" | "updated" | "ready" | "reconciled" | "skipped" | "failed" | "scanned"
  >
> {
  let created = 0;
  let updated = 0;
  let ready = 0;
  const reconciled = await reconcileIneligibleReadyListings(context);
  let skipped = 0;
  let failed = 0;

  for (const row of rows) {
    const idempotencyKey = buildListingPreviewIdempotencyKey({
      candidateId: row.candidateId,
      marketplaceKey: context.marketplace,
    });

    const existingListing = await db
      .select({
        id: listings.id,
        status: listings.status,
        idempotencyKey: listings.idempotencyKey,
      })
      .from(listings)
      .where(eq(listings.idempotencyKey, idempotencyKey))
      .limit(1);

    const existingPreview =
      existingListing.length &&
      ["PREVIEW", "READY_TO_PUBLISH"].includes(existingListing[0].status)
        ? existingListing
        : [];
    const existingLivePath =
      existingListing.length &&
      ["PUBLISH_IN_PROGRESS", "ACTIVE"].includes(existingListing[0].status)
        ? existingListing
        : [];

    if (existingLivePath.length) {
      skipped++;
      await writeAuditLog({
        actorType: context.actorType,
        actorId: context.actorId,
        entityType: "LISTING",
        entityId: existingLivePath[0].id,
        eventType: "LISTING_PREVIEW_SKIPPED_LIVE_PATH_EXISTS",
        details: {
          candidateId: row.candidateId,
          marketplaceKey: context.marketplace,
          existingStatus: existingLivePath[0].status,
          idempotencyKey,
          source: context.source,
        },
      });
      continue;
    }

    if (existingPreview.length && !context.forceRefresh) {
      skipped++;
      await writeAuditLog({
        actorType: context.actorType,
        actorId: context.actorId,
        entityType: "LISTING",
        entityId: existingPreview[0].id,
        eventType: "LISTING_PREVIEW_SKIPPED_DUPLICATE",
        details: {
          candidateId: row.candidateId,
          marketplaceKey: context.marketplace,
          idempotencyKey,
          source: context.source,
        },
      });
      continue;
    }

    const matchConfidence = toNum(row.matchConfidence);
    const matchStatus = cleanString(row.matchStatus)?.toUpperCase() ?? null;
    if (
      context.marketplace === "ebay" &&
      (matchStatus !== "ACTIVE" ||
        matchConfidence == null ||
        matchConfidence < PRODUCT_PIPELINE_MATCH_PREFERRED_MIN)
    ) {
      failed++;
      await blockCandidateForManualReview({
        candidateId: row.candidateId,
        actorType: context.actorType,
        actorId: context.actorId,
        eventType: "LISTING_MATCH_CONFIDENCE_MANUAL_REVIEW_REQUIRED",
        marketplaceKey: context.marketplace,
        idempotencyKey,
        blockReason: `MATCH_CONFIDENCE_GATE_FAILED: status=${matchStatus ?? "UNKNOWN"} confidence=${matchConfidence ?? "null"}`,
        details: {
          matchStatus,
          matchConfidence,
          requiredStatus: "ACTIVE",
          minConfidence: PRODUCT_PIPELINE_MATCH_PREFERRED_MIN,
          source: context.source,
        },
      });
      continue;
    }

    const supplierImageUrl = Array.isArray(row.supplierImages)
      ? ((row.supplierImages.find((v) => typeof v === "string") as string | undefined) ?? null)
      : null;
    const supplierImages = Array.isArray(row.supplierImages)
      ? row.supplierImages.filter((v): v is string => typeof v === "string")
      : [];
    const supplierCountry = extractSupplierShipFromCountry(row);
    const categoryClassification =
      context.marketplace === "ebay"
        ? classifyEbayCategory({
            supplierTitle: row.supplierTitle,
            marketplaceTitle: row.marketplaceTitle,
            marketplaceRawPayload: row.marketplaceRawPayload,
          })
        : null;

    if (
      context.marketplace === "ebay" &&
      (!categoryClassification ||
        !categoryClassification.categoryId ||
        categoryClassification.confidence < CATEGORY_CONFIDENCE_THRESHOLD)
    ) {
      failed++;
      const reason = categoryClassification?.reason ?? "category classification unavailable";
      const blockReason = `CATEGORY_CONFIDENCE_TOO_LOW: ${reason}`;
      await blockCandidateForManualReview({
        candidateId: row.candidateId,
        actorType: context.actorType,
        actorId: context.actorId,
        eventType: "LISTING_CATEGORY_MANUAL_REVIEW_REQUIRED",
        marketplaceKey: context.marketplace,
        idempotencyKey,
        blockReason,
        details: {
          categoryConfidence: categoryClassification?.confidence ?? null,
          categoryThreshold: CATEGORY_CONFIDENCE_THRESHOLD,
          categoryId: categoryClassification?.categoryId ?? null,
          categoryName: categoryClassification?.categoryName ?? null,
          categoryRuleLabel: categoryClassification?.ruleLabel ?? null,
          matchedKeywords: categoryClassification?.matchedKeywords ?? [],
          sellerFeedback: categoryClassification?.sellerFeedback ?? null,
          reason,
          source: context.source,
        },
      });
      continue;
    }

    const preview = await buildListingPreview(context.marketplace, {
      candidateId: row.candidateId,
      supplierKey: row.supplierKey,
      supplierProductId: row.supplierProductId,
      supplierTitle: row.supplierTitle,
      supplierSourceUrl: row.supplierSourceUrl,
      supplierImageUrl,
      supplierImages,
      supplierRawPayload: row.supplierRawPayload,
      supplierPrice: toNum(row.supplierPrice),
      supplierWarehouseCountry: supplierCountry.supplierWarehouseCountry,
      shipFromCountry: supplierCountry.shipFromCountry,
      shipFromLocation: supplierCountry.shipFromLocation,
      marketplaceImageUrl: cleanString(row.marketplaceImageUrl),
      marketplaceKey: row.marketplaceKey,
      marketplaceListingId: row.marketplaceListingId,
      marketplaceTitle: row.marketplaceTitle,
      marketplaceRawPayload: row.marketplaceRawPayload,
      marketplacePrice: toNum(row.marketplacePrice),
      estimatedProfit: toNum(row.estimatedProfit),
      marginPct: toNum(row.marginPct),
      roiPct: toNum(row.roiPct),
      categoryId: categoryClassification?.categoryId ?? null,
      categoryName: categoryClassification?.categoryName ?? null,
      categoryConfidence: categoryClassification?.confidence ?? null,
      categoryRuleLabel: categoryClassification?.ruleLabel ?? null,
    });

    if (context.marketplace === "ebay") {
      const response = (preview.response ?? {}) as Record<string, unknown>;
      const payload = preview.payload as Record<string, unknown>;
      payload.categoryId = categoryClassification?.categoryId ?? null;
      payload.categoryConfidence = categoryClassification?.confidence ?? null;
      payload.categoryRuleLabel = categoryClassification?.ruleLabel ?? null;
      preview.response = {
        ...response,
        categoryId: categoryClassification?.categoryId ?? null,
        categoryConfidence: categoryClassification?.confidence ?? null,
        categoryRuleLabel: categoryClassification?.ruleLabel ?? null,
      };
    }

    const validation = validateListingPreview(preview);
    if (!validation.ok) {
      failed++;
      await blockCandidateForManualReview({
        candidateId: row.candidateId,
        actorType: context.actorType,
        actorId: context.actorId,
        eventType: "LISTING_PREVIEW_FAILED_VALIDATION",
        marketplaceKey: context.marketplace,
        idempotencyKey,
        blockReason: `LISTING_QUALITY_GATE_FAILED: ${validation.errors.join("; ")}`,
        details: {
          errors: validation.errors,
          source: context.source,
        },
      });
      continue;
    }

    const duplicateMatches = await findListingDuplicatesForCandidate({
      marketplaceKey: context.marketplace,
      supplierKey: row.supplierKey,
      supplierProductId: row.supplierProductId,
      listingTitle: preview.title,
      excludeListingId:
        existingPreview.length && context.forceRefresh ? existingPreview[0].id : null,
    });
    const duplicateDecision = getDuplicateBlockDecision(duplicateMatches);

    if (duplicateDecision.blocked) {
      skipped++;
      await writeAuditLog({
        actorType: context.actorType,
        actorId: context.actorId,
        entityType: "LISTING",
        entityId: duplicateDecision.blockingListingId ?? (existingPreview[0]?.id ?? row.candidateId),
        eventType: "LISTING_PREVIEW_BLOCKED_DUPLICATE",
        details: {
          candidateId: row.candidateId,
          listingId: existingPreview[0]?.id ?? null,
          marketplaceKey: context.marketplace,
          idempotencyKey,
          duplicateReason: duplicateDecision.reason,
          duplicateListingIds: duplicateDecision.duplicateListingIds,
          source: context.source,
        },
      });
      continue;
    }

    let normalizationResult:
      | Awaited<ReturnType<typeof normalizeEbayListingImages>>
      | null = null;
    if (context.marketplace === "ebay") {
      normalizationResult = await normalizeEbayListingImages({
        payload: preview.payload as Record<string, unknown>,
        response:
          preview.response && typeof preview.response === "object" && !Array.isArray(preview.response)
            ? (preview.response as Record<string, unknown>)
            : null,
      });
      preview.payload = normalizationResult.payload;
      preview.response = normalizationResult.response ?? undefined;
    }

    const payloadJson = preview.payload;
    const responseJson = preview.response ?? null;
    let listingId: string;

    if (existingListing.length && (context.forceRefresh || existingListing[0].status !== "PREVIEW")) {
      await db
        .update(listings)
        .set({
          title: preview.title,
          price: sql`${String(preview.price)}`,
          quantity: preview.quantity,
          payload: payloadJson,
          response: responseJson,
          idempotencyKey,
          status: "PREVIEW",
          updatedAt: new Date(),
        })
        .where(eq(listings.id, existingListing[0].id));

      updated++;
      listingId = existingListing[0].id;
      await writeAuditLog({
        actorType: context.actorType,
        actorId: context.actorId,
        entityType: "LISTING",
        entityId: listingId,
        eventType: "LISTING_PREVIEW_REFRESHED",
        details: {
          candidateId: row.candidateId,
          marketplaceKey: context.marketplace,
          idempotencyKey,
          previousStatus: existingListing[0].status,
          source: context.source,
        },
      });
    } else {
      const inserted = await db
        .insert(listings)
        .values({
          candidateId: row.candidateId,
          marketplaceKey: context.marketplace,
          status: "PREVIEW",
          title: preview.title,
          price: String(preview.price),
          quantity: preview.quantity,
          payload: payloadJson,
          response: responseJson,
          idempotencyKey,
        })
        .returning({ id: listings.id });

      created++;
      listingId = inserted[0].id;
      await writeAuditLog({
        actorType: context.actorType,
        actorId: context.actorId,
        entityType: "LISTING",
        entityId: listingId,
        eventType: "LISTING_PREVIEW_CREATED",
        details: {
          candidateId: row.candidateId,
          marketplaceKey: context.marketplace,
          idempotencyKey,
          source: context.source,
        },
      });
    }

    if (normalizationResult) {
      await writeAuditLog({
        actorType: context.actorType,
        actorId: context.actorId,
        entityType: "LISTING",
        entityId: listingId,
        eventType: normalizationResult.ok
          ? "LISTING_IMAGE_NORMALIZATION_OK"
          : "LISTING_IMAGE_NORMALIZATION_FAILED",
        details: {
          candidateId: row.candidateId,
          marketplaceKey: context.marketplace,
          idempotencyKey,
          source: context.source,
          imageNormalization: normalizationResult.diagnostics,
        },
      });
    }

    if (normalizationResult && !normalizationResult.ok) {
      failed++;
      await writeAuditLog({
        actorType: context.actorType,
        actorId: context.actorId,
        entityType: "LISTING",
        entityId: listingId,
        eventType: "LISTING_AUTO_READY_SKIPPED",
        details: {
          candidateId: row.candidateId,
          marketplaceKey: context.marketplace,
          idempotencyKey,
          reason:
            normalizationResult.diagnostics.blockingReason ??
            normalizationResult.diagnostics.code,
          source: context.source,
          imageNormalization: normalizationResult.diagnostics,
        },
      });
      continue;
    }

    if (context.marketplace === "ebay") {
      const aiListing =
        preview.response && typeof preview.response === "object" && !Array.isArray(preview.response)
          ? ((preview.response as Record<string, unknown>).aiListing as Record<string, unknown> | undefined)
          : undefined;
      if (aiListing && Boolean(aiListing.manualReviewRequired)) {
        failed++;
        await blockCandidateForManualReview({
          candidateId: row.candidateId,
          actorType: context.actorType,
          actorId: context.actorId,
          eventType: "LISTING_AI_MANUAL_REVIEW_REQUIRED",
          marketplaceKey: context.marketplace,
          idempotencyKey,
          blockReason: `AI_LISTING_MANUAL_REVIEW_REQUIRED: ${String(aiListing.reason ?? "unspecified")}`,
          details: {
            source: context.source,
            aiListing,
          },
        });
        continue;
      }

      const readyResult = await markListingReadyToPublish({
        listingId,
        actorId: context.actorId,
        actorType: context.actorType,
      });

      if (readyResult.ok) {
        ready++;
        continue;
      }

      await writeAuditLog({
        actorType: context.actorType,
        actorId: context.actorId,
        entityType: "LISTING",
        entityId: listingId,
        eventType: "LISTING_AUTO_READY_SKIPPED",
        details: {
          candidateId: row.candidateId,
          marketplaceKey: context.marketplace,
          idempotencyKey,
          source: context.source,
          reason: readyResult.reason ?? "ready-to-publish checks did not pass",
        },
      });
    }

    await writeAuditLog({
      actorType: context.actorType,
      actorId: context.actorId,
      entityType: "LISTING",
      entityId: listingId,
      eventType: "LISTING_PREVIEW_NOMINATED_FOR_REVIEW",
      details: {
        candidateId: row.candidateId,
        marketplaceKey: context.marketplace,
        idempotencyKey,
        source: context.source,
        supplierSnapshotId: row.supplierSnapshotId,
        marketPriceSnapshotId: row.marketPriceSnapshotId,
        status: "PREVIEW",
      },
    });
  }

  return {
    scanned: rows.length,
    created,
    updated,
    ready,
    reconciled,
    skipped,
    failed,
  };
}

export async function prepareListingPreviews(input?: PrepareListingPreviewsInput): Promise<PrepareListingPreviewsResult> {
  const limit = Number(input?.limit ?? 20);
  const marketplace = (input?.marketplace ?? "ebay") as ListingPreviewMarketplace;
  const forceRefresh = Boolean(input?.forceRefresh);

  const rows = await fetchApprovedCandidateRows({
    marketplace,
    limit,
  });
  const rankedRows = rankCandidateRowsForProcessing(rows, marketplace);

  const processed = await processCandidatePreviewRows(rankedRows, {
    marketplace,
    forceRefresh,
    actorType: "WORKER",
    actorId: "LISTING_PREPARE",
    source: "listing-readiness",
  });

  return {
    ok: true,
    marketplace,
    ...processed,
    forceRefresh,
  };
}

export async function prepareListingPreviewForCandidate(
  candidateId: string,
  options?: PrepareListingPreviewForCandidateOptions
): Promise<PrepareListingPreviewResult> {
  const normalizedCandidateId = String(candidateId ?? "").trim();
  if (!normalizedCandidateId) {
    throw new PrepareListingPreviewError("candidateId required", 400);
  }

  const marketplace = (options?.marketplace ?? "ebay") as ListingPreviewMarketplace;
  const forceRefresh = Boolean(options?.forceRefresh);

  const rows = await fetchApprovedCandidateRows({
    candidateId: normalizedCandidateId,
    marketplace,
  });
  const rankedRows = rankCandidateRowsForProcessing(rows, marketplace);

  if (!rows.length) {
    const existing = await db
      .select({
        id: profitableCandidates.id,
        decisionStatus: profitableCandidates.decisionStatus,
        marketplaceKey: profitableCandidates.marketplaceKey,
      })
      .from(profitableCandidates)
      .where(eq(profitableCandidates.id, normalizedCandidateId))
      .limit(1);

    if (!existing.length) {
      throw new PrepareListingPreviewError("candidate not found", 404);
    }

    if (existing[0].decisionStatus !== "APPROVED") {
      throw new PrepareListingPreviewError("candidate must be APPROVED before preparing preview", 400);
    }

    throw new PrepareListingPreviewError(
      `candidate marketplace '${existing[0].marketplaceKey}' does not match requested marketplace '${marketplace}'`,
      400
    );
  }

  const processed = await processCandidatePreviewRows(rankedRows, {
    marketplace,
    forceRefresh,
    actorType: "ADMIN",
    actorId: "REVIEW_PREPARE_PREVIEW",
    source: "review-console",
  });

  return {
    ok: true,
    candidateId: normalizedCandidateId,
    marketplace,
    ...processed,
    forceRefresh,
  };
}

export { PrepareListingPreviewError };
