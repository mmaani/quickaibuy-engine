import { db } from "@/lib/db";
import { sql } from "drizzle-orm";
import { writeAuditLog } from "@/lib/audit/writeAuditLog";
import { reserveDailyListingSlot } from "@/lib/listings/checkDailyListingCap";
import {
  findListingDuplicatesForCandidate,
  getDuplicateBlockDecision,
} from "@/lib/listings/duplicateProtection";
import { getPublishRateLimitState } from "@/lib/listings/publishRateLimiter";
import { getListingExecutionCandidates } from "@/lib/listings/getListingExecutionCandidates";
import { publishToEbayListing } from "@/lib/marketplaces/ebayPublish";
import { validateProfitSafety } from "@/lib/profit/priceGuard";

function isLivePublishEnabled(): boolean {
  return String(process.env.ENABLE_EBAY_LIVE_PUBLISH ?? "false").toLowerCase() === "true";
}

export async function runListingExecution(opts?: {
  limit?: number;
  dryRun?: boolean;
  dailyCap?: number;
  marketplaceKey?: "ebay";
  actorId?: string;
  listingId?: string;
}) {
  const limit = opts?.limit ?? opts?.dailyCap ?? 5;
  const dryRun = opts?.dryRun ?? true;
  const marketplaceKey = (opts?.marketplaceKey ?? "ebay") as "ebay";
  const actorId = opts?.actorId ?? "listingExecute.worker";
  const listingIdFilter = String(opts?.listingId ?? "").trim();
  const livePublishEnabled = isLivePublishEnabled();

  const rows = await getListingExecutionCandidates({
    marketplace: marketplaceKey,
    limit,
    listingId: listingIdFilter || undefined,
  });

  let executed = 0;
  let skipped = 0;
  let failed = 0;

  for (const row of rows) {
    const listingId = row.id;
    const candidateId = row.candidateId;

    if (!listingId || !candidateId) {
      skipped++;
      continue;
    }

    /**
     * DRY RUN PATH
     */
    if (dryRun || !livePublishEnabled) {
      await db.execute(sql`
        UPDATE listings
        SET
          response = COALESCE(response, '{}'::jsonb) || '{"dryRun":true,"liveApiCalled":false}'::jsonb,
          updated_at = NOW()
        WHERE id = ${listingId}
          AND status = 'READY_TO_PUBLISH'
      `);

      await writeAuditLog({
        actorType: "WORKER",
        actorId,
        entityType: "LISTING",
        entityId: listingId,
        eventType: "LISTING_EXECUTION_DRY_RUN",
        details: {
          listingId,
          candidateId,
          marketplaceKey,
          dryRun: true,
          liveApiCalled: false,
          listingIdFilter: listingIdFilter || null,
        },
      });

      executed++;
      continue;
    }

    /**
     * PRICE GUARD — PRE-PUBLISH ECONOMICS SAFETY CHECK
     */
    const priceGuard = await validateProfitSafety({
      candidateId,
      listingId,
      mode: "publish",
    });

    if (!priceGuard.allow) {
      const guardSummary = {
        decision: priceGuard.decision,
        reasons: priceGuard.reasons,
        metrics: priceGuard.metrics,
        thresholds: priceGuard.thresholds,
      };

      await db.execute(sql`
        UPDATE profitable_candidates
        SET
          listing_eligible = FALSE,
          listing_block_reason = ${`PRICE_GUARD_${priceGuard.decision}: ${priceGuard.reasons.join(", ")}`},
          listing_eligible_ts = NOW()
        WHERE id = ${candidateId}
      `);

      await db.execute(sql`
        UPDATE listings
        SET
          response = COALESCE(response, '{}'::jsonb) || ${JSON.stringify({
            priceGuard: guardSummary,
          })}::jsonb,
          last_publish_error = ${`PriceGuard ${priceGuard.decision}: ${priceGuard.reasons.join(", ")}`},
          updated_at = NOW()
        WHERE id = ${listingId}
      `);

      await writeAuditLog({
        actorType: "WORKER",
        actorId,
        entityType: "LISTING",
        entityId: listingId,
        eventType:
          priceGuard.decision === "BLOCK"
            ? "PRICE_GUARD_BLOCKED_PUBLISH"
            : "PRICE_GUARD_MANUAL_REVIEW",
        details: {
          listingId,
          candidateId,
          marketplaceKey,
          listingIdFilter: listingIdFilter || null,
          priceGuard,
        },
      });

      skipped++;
      continue;
    }

    /**
     * LIVE PUBLISH PATH
     */
    const duplicateMatches = await findListingDuplicatesForCandidate({
      marketplaceKey,
      supplierKey: row.supplierKey,
      supplierProductId: row.supplierProductId,
      listingTitle: row.title,
      excludeListingId: listingId,
    });
    const duplicateDecision = getDuplicateBlockDecision(duplicateMatches);

    if (duplicateDecision.blocked) {
      await db.execute(sql`
        UPDATE listings
        SET
          response = COALESCE(response, '{}'::jsonb) || ${JSON.stringify({
            duplicateProtection: {
              blocked: true,
              reason: duplicateDecision.reason,
              duplicateListingIds: duplicateDecision.duplicateListingIds,
            },
          })}::jsonb,
          last_publish_error = ${`duplicate publish blocked: ${duplicateDecision.reason}`},
          updated_at = NOW()
        WHERE id = ${listingId}
      `);

      await writeAuditLog({
        actorType: "WORKER",
        actorId,
        entityType: "LISTING",
        entityId: listingId,
        eventType: "LISTING_PUBLISH_BLOCKED_DUPLICATE",
        details: {
          listingId,
          candidateId,
          marketplaceKey,
          listingIdFilter: listingIdFilter || null,
          duplicateReason: duplicateDecision.reason,
          duplicateListingIds: duplicateDecision.duplicateListingIds,
          blockingListingId: duplicateDecision.blockingListingId,
          blockingStatus: duplicateDecision.blockingStatus,
        },
      });

      skipped++;
      continue;
    }

    const rateLimit = await getPublishRateLimitState("ebay");
    if (!rateLimit.allowed) {
      await db.execute(sql`
        UPDATE listings
        SET
          response = COALESCE(response, '{}'::jsonb) || ${JSON.stringify({
            publishRateLimit: {
              blocked: true,
              blockingWindow: rateLimit.blockingWindow,
              counts: rateLimit.counts,
              limits: rateLimit.limits,
              retryHint: rateLimit.retryHint,
            },
          })}::jsonb,
          last_publish_error = ${`publish blocked by rate limiter (${rateLimit.blockingWindow})`},
          updated_at = NOW()
        WHERE id = ${listingId}
      `);

      await writeAuditLog({
        actorType: "WORKER",
        actorId,
        entityType: "LISTING",
        entityId: listingId,
        eventType: "LISTING_PUBLISH_BLOCKED_RATE_LIMIT",
        details: {
          listingId,
          candidateId,
          marketplaceKey,
          listingIdFilter: listingIdFilter || null,
          rateLimit,
        },
      });

      skipped++;
      continue;
    }

    const reserved = await reserveDailyListingSlot({
      marketplaceKey: "ebay",
    });

    if (!reserved.allowed) {
      await writeAuditLog({
        actorType: "WORKER",
        actorId,
        entityType: "LISTING",
        entityId: listingId,
        eventType: "LISTING_PUBLISH_SKIPPED_DAILY_CAP",
        details: {
          listingId,
          candidateId,
          marketplaceKey,
          listingIdFilter: listingIdFilter || null,
          dailyCap: reserved.dailyCap,
          used: reserved.used,
          remaining: reserved.remaining,
        },
      });

      skipped++;
      continue;
    }

    const locked = await db.execute(sql`
      UPDATE listings
      SET
        status = 'PUBLISH_IN_PROGRESS',
        publish_started_ts = NOW(),
        updated_at = NOW()
      WHERE id = ${listingId}
        AND status = 'READY_TO_PUBLISH'
      RETURNING id
    `);

    if (locked.rows.length === 0) {
      await writeAuditLog({
        actorType: "WORKER",
        actorId,
        entityType: "LISTING",
        entityId: listingId,
        eventType: "LISTING_PUBLISH_SKIPPED_NOT_READY",
        details: {
          listingId,
          candidateId,
          marketplaceKey,
          listingIdFilter: listingIdFilter || null,
        },
      });

      skipped++;
      continue;
    }

    await writeAuditLog({
      actorType: "WORKER",
      actorId,
      entityType: "LISTING",
      entityId: listingId,
      eventType: "LISTING_PUBLISH_STARTED",
      details: {
        listingId,
        candidateId,
        marketplaceKey,
        listingIdFilter: listingIdFilter || null,
      },
    });

    try {
      const result = await publishToEbayListing(row);

      /**
       * STRICT SUCCESS VALIDATION
       */
      if (!result.success) {
        throw new Error(result.errorMessage || "publish returned unsuccessful result");
      }

      if (!result.externalListingId) {
        throw new Error("publish succeeded but externalListingId missing");
      }

      await db.execute(sql`
        UPDATE listings
        SET
          status = 'ACTIVE',
          published_external_id = ${result.externalListingId},
          publish_finished_ts = NOW(),
          listing_date = CURRENT_DATE,
          updated_at = NOW()
        WHERE id = ${listingId}
      `);

      await writeAuditLog({
        actorType: "WORKER",
        actorId,
        entityType: "LISTING",
        entityId: listingId,
        eventType: "LISTING_PUBLISHED",
        details: {
          listingId,
          candidateId,
          marketplaceKey,
          listingIdFilter: listingIdFilter || null,
          externalListingId: result.externalListingId,
          offerId: result.offerId ?? null,
          inventoryItemKey: result.inventoryItemKey ?? null,
        },
      });

      executed++;
    } catch (err) {
      await db.execute(sql`
        UPDATE listings
        SET
          status = 'PUBLISH_FAILED',
          last_publish_error = ${String(err)},
          publish_finished_ts = NOW(),
          updated_at = NOW()
        WHERE id = ${listingId}
      `);

      await writeAuditLog({
        actorType: "WORKER",
        actorId,
        entityType: "LISTING",
        entityId: listingId,
        eventType: "LISTING_PUBLISH_FAILED",
        details: {
          listingId,
          candidateId,
          marketplaceKey,
          listingIdFilter: listingIdFilter || null,
          error: String(err),
        },
      });

      failed++;
    }
  }

  return {
    executed,
    skipped,
    failed,
  };
}
