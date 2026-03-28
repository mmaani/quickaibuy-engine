import pg from "pg";
import { getRequiredDatabaseUrl, loadRuntimeEnv } from "./lib/runtimeEnv.mjs";

loadRuntimeEnv();

const { Client } = pg;

async function main() {
  const candidateIds = process.argv.slice(2).filter(Boolean);
  const client = new Client({
    connectionString: getRequiredDatabaseUrl(),
    ssl: { rejectUnauthorized: false },
  });

  await client.connect();

  try {
    const counts = await client.query(`
      WITH latest_listing AS (
        SELECT DISTINCT ON (l.candidate_id, lower(l.marketplace_key))
          l.candidate_id,
          lower(l.marketplace_key) AS marketplace_key,
          l.id,
          l.status,
          l.updated_at
        FROM listings l
        ORDER BY
          l.candidate_id,
          lower(l.marketplace_key),
          l.updated_at DESC NULLS LAST,
          l.created_at DESC NULLS LAST,
          l.id DESC
      )
      SELECT
        count(*) FILTER (WHERE pc.decision_status = 'APPROVED')::int AS approved_candidates,
        count(*) FILTER (WHERE pc.decision_status = 'APPROVED' AND coalesce(pc.listing_eligible, false) = true)::int AS listing_eligible,
        count(*) FILTER (WHERE pc.decision_status = 'APPROVED' AND ll.id IS NOT NULL)::int AS preview_prepared,
        count(*) FILTER (WHERE ll.status = 'READY_TO_PUBLISH')::int AS ready_to_publish,
        count(*) FILTER (WHERE ll.status = 'ACTIVE')::int AS active_relevant
      FROM profitable_candidates pc
      LEFT JOIN latest_listing ll
        ON ll.candidate_id = pc.id
       AND ll.marketplace_key = lower(pc.marketplace_key)
      WHERE lower(pc.marketplace_key) = 'ebay'
    `);

    const activeListings = await client.query(`
      SELECT
        l.id AS listing_id,
        l.candidate_id,
        l.status,
        l.published_external_id,
        pc.supplier_key,
        pc.supplier_product_id,
        pc.marketplace_listing_id
      FROM listings l
      LEFT JOIN profitable_candidates pc
        ON pc.id = l.candidate_id
      WHERE lower(l.marketplace_key) = 'ebay'
        AND l.status = 'ACTIVE'
      ORDER BY l.updated_at DESC NULLS LAST, l.created_at DESC NULLS LAST
    `);

    let candidateRows: unknown[] = [];
    let duplicateConflicts: unknown[] = [];

    if (candidateIds.length > 0) {
      const candidateResult = await client.query(
        `
          SELECT
            pc.id AS candidate_id,
            pc.supplier_key,
            pc.supplier_product_id,
            pc.marketplace_listing_id,
            pc.decision_status,
            pc.listing_eligible,
            pc.listing_block_reason,
            pc.estimated_profit,
            pc.margin_pct,
            pc.roi_pct,
            pc.reason,
            pc.calc_ts
          FROM profitable_candidates pc
          WHERE pc.id = ANY($1::uuid[])
          ORDER BY pc.calc_ts DESC NULLS LAST
        `,
        [candidateIds]
      );
      candidateRows = candidateResult.rows;

      const duplicateResult = await client.query(
        `
          SELECT
            pc.id AS candidate_id,
            pc.supplier_key,
            pc.supplier_product_id,
            l.id AS conflicting_listing_id,
            l.status AS conflicting_status,
            l.published_external_id,
            l.title AS conflicting_title
          FROM profitable_candidates pc
          JOIN profitable_candidates conflict_pc
            ON lower(conflict_pc.supplier_key) = lower(pc.supplier_key)
           AND conflict_pc.supplier_product_id = pc.supplier_product_id
          JOIN listings l
            ON l.candidate_id = conflict_pc.id
           AND lower(l.marketplace_key) = 'ebay'
          WHERE pc.id = ANY($1::uuid[])
            AND l.status IN ('ACTIVE', 'PUBLISH_IN_PROGRESS', 'READY_TO_PUBLISH', 'PREVIEW')
          ORDER BY pc.id, l.updated_at DESC NULLS LAST, l.created_at DESC NULLS LAST
        `,
        [candidateIds]
      );
      duplicateConflicts = duplicateResult.rows;
    }

    console.log(
      JSON.stringify(
        {
          counts: counts.rows[0] ?? null,
          activeListings: activeListings.rows,
          candidates: candidateRows,
          duplicateConflicts,
        },
        null,
        2
      )
    );
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error("report_autonomous_pipeline_state failed", error);
  process.exit(1);
});
