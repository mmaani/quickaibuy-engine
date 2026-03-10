import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { writeAuditLog } from "@/lib/audit/writeAuditLog";
import { listings, marketplacePrices, matches, productsRaw, profitableCandidates } from "@/lib/db/schema";
import { buildListingPreview } from "./build_listing_preview";
import { buildListingPreviewIdempotencyKey } from "./idempotency";
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

type PrepareListingPreviewResult = {
  ok: boolean;
  candidateId: string;
  marketplace: ListingPreviewMarketplace;
  scanned: number;
  created: number;
  updated: number;
  skipped: number;
  failed: number;
  forceRefresh: boolean;
};

type CandidatePreviewSourceRow = {
  candidateId: string;
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
  supplierPrice: unknown;
  marketplacePrice: unknown;
  matchId: string | null;
  matchConfidence: unknown;
  matchType: string | null;
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
} {
  const fromColumns = {
    supplierWarehouseCountry: cleanString(row.supplierWarehouseCountry),
    shipFromCountry: cleanString(row.shipFromCountry),
  };

  const payload = objectOrNull(row.supplierRawPayload);
  if (!payload) return fromColumns;

  const shippingEstimates = objectOrNull(payload.shipping_estimates);
  const shipping = objectOrNull(payload.shipping);

  return {
    supplierWarehouseCountry:
      fromColumns.supplierWarehouseCountry ??
      cleanString(payload.supplier_warehouse_country) ??
      cleanString(payload.warehouse_country),
    shipFromCountry:
      fromColumns.shipFromCountry ??
      cleanString(payload.ship_from_country) ??
      cleanString(payload.shipFromCountry) ??
      cleanString(shippingEstimates?.ship_from_country) ??
      cleanString(shipping?.ship_from_country),
  };
}

function dedupeRows(rows: CandidatePreviewSourceRow[]): CandidatePreviewSourceRow[] {
  return Array.from(
    new Map(rows.map((row) => [`${row.candidateId}:${row.marketplaceKey}:${row.marketplaceListingId}`, row])).values()
  );
}

async function fetchApprovedCandidateRows(selection: CandidateSelection): Promise<CandidatePreviewSourceRow[]> {
  const baseQuery = db
    .select({
      candidateId: profitableCandidates.id,
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
      supplierWarehouseCountry: sql<string | null>`NULLIF(BTRIM(${productsRaw.rawPayload} ->> 'supplier_warehouse_country'), '')`,
      shipFromCountry: sql<string | null>`NULLIF(BTRIM(${productsRaw.rawPayload} ->> 'ship_from_country'), '')`,
      supplierPrice: productsRaw.priceMin,
      marketplacePrice: marketplacePrices.price,
      matchId: matches.id,
      matchConfidence: matches.confidence,
      matchType: matches.matchType,
    })
    .from(profitableCandidates)
    .innerJoin(
      productsRaw,
      and(
        eq(productsRaw.supplierKey, profitableCandidates.supplierKey),
        eq(productsRaw.supplierProductId, profitableCandidates.supplierProductId)
      )
    )
    .innerJoin(
      marketplacePrices,
      and(
        eq(marketplacePrices.marketplaceKey, profitableCandidates.marketplaceKey),
        eq(marketplacePrices.marketplaceListingId, profitableCandidates.marketplaceListingId)
      )
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
        eq(profitableCandidates.marketplaceKey, selection.marketplace),
        selection.candidateId ? eq(profitableCandidates.id, selection.candidateId) : undefined
      )
    )
    .orderBy(desc(profitableCandidates.calcTs));

  const rows = selection.limit ? await baseQuery.limit(selection.limit) : await baseQuery;
  return dedupeRows(rows as CandidatePreviewSourceRow[]);
}

async function processCandidatePreviewRows(
  rows: CandidatePreviewSourceRow[],
  context: ProcessingContext
): Promise<Pick<PrepareListingPreviewResult, "created" | "updated" | "skipped" | "failed" | "scanned">> {
  let created = 0;
  let updated = 0;
  let skipped = 0;
  let failed = 0;

  for (const row of rows) {
    const idempotencyKey = buildListingPreviewIdempotencyKey({
      candidateId: row.candidateId,
      marketplaceKey: context.marketplace,
    });

    const existingPreview = await db
      .select({
        id: listings.id,
        status: listings.status,
      })
      .from(listings)
      .where(
        and(
          eq(listings.candidateId, row.candidateId),
          eq(listings.marketplaceKey, context.marketplace),
          eq(listings.status, "PREVIEW")
        )
      )
      .limit(1);

    const existingLivePath = await db
      .select({
        id: listings.id,
        status: listings.status,
      })
      .from(listings)
      .where(
        and(
          eq(listings.candidateId, row.candidateId),
          eq(listings.marketplaceKey, context.marketplace),
          inArray(listings.status, ["READY_TO_PUBLISH", "PUBLISH_IN_PROGRESS", "ACTIVE"])
        )
      )
      .limit(1);

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

    const supplierImageUrl = Array.isArray(row.supplierImages)
      ? ((row.supplierImages.find((v) => typeof v === "string") as string | undefined) ?? null)
      : null;
    const supplierCountry = extractSupplierShipFromCountry(row);

    const preview = buildListingPreview(context.marketplace, {
      candidateId: row.candidateId,
      supplierKey: row.supplierKey,
      supplierProductId: row.supplierProductId,
      supplierTitle: row.supplierTitle,
      supplierSourceUrl: row.supplierSourceUrl,
      supplierImageUrl,
      supplierPrice: toNum(row.supplierPrice),
      supplierWarehouseCountry: supplierCountry.supplierWarehouseCountry,
      shipFromCountry: supplierCountry.shipFromCountry,
      marketplaceKey: row.marketplaceKey,
      marketplaceListingId: row.marketplaceListingId,
      marketplaceTitle: null,
      marketplacePrice: toNum(row.marketplacePrice),
      estimatedProfit: toNum(row.estimatedProfit),
      marginPct: toNum(row.marginPct),
      roiPct: toNum(row.roiPct),
    });

    const validation = validateListingPreview(preview);
    if (!validation.ok) {
      failed++;
      await writeAuditLog({
        actorType: context.actorType,
        actorId: context.actorId,
        entityType: "PROFITABLE_CANDIDATE",
        entityId: row.candidateId,
        eventType: "LISTING_PREVIEW_FAILED_VALIDATION",
        details: {
          candidateId: row.candidateId,
          marketplaceKey: context.marketplace,
          idempotencyKey,
          errors: validation.errors,
          source: context.source,
        },
      });
      continue;
    }

    const payloadJson = preview.payload;
    const responseJson = preview.response ?? null;

    if (existingPreview.length && context.forceRefresh) {
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
        .where(eq(listings.id, existingPreview[0].id));

      updated++;
      await writeAuditLog({
        actorType: context.actorType,
        actorId: context.actorId,
        entityType: "LISTING",
        entityId: existingPreview[0].id,
        eventType: "LISTING_PREVIEW_REFRESHED",
        details: {
          candidateId: row.candidateId,
          marketplaceKey: context.marketplace,
          idempotencyKey,
          source: context.source,
        },
      });
      continue;
    }

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
    await writeAuditLog({
      actorType: context.actorType,
      actorId: context.actorId,
      entityType: "LISTING",
      entityId: inserted[0].id,
      eventType: "LISTING_PREVIEW_CREATED",
      details: {
        candidateId: row.candidateId,
        marketplaceKey: context.marketplace,
        idempotencyKey,
        source: context.source,
      },
    });
  }

  return {
    scanned: rows.length,
    created,
    updated,
    skipped,
    failed,
  };
}

export async function prepareListingPreviews(input?: PrepareListingPreviewsInput) {
  const limit = Number(input?.limit ?? 20);
  const marketplace = (input?.marketplace ?? "ebay") as ListingPreviewMarketplace;
  const forceRefresh = Boolean(input?.forceRefresh);

  const rows = await fetchApprovedCandidateRows({
    marketplace,
    limit,
  });

  const processed = await processCandidatePreviewRows(rows, {
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

  const processed = await processCandidatePreviewRows(rows, {
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
