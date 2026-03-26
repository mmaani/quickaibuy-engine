import { db } from "@/lib/db";
import { sql } from "drizzle-orm";
import {
  getEbaySellAccessToken,
  sanitizeEbayPayload,
} from "@/lib/marketplaces/ebayPublish";
import { writeAuditLog } from "@/lib/audit/writeAuditLog";
import {
  validateListingPackOutput,
  validateVerifiedListingPackOutput,
} from "@/lib/ai/schemas";
import { auditLiveEbayListing } from "./auditLiveEbayListing";

type ListingRow = {
  id: string;
  candidateId: string;
  marketplaceKey: string;
  status: string;
  title: string | null;
  payload: unknown;
  response: unknown;
  publishedExternalId: string | null;
};

type LiveSnapshotSource =
  | "ebay_live_api"
  | "persisted_publish_result"
  | "listing_payload_fallback";

type PersistPostPublishEbayAuditOptions = {
  listingId: string;
  actorId?: string;
  trigger?: string;
  persist?: boolean;
  preferLiveFetch?: boolean;
};

type PersistPostPublishEbayAuditResult =
  | {
      ok: true;
      listingId: string;
      persisted: boolean;
      auditPayload: Record<string, unknown>;
      liveSnapshotSource: LiveSnapshotSource;
      liveFetchAttempted: boolean;
      liveFetchSucceeded: boolean;
      publishedExternalId: string | null;
    }
  | {
      ok: false;
      listingId: string;
      reason: string;
    };

type LiveEbayListingSnapshot = {
  listingId: string;
  title: string | null;
  categoryId: string | null;
  categoryName: string | null;
  description: string | null;
  itemSpecifics: Record<string, string | null> | null;
};

function asObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function asString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function cleanSpecificValue(value: unknown): string | null {
  if (Array.isArray(value)) {
    return cleanSpecificValue(value[0] ?? null);
  }
  return asString(value);
}

function extractSpecificsFromAspects(value: unknown): Record<string, string | null> | null {
  const record = asObject(value);
  if (!record) return null;
  const specifics: Record<string, string | null> = {};
  for (const [key, entry] of Object.entries(record)) {
    specifics[key] = cleanSpecificValue(entry);
  }
  return specifics;
}

function buildSnapshotFromListingPayload(row: ListingRow): LiveEbayListingSnapshot {
  const payload = sanitizeEbayPayload(row.payload);
  return {
    listingId: row.id,
    title: asString(payload.title) ?? asString(row.title),
    categoryId: asString(payload.categoryId),
    categoryName: null,
    description: asString(payload.description),
    itemSpecifics: extractSpecificsFromAspects(payload.itemSpecifics),
  };
}

function buildSnapshotFromPublishResult(row: ListingRow): LiveEbayListingSnapshot | null {
  const response = asObject(row.response);
  const publishResult = asObject(response?.publishResult);
  const inventory = asObject(publishResult?.inventory);
  const product = asObject(inventory?.product);
  const offerCreate = asObject(publishResult?.offerCreate);

  if (!product && !offerCreate) return null;

  return {
    listingId: row.publishedExternalId ?? row.id,
    title: asString(product?.title) ?? asString(row.title),
    categoryId: asString(offerCreate?.categoryId),
    categoryName: null,
    description: asString(product?.description) ?? asString(offerCreate?.listingDescription),
    itemSpecifics: extractSpecificsFromAspects(product?.aspects),
  };
}

async function fetchLiveEbayListingSnapshot(row: ListingRow): Promise<LiveEbayListingSnapshot | null> {
  const response = asObject(row.response);
  const inventoryItemKey =
    asString(response?.inventoryItemKey) ?? `qab-${String(row.id).replace(/[^A-Za-z0-9._-]/g, "-").slice(0, 40)}`;
  const offerId = asString(response?.offerId);
  const token = await getEbaySellAccessToken();

  const inventoryRes = await fetch(
    `https://api.ebay.com/sell/inventory/v1/inventory_item/${encodeURIComponent(inventoryItemKey)}`,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        "Accept-Language": "en-US",
        "Content-Language": "en-US",
      },
      cache: "no-store",
    }
  );

  if (!inventoryRes.ok) {
    throw new Error(`inventory GET failed: ${inventoryRes.status} ${await inventoryRes.text()}`);
  }

  const inventoryBody = (await inventoryRes.json()) as Record<string, unknown>;
  let categoryId: string | null = null;

  if (offerId) {
    const offerRes = await fetch(
      `https://api.ebay.com/sell/inventory/v1/offer/${encodeURIComponent(offerId)}`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
          "Accept-Language": "en-US",
          "Content-Language": "en-US",
        },
        cache: "no-store",
      }
    );
    if (offerRes.ok) {
      const offerBody = (await offerRes.json()) as Record<string, unknown>;
      categoryId = asString(offerBody.categoryId);
    }
  }

  const product = asObject(inventoryBody.product);
  return {
    listingId: row.publishedExternalId ?? row.id,
    title: asString(product?.title) ?? asString(row.title),
    categoryId,
    categoryName: null,
    description: asString(product?.description),
    itemSpecifics: extractSpecificsFromAspects(product?.aspects),
  };
}

function buildAuditPayload(input: {
  auditResult: ReturnType<typeof auditLiveEbayListing>;
  liveSnapshot: LiveEbayListingSnapshot;
  liveSnapshotSource: LiveSnapshotSource;
  trigger: string;
  actorId: string;
  liveFetchAttempted: boolean;
  liveFetchSucceeded: boolean;
  publishedExternalId: string | null;
}): Record<string, unknown> {
  return {
    auditVersion: "v1",
    computedAt: new Date().toISOString(),
    recommendationOnly: true,
    trigger: input.trigger,
    actorId: input.actorId,
    liveSnapshotSource: input.liveSnapshotSource,
    liveFetchAttempted: input.liveFetchAttempted,
    liveFetchSucceeded: input.liveFetchSucceeded,
    publishedExternalId: input.publishedExternalId,
    auditStatus: input.auditResult.auditStatus,
    manualApprovalRequired: input.auditResult.manualApprovalRequired,
    auditScope: input.auditResult.auditScope,
    liveListing: input.liveSnapshot,
    generatedPack: input.auditResult.generatedPack,
    verifiedPack: input.auditResult.verifiedPack,
    correctionDraft: input.auditResult.correctionDraft,
    mismatchFields: input.auditResult.correctionDraft.mismatches.map((entry) => entry.field),
    riskFlags: input.auditResult.correctionDraft.riskFlags,
    driftNotes: input.auditResult.correctionDraft.mismatches.map(
      (entry) => `${entry.field}: ${entry.reason}`
    ),
  };
}

export async function persistPostPublishEbayAudit(
  options: PersistPostPublishEbayAuditOptions
): Promise<PersistPostPublishEbayAuditResult> {
  const listingId = String(options.listingId ?? "").trim();
  const actorId = String(options.actorId ?? "postPublishAudit.manual").trim();
  const trigger = String(options.trigger ?? "manual_script").trim();
  const persist = options.persist !== false;
  const preferLiveFetch = options.preferLiveFetch !== false;

  if (!listingId) {
    return { ok: false, listingId: "", reason: "listingId is required" };
  }

  const result = await db.execute<ListingRow>(sql`
    SELECT
      id::text AS "id",
      candidate_id::text AS "candidateId",
      marketplace_key AS "marketplaceKey",
      status,
      title,
      payload,
      response,
      published_external_id AS "publishedExternalId"
    FROM listings
    WHERE id = ${listingId}
    LIMIT 1
  `);

  const row = result.rows[0];
  if (!row) return { ok: false, listingId, reason: "listing not found" };
  if (String(row.marketplaceKey).toLowerCase() !== "ebay") {
    return { ok: false, listingId, reason: "post-publish audit is eBay-only" };
  }
  if (String(row.status).toUpperCase() !== "ACTIVE") {
    return { ok: false, listingId, reason: `listing must be ACTIVE, found ${row.status}` };
  }

  const response = asObject(row.response);
  const aiListing = asObject(response?.aiListing);
  const generatedValidation = validateListingPackOutput(aiListing?.generatedPack);
  if (!generatedValidation.ok) {
    return { ok: false, listingId, reason: `generatedPack unavailable: ${generatedValidation.errors.join(" | ")}` };
  }
  const verifiedValidation = validateVerifiedListingPackOutput(aiListing?.verifiedPack);
  if (!verifiedValidation.ok) {
    return { ok: false, listingId, reason: `verifiedPack unavailable: ${verifiedValidation.errors.join(" | ")}` };
  }

  let liveSnapshotSource: LiveSnapshotSource = "listing_payload_fallback";
  let liveSnapshot = buildSnapshotFromListingPayload(row);
  let liveFetchAttempted = false;
  let liveFetchSucceeded = false;

  if (preferLiveFetch) {
    liveFetchAttempted = true;
    try {
      const fetched = await fetchLiveEbayListingSnapshot(row);
      if (fetched) {
        liveSnapshot = fetched;
        liveSnapshotSource = "ebay_live_api";
        liveFetchSucceeded = true;
      }
    } catch {
      liveFetchSucceeded = false;
    }
  }

  if (!liveFetchSucceeded) {
    const publishSnapshot = buildSnapshotFromPublishResult(row);
    if (publishSnapshot) {
      liveSnapshot = publishSnapshot;
      liveSnapshotSource = "persisted_publish_result";
    }
  }

  const auditResult = auditLiveEbayListing({
    liveListing: liveSnapshot,
    generatedPack: generatedValidation.data,
    verifiedPack: verifiedValidation.data,
  });

  const auditPayload = buildAuditPayload({
    auditResult,
    liveSnapshot,
    liveSnapshotSource,
    trigger,
    actorId,
    liveFetchAttempted,
    liveFetchSucceeded,
    publishedExternalId: row.publishedExternalId,
  });

  if (persist) {
    const nextResponse = {
      ...(response ?? {}),
      postPublishAudit: auditPayload,
    };

    await db.execute(sql`
      UPDATE listings
      SET
        response = ${JSON.stringify(nextResponse)}::jsonb,
        updated_at = NOW()
      WHERE id = ${listingId}
    `);

    await writeAuditLog({
      actorType: "SCRIPT",
      actorId,
      entityType: "LISTING",
      entityId: listingId,
      eventType: "LISTING_POST_PUBLISH_AUDIT_PERSISTED",
      details: {
        listingId,
        candidateId: row.candidateId,
        trigger,
        recommendationOnly: true,
        manualApprovalRequired: true,
        liveSnapshotSource,
        liveFetchAttempted,
        liveFetchSucceeded,
        mismatchCount: auditResult.correctionDraft.mismatchCount,
        riskFlags: auditPayload.riskFlags,
      },
    });
  }

  return {
    ok: true,
    listingId,
    persisted: persist,
    auditPayload,
    liveSnapshotSource,
    liveFetchAttempted,
    liveFetchSucceeded,
    publishedExternalId: row.publishedExternalId,
  };
}
