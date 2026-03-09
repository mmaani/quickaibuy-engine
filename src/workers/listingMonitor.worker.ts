import { db } from "@/lib/db";
import { sql } from "drizzle-orm";
import { writeAuditLog } from "@/lib/audit/writeAuditLog";

type RunListingMonitorInput = {
  limit?: number;
  marketplaceKey?: "ebay";
  actorId?: string;
};

export async function runListingMonitor(input?: RunListingMonitorInput) {
  const limit = Number(input?.limit ?? 20);
  const marketplaceKey = (input?.marketplaceKey ?? "ebay") as "ebay";
  const actorId = input?.actorId ?? "listingMonitor.worker";

  const rows = await db.execute(sql`
    SELECT
      id,
      candidate_id AS "candidateId",
      marketplace_key AS "marketplaceKey",
      status,
      publish_marketplace AS "publishMarketplace",
      published_external_id AS "publishedExternalId",
      publish_attempt_count AS "publishAttemptCount",
      last_publish_error AS "lastPublishError",
      updated_at AS "updatedAt"
    FROM listings
    WHERE marketplace_key = ${marketplaceKey}
      AND status IN ('READY_TO_PUBLISH', 'PUBLISH_IN_PROGRESS', 'ACTIVE', 'PUBLISH_FAILED')
    ORDER BY updated_at DESC
    LIMIT ${limit}
  `);

  let checked = 0;

  for (const row of rows.rows as Array<Record<string, unknown>>) {
    checked++;

    await writeAuditLog({
      actorType: "WORKER",
      actorId,
      entityType: "LISTING",
      entityId: String(row.id),
      eventType: "LISTING_MONITOR_CHECKED",
      details: {
        listingId: row.id,
        candidateId: row.candidateId,
        marketplaceKey: row.marketplaceKey,
        status: row.status,
        publishMarketplace: row.publishMarketplace,
        publishedExternalId: row.publishedExternalId,
        publishAttemptCount: row.publishAttemptCount,
        lastPublishError: row.lastPublishError,
        updatedAt: row.updatedAt,
      },
    });
  }

  const result = {
    ok: true,
    marketplaceKey,
    checked,
  };

  console.log("[listing-monitor] completed", result);
  return result;
}

export default runListingMonitor;
