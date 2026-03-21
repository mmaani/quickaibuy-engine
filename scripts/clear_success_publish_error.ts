import dotenv from "dotenv";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { writeAuditLog } from "@/lib/audit/writeAuditLog";

dotenv.config({ path: ".env.local" });
dotenv.config();

async function main() {
  const listingId = String(process.argv[2] ?? "").trim();
  if (!listingId) {
    throw new Error("Usage: pnpm exec tsx scripts/clear_success_publish_error.ts <listing_id>");
  }

  const current = await db.execute<{
    listingId: string;
    status: string;
    publishedExternalId: string | null;
    lastPublishError: string | null;
  }>(sql`
    SELECT
      id AS "listingId",
      status,
      published_external_id AS "publishedExternalId",
      last_publish_error AS "lastPublishError"
    FROM listings
    WHERE id = ${listingId}
    LIMIT 1
  `);

  const row = current.rows[0];
  if (!row) {
    throw new Error(`Listing not found: ${listingId}`);
  }
  if (String(row.status) !== "ACTIVE") {
    throw new Error(`Listing ${listingId} is not ACTIVE.`);
  }
  if (!row.publishedExternalId) {
    throw new Error(`Listing ${listingId} has no published_external_id.`);
  }

  if (!row.lastPublishError) {
    console.log(
      JSON.stringify(
        {
          ok: true,
          listingId,
          cleared: false,
          reason: "last_publish_error already null",
        },
        null,
        2
      )
    );
    return;
  }

  await db.execute(sql`
    UPDATE listings
    SET
      last_publish_error = NULL,
      updated_at = NOW()
    WHERE id = ${listingId}
      AND status = 'ACTIVE'
      AND published_external_id IS NOT NULL
  `);

  await writeAuditLog({
    actorType: "ADMIN",
    actorId: "clear_success_publish_error.ts",
    entityType: "LISTING",
    entityId: listingId,
    eventType: "LISTING_PUBLISH_ERROR_CLEARED_AFTER_SUCCESS",
    details: {
      listingId,
      externalListingId: row.publishedExternalId,
      previousError: row.lastPublishError,
    },
  });

  const after = await db.execute<{
    listingId: string;
    status: string;
    publishedExternalId: string | null;
    lastPublishError: string | null;
  }>(sql`
    SELECT
      id AS "listingId",
      status,
      published_external_id AS "publishedExternalId",
      last_publish_error AS "lastPublishError"
    FROM listings
    WHERE id = ${listingId}
    LIMIT 1
  `);

  console.log(
    JSON.stringify(
      {
        ok: true,
        listingId,
        cleared: true,
        before: row,
        after: after.rows[0] ?? null,
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exit(1);
});
