import { db } from "@/lib/db";
import { sql } from "drizzle-orm";
import { writeAuditLog } from "@/lib/audit/writeAuditLog";

type RunListingMonitorInput = {
  limit?: number;
  marketplaceKey?: "ebay";
  actorId?: string;
  staleMinutes?: number;
  failedAttemptsThreshold?: number;
};

export async function runListingMonitor(input?: RunListingMonitorInput) {
  const limit = Number(input?.limit ?? 20);
  const marketplaceKey = (input?.marketplaceKey ?? "ebay") as "ebay";
  const actorId = input?.actorId ?? "listingMonitor.worker";
  const staleMinutes = Number(input?.staleMinutes ?? 30);
  const failedAttemptsThreshold = Number(input?.failedAttemptsThreshold ?? 3);

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
      publish_started_ts AS "publishStartedTs",
      updated_at AS "updatedAt"
    FROM listings
    WHERE marketplace_key = ${marketplaceKey}
      AND status IN ('READY_TO_PUBLISH', 'PUBLISH_IN_PROGRESS', 'ACTIVE', 'PUBLISH_FAILED')
    ORDER BY updated_at DESC
    LIMIT ${limit}
  `);

  let checked = 0;
  let staleInProgress = 0;
  let activeMissingExternalId = 0;
  let repeatedFailures = 0;

  for (const row of rows.rows as Array<Record<string, unknown>>) {
    checked++;

    const status = String(row.status ?? "");
    const publishAttemptCount = Number(row.publishAttemptCount ?? 0);
    const publishedExternalId = row.publishedExternalId ? String(row.publishedExternalId) : null;
    const publishStartedTs = row.publishStartedTs ? new Date(String(row.publishStartedTs)) : null;

    const isStaleInProgress =
      status === "PUBLISH_IN_PROGRESS" &&
      publishStartedTs instanceof Date &&
      !Number.isNaN(publishStartedTs.getTime()) &&
      Date.now() - publishStartedTs.getTime() > staleMinutes * 60 * 1000;

    const isActiveMissingExternalId = status === "ACTIVE" && !publishedExternalId;
    const isRepeatedFailure = status === "PUBLISH_FAILED" && publishAttemptCount >= failedAttemptsThreshold;

    if (isStaleInProgress) {
      staleInProgress++;
      await writeAuditLog({
        actorType: "WORKER",
        actorId,
        entityType: "LISTING",
        entityId: String(row.id),
        eventType: "LISTING_MONITOR_STALE_PUBLISH_IN_PROGRESS",
        details: {
          listingId: row.id,
          candidateId: row.candidateId,
          marketplaceKey: row.marketplaceKey,
          status,
          publishStartedTs,
          staleMinutes,
        },
      });
    }

    if (isActiveMissingExternalId) {
      activeMissingExternalId++;
      await writeAuditLog({
        actorType: "WORKER",
        actorId,
        entityType: "LISTING",
        entityId: String(row.id),
        eventType: "LISTING_MONITOR_ACTIVE_MISSING_EXTERNAL_ID",
        details: {
          listingId: row.id,
          candidateId: row.candidateId,
          marketplaceKey: row.marketplaceKey,
          status,
        },
      });
    }

    if (isRepeatedFailure) {
      repeatedFailures++;
      await writeAuditLog({
        actorType: "WORKER",
        actorId,
        entityType: "LISTING",
        entityId: String(row.id),
        eventType: "LISTING_MONITOR_REPEATED_PUBLISH_FAILURE",
        details: {
          listingId: row.id,
          candidateId: row.candidateId,
          marketplaceKey: row.marketplaceKey,
          status,
          publishAttemptCount,
          failedAttemptsThreshold,
          lastPublishError: row.lastPublishError,
        },
      });
    }

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
        status,
        publishMarketplace: row.publishMarketplace,
        publishedExternalId: row.publishedExternalId,
        publishAttemptCount: row.publishAttemptCount,
        lastPublishError: row.lastPublishError,
        publishStartedTs: row.publishStartedTs,
        updatedAt: row.updatedAt,
      },
    });
  }

  const result = {
    ok: true,
    marketplaceKey,
    checked,
    staleInProgress,
    activeMissingExternalId,
    repeatedFailures,
  };

  console.log("[listing-monitor] completed", result);
  return result;
}

export default runListingMonitor;
