import dotenv from "dotenv";
import pg from "pg";

dotenv.config({ path: ".env.local" });
dotenv.config();

const { Client } = pg;

async function main() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });

  await client.connect();

  const eligiblePreviewRows = await client.query(`
    SELECT
      l.id,
      l.candidate_id,
      l.marketplace_key,
      l.status,
      pc.decision_status,
      pc.listing_eligible,
      pc.listing_block_reason
    FROM listings l
    JOIN profitable_candidates pc
      ON pc.id = l.candidate_id
    WHERE l.status = 'PREVIEW'
      AND l.marketplace_key = 'ebay'
      AND pc.decision_status = 'APPROVED'
      AND pc.listing_eligible = TRUE
      AND NOT EXISTS (
        SELECT 1
        FROM listings l2
        WHERE l2.candidate_id = l.candidate_id
          AND l2.marketplace_key = l.marketplace_key
          AND l2.status IN ('READY_TO_PUBLISH', 'PUBLISH_IN_PROGRESS', 'ACTIVE')
      )
    ORDER BY l.updated_at DESC, l.created_at DESC
  `);

  console.log("eligible PREVIEW rows:");
  console.table(eligiblePreviewRows.rows);

  if (eligiblePreviewRows.rows.length === 0) {
    const diagnostics = await client.query(`
      SELECT
        l.id,
        l.candidate_id,
        l.marketplace_key,
        l.status,
        l.idempotency_key,
        pc.decision_status,
        pc.listing_eligible,
        pc.listing_block_reason
      FROM listings l
      JOIN profitable_candidates pc
        ON pc.id = l.candidate_id
      WHERE l.marketplace_key = 'ebay'
      ORDER BY l.updated_at DESC, l.created_at DESC
      LIMIT 20
    `);

    console.log("No eligible PREVIEW rows found for promotion.");
    console.log("Diagnostics:");
    console.table(diagnostics.rows);

    await client.end();
    return;
  }

  const ids = eligiblePreviewRows.rows.map((row) => row.id);

  const promoted = await client.query(
    `
      UPDATE listings
      SET
        status = 'READY_TO_PUBLISH',
        updated_at = NOW(),
        response = COALESCE(response, '{}'::jsonb) || '{"promotedToReady":true}'::jsonb
      WHERE id = ANY($1::uuid[])
      RETURNING id, candidate_id, marketplace_key, status, updated_at
    `,
    [ids]
  );

  console.log("Promoted rows:");
  console.table(promoted.rows);

  await client.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
