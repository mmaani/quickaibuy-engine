import { db } from "@/lib/db";
import { sql } from "drizzle-orm";

export type DuplicateListingStatus =
  | "PREVIEW"
  | "READY_TO_PUBLISH"
  | "PUBLISH_IN_PROGRESS"
  | "ACTIVE";

export type ListingDuplicateMatch = {
  listingId: string;
  candidateId: string;
  status: string;
  title: string | null;
  supplierKey: string | null;
  supplierProductId: string | null;
  supplierProductMatch: boolean;
  titleFingerprintMatch: boolean;
};

export type DuplicateBlockDecision = {
  blocked: boolean;
  reason: string | null;
  blockingListingId: string | null;
  blockingStatus: string | null;
  duplicateListingIds: string[];
};

type DuplicateQueryRow = {
  listingId: string;
  candidateId: string;
  status: string;
  title: string | null;
  supplierKey: string | null;
  supplierProductId: string | null;
  supplierProductMatch: boolean;
  titleFingerprintMatch: boolean;
};

const DEFAULT_BLOCKING_STATUSES: DuplicateListingStatus[] = [
  "PREVIEW",
  "READY_TO_PUBLISH",
  "PUBLISH_IN_PROGRESS",
  "ACTIVE",
];

const STATUS_PRIORITY: Record<DuplicateListingStatus, number> = {
  ACTIVE: 4,
  PUBLISH_IN_PROGRESS: 3,
  READY_TO_PUBLISH: 2,
  PREVIEW: 1,
};

export function normalizedTitleFingerprint(input: string | null | undefined): string {
  return String(input ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
    .trim();
}

export async function findListingDuplicatesForCandidate(input: {
  marketplaceKey: string;
  supplierKey?: string | null;
  supplierProductId?: string | null;
  listingTitle?: string | null;
  excludeListingId?: string | null;
  statuses?: DuplicateListingStatus[];
}): Promise<ListingDuplicateMatch[]> {
  const marketplaceKey = String(input.marketplaceKey ?? "").trim().toLowerCase();
  const supplierKey = String(input.supplierKey ?? "").trim().toLowerCase();
  const supplierProductId = String(input.supplierProductId ?? "").trim();
  const excludeListingId = String(input.excludeListingId ?? "").trim();
  const statuses = input.statuses?.length ? input.statuses : DEFAULT_BLOCKING_STATUSES;
  const titleFingerprint = normalizedTitleFingerprint(input.listingTitle);

  if (!marketplaceKey) return [];

  const canMatchBySupplier = Boolean(supplierKey && supplierProductId);
  const canMatchByTitle = Boolean(titleFingerprint);
  if (!canMatchBySupplier && !canMatchByTitle) return [];

  const statusSql = sql.join(statuses.map((status) => sql`${status}`), sql`, `);

  const result = await db.execute<DuplicateQueryRow>(sql`
    SELECT
      l.id AS "listingId",
      l.candidate_id AS "candidateId",
      l.status,
      l.title,
      pc.supplier_key AS "supplierKey",
      pc.supplier_product_id AS "supplierProductId",
      (
        ${canMatchBySupplier}
        AND LOWER(COALESCE(pc.supplier_key, '')) = ${supplierKey}
        AND COALESCE(pc.supplier_product_id, '') = ${supplierProductId}
      ) AS "supplierProductMatch",
      (
        ${canMatchByTitle}
        AND REGEXP_REPLACE(LOWER(COALESCE(l.title, '')), '[^a-z0-9]+', '', 'g') = ${titleFingerprint}
      ) AS "titleFingerprintMatch"
    FROM listings l
    LEFT JOIN profitable_candidates pc
      ON pc.id = l.candidate_id
    WHERE LOWER(l.marketplace_key) = ${marketplaceKey}
      AND l.status IN (${statusSql})
      AND (${excludeListingId} = '' OR l.id::text <> ${excludeListingId})
      AND (
        (
          ${canMatchBySupplier}
          AND LOWER(COALESCE(pc.supplier_key, '')) = ${supplierKey}
          AND COALESCE(pc.supplier_product_id, '') = ${supplierProductId}
        )
        OR
        (
          ${canMatchByTitle}
          AND REGEXP_REPLACE(LOWER(COALESCE(l.title, '')), '[^a-z0-9]+', '', 'g') = ${titleFingerprint}
        )
      )
    ORDER BY
      CASE l.status
        WHEN 'ACTIVE' THEN 4
        WHEN 'PUBLISH_IN_PROGRESS' THEN 3
        WHEN 'READY_TO_PUBLISH' THEN 2
        WHEN 'PREVIEW' THEN 1
        ELSE 0
      END DESC,
      l.updated_at DESC NULLS LAST,
      l.created_at DESC NULLS LAST
    LIMIT 25
  `);

  return result.rows ?? [];
}

export function getDuplicateBlockDecision(matches: ListingDuplicateMatch[]): DuplicateBlockDecision {
  if (!matches.length) {
    return {
      blocked: false,
      reason: null,
      blockingListingId: null,
      blockingStatus: null,
      duplicateListingIds: [],
    };
  }

  const sorted = [...matches].sort((a, b) => {
    const pa = STATUS_PRIORITY[(a.status as DuplicateListingStatus) ?? "PREVIEW"] ?? 0;
    const pb = STATUS_PRIORITY[(b.status as DuplicateListingStatus) ?? "PREVIEW"] ?? 0;
    return pb - pa;
  });

  const top = sorted[0];
  const duplicateListingIds = Array.from(new Set(sorted.map((m) => m.listingId)));
  const matchMode = top.supplierProductMatch ? "same supplier product" : "normalized title fingerprint";
  const reason = `duplicate listing conflict (${matchMode}) with ${top.status} listing ${top.listingId}`;

  return {
    blocked: true,
    reason,
    blockingListingId: top.listingId,
    blockingStatus: top.status,
    duplicateListingIds,
  };
}
