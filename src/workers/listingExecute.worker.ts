import { db, pool } from "@/lib/db";
import { sql } from "drizzle-orm";
import { writeAuditLog } from "@/lib/audit/writeAuditLog";
import { getDailyListingCap, reserveDailyListingSlot } from "@/lib/listings/checkDailyListingCap";
import { getListingExecutionCandidates } from "@/lib/listings/getListingExecutionCandidates";

type RunListingExecutionInput =
  | number
  | {
      limit?: number;
      dailyCap?: number;
      marketplaceKey?: "ebay";
      dryRun?: boolean;
      actorId?: string;
    };

type WorkerRunStatus = "STARTED" | "SUCCEEDED" | "FAILED";

function normalizeInput(input?: RunListingExecutionInput) {
  if (typeof input === "number") {
    return {
      limit: input,
      dailyCap: input,
      marketplaceKey: "ebay" as const,
      dryRun: true,
      actorId: "run_listing_execution_direct",
    };
  }

  return {
    limit: Number(input?.limit ?? 10),
    dailyCap: Number(input?.dailyCap ?? process.env.LISTING_DAILY_CAP ?? "10"),
    marketplaceKey: (input?.marketplaceKey ?? "ebay") as "ebay",
    dryRun: input?.dryRun ?? true,
    actorId: input?.actorId ?? "listingExecute.worker",
  };
}

function safeErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return String(error ?? "unknown publish error");
}

async function logWorkerRun(args: {
  status: WorkerRunStatus;
  jobId: string;
  actorId: string;
  dryRun: boolean;
  durationMs?: number;
  error?: string | null;
  stats?: unknown;
}) {
  await pool.query(
    `
      INSERT INTO worker_runs (
        worker,
        job_name,
        job_id,
        status,
        duration_ms,
        ok,
        error,
        stats,
        started_at,
        finished_at
      )
      VALUES (
        'listingExecute.worker',
        'LISTING_EXECUTE',
        $1,
        $2,
        $3,
        $4,
        $5,
        $6::jsonb,
        NOW(),
        CASE WHEN $7 THEN NOW() ELSE NULL END
      )
    `,
    [
      args.jobId,
      args.status,
      args.durationMs ?? null,
      args.status === "SUCCEEDED",
      args.error ?? null,
      JSON.stringify({ actorId: args.actorId, dryRun: args.dryRun, ...(args.stats ?? {}) }),
      args.status !== "STARTED",
    ]
  );
}

export async function runListingExecution(input?: RunListingExecutionInput) {
  const config = normalizeInput(input);
  const startedAt = Date.now();
  const runId = crypto.randomUUID();

  await logWorkerRun({
    status: "STARTED",
    jobId: runId,
    actorId: config.actorId,
    dryRun: config.dryRun,
  });

  try {
    if (config.marketplaceKey !== "ebay") {
      throw new Error("v1 live listing execution only supports ebay");
    }

    const cap = await getDailyListingCap({
      marketplaceKey: config.marketplaceKey,
      dailyCap: config.dailyCap,
    });

    const fetchLimit = Math.max(
      0,
      Math.min(
        Number.isFinite(config.limit) ? config.limit : 10,
        config.dryRun ? config.limit : cap.remaining
      )
    );

    const candidates = await getListingExecutionCandidates({
      limit: fetchLimit,
      marketplace: "ebay",
    });

    if (!config.dryRun && cap.remaining === 0) {
      console.log("[listing-execute] daily cap reached");
      const capReached = {
        ok: true,
        marketplaceKey: "ebay",
        dryRun: false,
        eligible: candidates.length,
        executed: 0,
        skipped: 0,
        failed: 0,
        dailyRemaining: 0,
      };

      await logWorkerRun({
        status: "SUCCEEDED",
        jobId: runId,
        actorId: config.actorId,
        dryRun: config.dryRun,
        durationMs: Date.now() - startedAt,
        stats: capReached,
      });

      return capReached;
    }

    let executed = 0;
    let skipped = 0;
    let failed = 0;

    console.log("[listing-execute] candidates", {
      marketplaceKey: config.marketplaceKey,
      dryRun: config.dryRun,
      requestedLimit: config.limit,
      fetched: candidates.length,
      dailyRemaining: cap.remaining,
    });

    for (const row of candidates) {
      if (!row?.id) {
        skipped++;
        continue;
      }

      const listingId = row.id;
      const candidateId = row.candidateId;

      if (config.dryRun) {
        await writeAuditLog({
          actorType: "WORKER",
          actorId: config.actorId,
          entityType: "LISTING",
          entityId: listingId,
          eventType: "LISTING_PUBLISH_DRY_RUN_STARTED",
          details: {
            listingId,
            candidateId,
            marketplaceKey: "ebay",
            status: row.status,
            idempotencyKey: row.idempotencyKey,
          },
        });

        const checked = await db.execute(sql`
          UPDATE listings
          SET
            response = COALESCE(response, '{}'::jsonb) || ${JSON.stringify({
              dryRun: true,
              liveApiCalled: false,
              executionCheckedAt: new Date().toISOString(),
            })}::jsonb,
            updated_at = NOW(),
            last_publish_error = NULL
          WHERE id = ${listingId}
            AND status = 'READY_TO_PUBLISH'
          RETURNING id
        `);

        if (checked.rows.length === 0) {
          skipped++;
          continue;
        }

        await writeAuditLog({
          actorType: "WORKER",
          actorId: config.actorId,
          entityType: "LISTING",
          entityId: listingId,
          eventType: "LISTING_PUBLISH_DRY_RUN_OK",
          details: {
            listingId,
            candidateId,
            marketplaceKey: "ebay",
            dryRun: true,
            liveApiCalled: false,
          },
        });

        executed++;
        continue;
      }

      const reserved = await reserveDailyListingSlot({
        marketplaceKey: "ebay",
        dailyCap: config.dailyCap,
      });

      if (!reserved.allowed) {
        await writeAuditLog({
          actorType: "WORKER",
          actorId: config.actorId,
          entityType: "LISTING",
          entityId: listingId,
          eventType: "LISTING_PUBLISH_SKIPPED_CAP_REACHED",
          details: {
            listingId,
            candidateId,
            marketplaceKey: "ebay",
            dailyCap: reserved.dailyCap,
            used: reserved.used,
            remaining: reserved.remaining,
          },
        });
        skipped++;
        break;
      }

      const moved = await db.execute(sql`
        UPDATE listings
        SET
          status = 'PUBLISH_IN_PROGRESS',
          publish_marketplace = 'ebay',
          publish_started_ts = NOW(),
          publish_attempt_count = COALESCE(publish_attempt_count, 0) + 1,
          last_publish_error = NULL,
          updated_at = NOW()
        WHERE id = ${listingId}
          AND status = 'READY_TO_PUBLISH'
        RETURNING id
      `);

      if (moved.rows.length === 0) {
        skipped++;
        continue;
      }

      await writeAuditLog({
        actorType: "WORKER",
        actorId: config.actorId,
        entityType: "LISTING",
        entityId: listingId,
        eventType: "LISTING_PUBLISH_STARTED",
        details: {
          listingId,
          candidateId,
          marketplaceKey: "ebay",
          dryRun: false,
          idempotencyKey: row.idempotencyKey,
        },
      });

      try {
        throw new Error("live eBay publish is not enabled yet in v1 local execution path");
      } catch (error) {
        const message = safeErrorMessage(error);

        await db.execute(sql`
          UPDATE listings
          SET
            status = 'PUBLISH_FAILED',
            publish_finished_ts = NOW(),
            last_publish_error = ${message},
            updated_at = NOW()
          WHERE id = ${listingId}
        `);

        await writeAuditLog({
          actorType: "WORKER",
          actorId: config.actorId,
          entityType: "LISTING",
          entityId: listingId,
          eventType: "LISTING_PUBLISH_FAILED",
          details: {
            listingId,
            candidateId,
            marketplaceKey: "ebay",
            error: message,
          },
        });

        failed++;
      }
    }

    const finalCap = await getDailyListingCap({
      marketplaceKey: "ebay",
      dailyCap: config.dailyCap,
    });

    const result = {
      ok: true,
      marketplaceKey: "ebay",
      dryRun: config.dryRun,
      eligible: candidates.length,
      executed,
      skipped,
      failed,
      dailyRemaining: finalCap.remaining,
    };

    await logWorkerRun({
      status: "SUCCEEDED",
      jobId: runId,
      actorId: config.actorId,
      dryRun: config.dryRun,
      durationMs: Date.now() - startedAt,
      stats: result,
    });

    console.log("[listing-execute] completed", result);
    return result;
  } catch (error) {
    const message = safeErrorMessage(error);

    await logWorkerRun({
      status: "FAILED",
      jobId: runId,
      actorId: config.actorId,
      dryRun: config.dryRun,
      durationMs: Date.now() - startedAt,
      error: message,
      stats: { marketplaceKey: config.marketplaceKey },
    });

    throw error;
  }
}

export default runListingExecution;
