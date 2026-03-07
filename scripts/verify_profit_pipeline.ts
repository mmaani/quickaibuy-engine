import "dotenv/config";
import { sql } from "drizzle-orm";
import { db, pool } from "../src/lib/db";

async function main() {
  const summaries = await db.execute(sql`
    SELECT
      (SELECT count(*)::int FROM matches WHERE status = 'ACTIVE') AS active_matches,
      (SELECT count(*)::int FROM profitable_candidates) AS profitable_candidates_count,
      (SELECT count(*)::int FROM audit_log WHERE entity_type = 'PROFIT_ENGINE') AS profit_audit_count,
      (SELECT count(*)::int FROM audit_log WHERE entity_type = 'PROFITABLE_CANDIDATE') AS candidate_audit_count
  `);

  const latestCandidates = await db.execute(sql`
    SELECT
      supplier_key,
      supplier_product_id,
      marketplace_key,
      marketplace_listing_id,
      estimated_profit,
      margin_pct,
      roi_pct,
      decision_status,
      risk_flags,
      calc_ts
    FROM profitable_candidates
    ORDER BY calc_ts DESC
    LIMIT 10
  `);

  const latestAudit = await db.execute(sql`
    SELECT event_ts, actor_type, actor_id, entity_type, entity_id, event_type
    FROM audit_log
    WHERE entity_type IN ('PROFIT_ENGINE', 'PROFITABLE_CANDIDATE')
    ORDER BY event_ts DESC
    LIMIT 20
  `);

  console.log("profit_pipeline_summary", summaries.rows[0] ?? {});
  console.log("latest_profitable_candidates", latestCandidates.rows);
  console.log("latest_profit_audit", latestAudit.rows);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await pool.end();
  });
