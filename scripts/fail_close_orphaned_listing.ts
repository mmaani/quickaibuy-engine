import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });
dotenv.config();

type ListingRow = {
  id: string;
  status: string;
  candidateId: string | null;
  candidateExists: string | null;
};

async function main() {
  const { sql } = await import("drizzle-orm");
  const { db } = await import("@/lib/db");
  const { writeAuditLog } = await import("@/lib/audit/writeAuditLog");
  const listingId = String(process.argv[2] ?? "").trim();
  if (!listingId) {
    console.error("Usage: pnpm exec tsx scripts/fail_close_orphaned_listing.ts <listing_id>");
    process.exit(1);
  }

  const current = await db.execute<ListingRow>(sql`
    SELECT
      l.id,
      l.status,
      l.candidate_id AS "candidateId",
      pc.id AS "candidateExists"
    FROM listings l
    LEFT JOIN profitable_candidates pc
      ON pc.id = l.candidate_id
    WHERE l.id = ${listingId}
    LIMIT 1
  `);

  const row = current.rows?.[0] ?? null;
  if (!row) {
    console.error("Listing not found.");
    process.exit(1);
  }

  if (String(row.status ?? "") !== "READY_TO_PUBLISH") {
    console.error(`Blocked: listing must be READY_TO_PUBLISH. Current status: ${row.status}`);
    process.exit(1);
  }

  if (row.candidateExists) {
    console.error("Blocked: candidate still exists. This script is only for orphaned listings.");
    process.exit(1);
  }

  const responsePatch = {
    recoveryState: "BLOCKED_ORPHANED_CANDIDATE",
    publishBlocked: true,
    requiresManualRecovery: true,
    blockedAt: new Date().toISOString(),
    note: "Candidate row missing after refresh attempt; moved fail-closed out of READY_TO_PUBLISH.",
  };

  await db.execute(sql`
    UPDATE listings
    SET
      status = 'PUBLISH_FAILED',
      last_publish_error = 'Publish blocked: candidate missing after refresh; manual recovery required',
      response = COALESCE(response, '{}'::jsonb) || ${JSON.stringify(responsePatch)}::jsonb,
      updated_at = NOW()
    WHERE id = ${listingId}
  `);

  await writeAuditLog({
    actorType: "ADMIN",
    actorId: "scripts/fail_close_orphaned_listing.ts",
    entityType: "LISTING",
    entityId: listingId,
    eventType: "LISTING_FAIL_CLOSED_ORPHANED_CANDIDATE",
    details: {
      listingId,
      previousStatus: "READY_TO_PUBLISH",
      newStatus: "PUBLISH_FAILED",
      reason: "candidate missing after refresh attempt",
      nextAction: "manual recovery required before any future promotion",
    },
  });

  const finalState = await db.execute(sql`
    SELECT
      l.id,
      l.status,
      l.last_publish_error,
      l.response,
      pc.id AS "candidateExists"
    FROM listings l
    LEFT JOIN profitable_candidates pc
      ON pc.id = l.candidate_id
    WHERE l.id = ${listingId}
    LIMIT 1
  `);

  console.log(JSON.stringify(finalState.rows?.[0] ?? null, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
