import { db } from "@/lib/db";
import { sql } from "drizzle-orm";
import { writeAuditLog } from "@/lib/audit/writeAuditLog";
import { releaseDailyListingSlot, reserveDailyListingSlot } from "@/lib/listings/checkDailyListingCap";
import { getListingThroughputState } from "@/lib/listings/listingThroughputController";
import {
  findListingDuplicatesForCandidate,
  getDuplicateBlockDecision,
} from "@/lib/listings/duplicateProtection";
import { enqueueMarketplacePriceScan } from "@/lib/jobs/enqueueMarketplacePriceScan";
import { enqueueSupplierDiscoverRefresh } from "@/lib/jobs/enqueueSupplierDiscover";
import { getPublishRateLimitState } from "@/lib/listings/publishRateLimiter";
import { getListingExecutionCandidates } from "@/lib/listings/getListingExecutionCandidates";
import { publishToEbayListing } from "@/lib/marketplaces/ebayPublish";
import { validateProfitSafety } from "@/lib/profit/priceGuard";
import {
  LISTING_PUBLISH_ENTRY_STATUS,
  LISTING_STATUSES,
  isPausedListingStatus,
} from "@/lib/listings/statuses";
import { recordPublishLearning } from "@/lib/learningHub/pipelineWriters";
import {
  assertLearningHubReady,
  assertPublishExecutionContext,
} from "@/lib/enforcement/runtimeSovereignty";

// Supplier snapshot older than 48h must be refreshed before publish.
const SUPPLIER_SNAPSHOT_REFRESH_MAX_AGE_HOURS = 48;

function hasSupplierDriftBlock(reasons: string[]): boolean {
  return reasons.some((reason) =>
    [
      "SUPPLIER_PRICE_DRIFT_EXCEEDS_TOLERANCE",
      "SUPPLIER_DRIFT_DATA_UNAVAILABLE",
      "STALE_SUPPLIER_SNAPSHOT",
      "SUPPLIER_DRIFT_DATA_REQUIRED",
      "SUPPLIER_SNAPSHOT_AGE_REQUIRED",
      "SUPPLIER_OUT_OF_STOCK",
      "SUPPLIER_LOW_STOCK",
      "SUPPLIER_AVAILABILITY_UNKNOWN",
      "SUPPLIER_AVAILABILITY_LOW_CONFIDENCE",
    ].includes(reason)
  );
}

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
  executionContext?: {
    viaWorkerJob?: boolean;
    viaBackbone?: boolean;
    viaControlPlane?: boolean;
  };
}) {
  const limit = opts?.limit ?? opts?.dailyCap ?? 5;
  const dryRun = opts?.dryRun ?? true;
  const marketplaceKey = (opts?.marketplaceKey ?? "ebay") as "ebay";
  const actorId = opts?.actorId ?? "listingExecute.worker";
  const listingIdFilter = String(opts?.listingId ?? "").trim();
  const livePublishEnabled = isLivePublishEnabled();
  const executionContext = {
    viaWorkerJob: Boolean(opts?.executionContext?.viaWorkerJob),
    viaBackbone: Boolean(opts?.executionContext?.viaBackbone),
    viaControlPlane: Boolean(opts?.executionContext?.viaControlPlane),
  };

  await assertPublishExecutionContext({
    blockedAction: "listing_publish_execution",
    path: "runListingExecution",
    actorId,
    actorType: "WORKER",
    ...executionContext,
  });

  await assertLearningHubReady({
    blockedAction: "listing_publish_execution",
    path: "runListingExecution",
    actorId,
    actorType: "WORKER",
    requiredDomains: [
      "supplier_intelligence",
      "shipping_intelligence",
      "opportunity_scores",
      "control_plane_scorecards",
    ],
  });

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

    const currentStatusResult = await db.execute<{ status: string }>(sql`
      SELECT status
      FROM listings
      WHERE id = ${listingId}
      LIMIT 1
    `);
    const currentStatus = String(currentStatusResult.rows?.[0]?.status ?? "").trim();
    if (isPausedListingStatus(currentStatus)) {
      await writeAuditLog({
        actorType: "WORKER",
        actorId,
        entityType: "LISTING",
        entityId: listingId,
        eventType: "LISTING_PUBLISH_BLOCKED_PAUSED",
        details: {
          listingId,
          candidateId,
          marketplaceKey,
          listingIdFilter: listingIdFilter || null,
          reason: "paused listings require explicit operator resume",
        },
      });
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
          AND status = ${LISTING_PUBLISH_ENTRY_STATUS}
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

    const driftMetricAvailable = priceGuard.metrics.supplier_price_drift_pct != null;
    const supplierSnapshotAgeHours = priceGuard.metrics.supplier_snapshot_age_hours;
    const supplierSnapshotAgeAvailable = supplierSnapshotAgeHours != null;
    const staleSupplierSnapshot =
      supplierSnapshotAgeHours != null &&
      supplierSnapshotAgeHours > SUPPLIER_SNAPSHOT_REFRESH_MAX_AGE_HOURS;
    const failClosed = !priceGuard.allow || !driftMetricAvailable || !supplierSnapshotAgeAvailable;

    if (failClosed) {
      const staleMarketplaceSnapshot = priceGuard.reasons.includes("STALE_MARKETPLACE_SNAPSHOT");
      const reasons = [...priceGuard.reasons];
      if (!driftMetricAvailable) reasons.push("SUPPLIER_DRIFT_DATA_REQUIRED");
      if (!supplierSnapshotAgeAvailable) reasons.push("SUPPLIER_SNAPSHOT_AGE_REQUIRED");

      const guardSummary = {
        decision: priceGuard.decision,
        reasons,
        metrics: priceGuard.metrics,
        thresholds: priceGuard.thresholds,
      };
      let marketplaceRefreshEnqueued = false;
      let marketplaceRefreshJobId: string | null = null;
      let marketplaceRefreshError: string | null = null;
      let supplierRefreshEnqueued = false;
      let supplierRefreshJobId: string | null = null;
      let supplierRefreshError: string | null = null;

      if (staleMarketplaceSnapshot) {
        try {
          const candidateLookup = await db.execute<{
            supplierSnapshotId: string | null;
          }>(sql`
            SELECT supplier_snapshot_id AS "supplierSnapshotId"
            FROM profitable_candidates
            WHERE id = ${candidateId}
            LIMIT 1
          `);

          const supplierSnapshotId = String(candidateLookup.rows?.[0]?.supplierSnapshotId ?? "").trim();
          const job = await enqueueMarketplacePriceScan({
            limit: 25,
            productRawId: supplierSnapshotId || undefined,
            platform: "ebay",
          });
          marketplaceRefreshEnqueued = true;
          marketplaceRefreshJobId = String(job.id ?? "");
        } catch (error) {
          marketplaceRefreshError = error instanceof Error ? error.message : String(error);
        }
      }
      if (staleSupplierSnapshot) {
        try {
          const refreshJob = await enqueueSupplierDiscoverRefresh({
            idempotencySuffix: candidateId,
            reason: "supplier-snapshot-age-gt-48h",
          });
          supplierRefreshEnqueued = true;
          supplierRefreshJobId = String(refreshJob.id ?? "");
        } catch (error) {
          supplierRefreshError = error instanceof Error ? error.message : String(error);
        }
      }

      const shouldManualReview =
        reasons.includes("SUPPLIER_PRICE_DRIFT_EXCEEDS_TOLERANCE") ||
        !driftMetricAvailable ||
        !supplierSnapshotAgeAvailable;

      await db.execute(sql`
        UPDATE profitable_candidates
        SET
          decision_status = CASE WHEN ${shouldManualReview} THEN 'MANUAL_REVIEW' ELSE decision_status END,
          listing_eligible = FALSE,
          listing_block_reason = ${`PRICE_GUARD_${priceGuard.decision}: ${reasons.join(", ")}`},
          listing_eligible_ts = NOW()
        WHERE id = ${candidateId}
      `);

      await db.execute(sql`
        UPDATE listings
        SET
          response = COALESCE(response, '{}'::jsonb) || ${JSON.stringify({
            priceGuard: guardSummary,
            marketplaceRefresh: {
              attempted: staleMarketplaceSnapshot,
              enqueued: marketplaceRefreshEnqueued,
              jobId: marketplaceRefreshJobId,
              error: marketplaceRefreshError,
            },
            supplierRefresh: {
              attempted: staleSupplierSnapshot,
              enqueued: supplierRefreshEnqueued,
              jobId: supplierRefreshJobId,
              error: supplierRefreshError,
            },
          })}::jsonb,
          last_publish_error = ${staleMarketplaceSnapshot
            ? marketplaceRefreshError
              ? `PriceGuard ${priceGuard.decision}: stale marketplace snapshot; refresh enqueue failed: ${marketplaceRefreshError}`
              : `PriceGuard ${priceGuard.decision}: stale marketplace snapshot; refresh enqueued (${marketplaceRefreshJobId ?? "job-id-unavailable"})`
            : staleSupplierSnapshot
              ? supplierRefreshError
                ? `PriceGuard ${priceGuard.decision}: stale supplier snapshot (${supplierSnapshotAgeHours}h > ${SUPPLIER_SNAPSHOT_REFRESH_MAX_AGE_HOURS}h); refresh enqueue failed: ${supplierRefreshError}`
                : `PriceGuard ${priceGuard.decision}: stale supplier snapshot (${supplierSnapshotAgeHours}h > ${SUPPLIER_SNAPSHOT_REFRESH_MAX_AGE_HOURS}h); refresh enqueued (${supplierRefreshJobId ?? "job-id-unavailable"})`
              : `PriceGuard ${priceGuard.decision}: ${reasons.join(", ")}`},
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
          marketplaceRefresh: {
            attempted: staleMarketplaceSnapshot,
            enqueued: marketplaceRefreshEnqueued,
            jobId: marketplaceRefreshJobId,
            error: marketplaceRefreshError,
          },
          supplierRefresh: {
            attempted: staleSupplierSnapshot,
            enqueued: supplierRefreshEnqueued,
            jobId: supplierRefreshJobId,
            error: supplierRefreshError,
          },
        },
      });

      if (staleMarketplaceSnapshot) {
        await writeAuditLog({
          actorType: "WORKER",
          actorId,
          entityType: "LISTING",
          entityId: listingId,
          eventType: "LISTING_BLOCKED_STALE_MARKETPLACE",
          details: {
            listingId,
            candidateId,
            marketplaceKey,
            listingIdFilter: listingIdFilter || null,
            reasons,
            marketplaceSnapshotAgeHours: priceGuard.metrics.marketplace_snapshot_age_hours,
            maxMarketplaceSnapshotAgeHours: priceGuard.thresholds.maxMarketplaceSnapshotAgeHours,
          },
        });
      }

      if (hasSupplierDriftBlock(reasons)) {
        await writeAuditLog({
          actorType: "WORKER",
          actorId,
          entityType: "LISTING",
          entityId: listingId,
          eventType: "LISTING_BLOCKED_SUPPLIER_DRIFT",
          details: {
            listingId,
            candidateId,
            marketplaceKey,
            listingIdFilter: listingIdFilter || null,
            reasons,
            supplierDriftPct: priceGuard.metrics.supplier_price_drift_pct,
            supplierSnapshotAgeHours: priceGuard.metrics.supplier_snapshot_age_hours,
            availabilitySignal: priceGuard.metrics.availability_signal,
            availabilityConfidence: priceGuard.metrics.availability_confidence,
            maxSupplierDriftPct: priceGuard.thresholds.maxSupplierDriftPct,
            maxSupplierSnapshotAgeHours: priceGuard.thresholds.maxSupplierSnapshotAgeHours,
          },
        });
      }

      if (staleMarketplaceSnapshot) {
        await writeAuditLog({
          actorType: "WORKER",
          actorId,
          entityType: "LISTING",
          entityId: listingId,
          eventType: marketplaceRefreshEnqueued
            ? "MARKETPLACE_REFRESH_ENQUEUED_STALE_SNAPSHOT"
            : "MARKETPLACE_REFRESH_ENQUEUE_FAILED_STALE_SNAPSHOT",
          details: {
            listingId,
            candidateId,
            marketplaceKey,
            listingIdFilter: listingIdFilter || null,
            staleReason: true,
            marketplaceRefreshEnqueued,
            marketplaceRefreshJobId,
            marketplaceRefreshError,
          },
        });
        await writeAuditLog({
          actorType: "WORKER",
          actorId,
          entityType: "LISTING",
          entityId: listingId,
          eventType: "LISTING_REFRESH_ENQUEUED_FOR_RECOVERY",
          details: {
            listingId,
            candidateId,
            marketplaceKey,
            listingIdFilter: listingIdFilter || null,
            refreshType: "MARKETPLACE_PRICE_SCAN",
            enqueued: marketplaceRefreshEnqueued,
            jobId: marketplaceRefreshJobId,
            error: marketplaceRefreshError,
          },
        });
      }

      if (staleMarketplaceSnapshot && marketplaceRefreshError) {
        failed++;
        continue;
      }
      if (staleSupplierSnapshot && supplierRefreshError) {
        failed++;
        continue;
      }
      if (staleSupplierSnapshot) {
        await writeAuditLog({
          actorType: "WORKER",
          actorId,
          entityType: "LISTING",
          entityId: listingId,
          eventType: "LISTING_REFRESH_ENQUEUED_FOR_RECOVERY",
          details: {
            listingId,
            candidateId,
            marketplaceKey,
            listingIdFilter: listingIdFilter || null,
            refreshType: "SUPPLIER_PRODUCT_REFRESH",
            enqueued: supplierRefreshEnqueued,
            jobId: supplierRefreshJobId,
            error: supplierRefreshError,
          },
        });
      }

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

    const throughput = await getListingThroughputState({
      marketplaceKey: "ebay",
      candidateId,
      marketplaceListingId: row.marketplaceListingId,
    });

    if (!throughput.allowed) {
      await db.execute(sql`
        UPDATE listings
        SET
          response = COALESCE(response, '{}'::jsonb) || ${JSON.stringify({
            listingThroughput: throughput,
          })}::jsonb,
          last_publish_error = ${`publish blocked by throughput controller (${throughput.blockingReason ?? "unknown"})`},
          updated_at = NOW()
        WHERE id = ${listingId}
      `);

      await writeAuditLog({
        actorType: "WORKER",
        actorId,
        entityType: "LISTING",
        entityId: listingId,
        eventType: "LISTING_PUBLISH_BLOCKED_THROUGHPUT",
        details: {
          listingId,
          candidateId,
          marketplaceKey,
          listingIdFilter: listingIdFilter || null,
          throughput,
        },
      });

      skipped++;
      continue;
    }

    const locked = await db.execute(sql`
      UPDATE listings
      SET
        status = ${LISTING_STATUSES.PUBLISH_IN_PROGRESS},
        publish_started_ts = NOW(),
        updated_at = NOW()
      WHERE id = ${listingId}
        AND status = ${LISTING_PUBLISH_ENTRY_STATUS}
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

    const reserved = await reserveDailyListingSlot({
      marketplaceKey: "ebay",
      dailyCap: throughput.maxDailyPublish,
    });

    if (!reserved.allowed) {
      await db.execute(sql`
        UPDATE listings
        SET
          status = ${LISTING_PUBLISH_ENTRY_STATUS},
          publish_started_ts = NULL,
          updated_at = NOW()
        WHERE id = ${listingId}
          AND status = ${LISTING_STATUSES.PUBLISH_IN_PROGRESS}
      `);

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
          status = ${LISTING_STATUSES.ACTIVE},
          published_external_id = ${result.externalListingId},
          response = COALESCE(response, '{}'::jsonb) || ${JSON.stringify({
            liveApiCalled: true,
            publishSucceeded: true,
            publishedExternalId: result.externalListingId,
            offerId: result.offerId ?? null,
            inventoryItemKey: result.inventoryItemKey ?? null,
            publishResult: result.raw ?? null,
          })}::jsonb,
          last_publish_error = NULL,
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
      const released = await releaseDailyListingSlot({
        marketplaceKey: "ebay",
        dailyCap: throughput.maxDailyPublish,
      });

      await db.execute(sql`
        UPDATE listings
        SET
          status = ${LISTING_STATUSES.PUBLISH_FAILED},
          last_publish_error = ${String(err)},
          response = COALESCE(response, '{}'::jsonb) || ${JSON.stringify({
            dailyCapRelease: {
              released: true,
            },
          })}::jsonb,
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
          dailyCapRelease: {
            dailyCap: released.dailyCap,
            used: released.used,
            remaining: released.remaining,
          },
        },
      });

      failed++;
    }
  }

  const result = {
    executed,
    skipped,
    failed,
  };
  await recordPublishLearning({
    executed,
    skipped,
    failed,
    dryRun: dryRun || !livePublishEnabled,
    marketplaceKey,
  });
  return result;
}
