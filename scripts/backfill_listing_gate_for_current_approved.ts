import pg from "pg";
import { PRODUCT_PIPELINE_MATCH_PREFERRED_MIN } from "@/lib/products/pipelinePolicy";
import { assertMutationAllowed } from "./lib/mutationGuard.mjs";
import { loadRuntimeEnv } from "./lib/runtimeEnv.mjs";
const { Client } = pg;

async function main() {
  loadRuntimeEnv();
  assertMutationAllowed("backfill_listing_gate_for_current_approved.ts");
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  const result = await client.query(`
    WITH match_state AS (
      SELECT
        pc.id,
        m.status AS match_status,
        m.confidence::numeric AS match_confidence
      FROM profitable_candidates pc
      LEFT JOIN matches m
        ON m.supplier_key = pc.supplier_key
       AND m.supplier_product_id = pc.supplier_product_id
       AND m.marketplace_key = pc.marketplace_key
       AND m.marketplace_listing_id = pc.marketplace_listing_id
      WHERE pc.decision_status = 'APPROVED'
        AND pc.marketplace_key = 'ebay'
    )
    UPDATE profitable_candidates pc
    SET
      approved_ts = COALESCE(pc.approved_ts, NOW()),
      approved_by = COALESCE(pc.approved_by, 'legacy-approval-backfill'),
      listing_eligible = CASE
        WHEN upper(coalesce(ms.match_status, '')) = 'ACTIVE'
         AND coalesce(ms.match_confidence, 0) >= ${PRODUCT_PIPELINE_MATCH_PREFERRED_MIN}
        THEN TRUE
        ELSE FALSE
      END,
      listing_eligible_ts = CASE
        WHEN upper(coalesce(ms.match_status, '')) = 'ACTIVE'
         AND coalesce(ms.match_confidence, 0) >= ${PRODUCT_PIPELINE_MATCH_PREFERRED_MIN}
        THEN COALESCE(pc.listing_eligible_ts, NOW())
        ELSE NULL
      END,
      listing_block_reason = CASE
        WHEN upper(coalesce(ms.match_status, '')) = 'ACTIVE'
         AND coalesce(ms.match_confidence, 0) >= ${PRODUCT_PIPELINE_MATCH_PREFERRED_MIN}
        THEN NULL
        ELSE 'MATCH_CONFIDENCE_GATE_FAILED: approved legacy candidate requires ACTIVE match >= ${PRODUCT_PIPELINE_MATCH_PREFERRED_MIN}'
      END
    FROM match_state ms
    WHERE pc.id = ms.id
    RETURNING
      pc.id,
      pc.supplier_key,
      pc.supplier_product_id,
      pc.marketplace_key,
      ms.match_status,
      ms.match_confidence,
      pc.listing_eligible
  `);

  console.log("Backfilled approved eBay candidates:");
  console.table(result.rows);

  await client.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
