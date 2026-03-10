import { db } from "@/lib/db";
import { sql } from "drizzle-orm";
import { writeAuditLog } from "@/lib/audit/writeAuditLog";
import { reserveDailyListingSlot } from "@/lib/listings/checkDailyListingCap";
import { getListingExecutionCandidates } from "@/lib/listings/getListingExecutionCandidates";
import { publishToEbayListing } from "@/lib/marketplaces/ebayPublish";

function isLivePublishEnabled(): boolean {
  return String(process.env.ENABLE_EBAY_LIVE_PUBLISH ?? "false").toLowerCase() === "true";
}

export async function runListingExecution(opts?: {
  limit?: number;
  dryRun?: boolean;
  dailyCap?: number;
  marketplaceKey?: "ebay";
  actorId?: string;
}) {

  const limit = opts?.limit ?? opts?.dailyCap ?? 5;
  const dryRun = opts?.dryRun ?? true;
  const marketplaceKey = (opts?.marketplaceKey ?? "ebay") as "ebay";
  const actorId = opts?.actorId ?? "listingExecute.worker";
  const livePublishEnabled = isLivePublishEnabled();

  const rows = await getListingExecutionCandidates({
    marketplace: marketplaceKey,
    limit
  });

  let executed = 0;
  let skipped = 0;
  let failed = 0;

  for (const row of rows) {

    const listingId = row.id;

    if (!listingId) {
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
          dryRun: true,
          liveApiCalled: false
        }
      });

      executed++;
      continue;
    }

    /**
     * LIVE PUBLISH PATH
     */

    const reserved = await reserveDailyListingSlot({
      marketplaceKey: "ebay"
    });

    if (!reserved.allowed) {
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
      skipped++;
      continue;
    }

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

      failed++;
    }
  }

  return {
    executed,
    skipped,
    failed
  };
}
