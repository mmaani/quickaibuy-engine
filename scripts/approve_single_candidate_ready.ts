import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });
dotenv.config();

async function main() {
  const candidateId = String(process.argv[2] ?? "").trim();
  if (!candidateId) {
    console.error("Usage: pnpm exec tsx scripts/approve_single_candidate_ready.ts <candidate_id>");
    process.exit(1);
  }

  const { db } = await import("@/lib/db");
  const { sql } = await import("drizzle-orm");
  const { validateProfitSafety } = await import("@/lib/profit/priceGuard");
  const { PRODUCT_PIPELINE_MATCH_PREFERRED_MIN } = await import("@/lib/products/pipelinePolicy");

  const matchResult = await db.execute(sql`
    SELECT
      m.status,
      m.confidence::text AS confidence
    FROM profitable_candidates pc
    LEFT JOIN matches m
      ON m.supplier_key = pc.supplier_key
     AND m.supplier_product_id = pc.supplier_product_id
     AND m.marketplace_key = pc.marketplace_key
     AND m.marketplace_listing_id = pc.marketplace_listing_id
    WHERE pc.id = ${candidateId}
    LIMIT 1
  `);

  const matchRow = matchResult.rows[0] as { status?: string | null; confidence?: string | null } | undefined;
  const matchStatus = String(matchRow?.status ?? "").trim().toUpperCase();
  const matchConfidence =
    matchRow?.confidence == null || matchRow.confidence === "" ? null : Number(matchRow.confidence);
  const matchEligible =
    matchStatus === "ACTIVE" &&
    matchConfidence != null &&
    Number.isFinite(matchConfidence) &&
    matchConfidence >= PRODUCT_PIPELINE_MATCH_PREFERRED_MIN;

  const safety = await validateProfitSafety({
    candidateId,
    mode: "publish",
  });

  const listingEligible = safety.allow && matchEligible;
  const decisionStatus = listingEligible ? "APPROVED" : "MANUAL_REVIEW";
  const listingBlockReason = listingEligible
    ? null
    : !matchEligible
      ? `MATCH_CONFIDENCE_GATE_FAILED: status=${matchStatus || "UNKNOWN"} confidence=${matchConfidence ?? "null"} min=${PRODUCT_PIPELINE_MATCH_PREFERRED_MIN}`
      : `PRICE_GUARD_${safety.decision}: ${safety.reasonSummary} | codes: ${safety.reasons.join(", ")}`;
  const reason = listingEligible
    ? `approved single candidate | ${safety.reasonSummary}`
    : listingBlockReason;

  const updated = await db.execute(sql`
    UPDATE profitable_candidates
    SET
      decision_status = ${decisionStatus},
      reason = ${reason},
      approved_ts = CASE
        WHEN ${decisionStatus} = 'APPROVED' THEN COALESCE(approved_ts, NOW())
        ELSE approved_ts
      END,
      approved_by = CASE
        WHEN ${decisionStatus} = 'APPROVED' THEN COALESCE(approved_by, 'approve_single_candidate_ready')
        ELSE approved_by
      END,
      listing_eligible = ${listingEligible},
      listing_eligible_ts = CASE
        WHEN ${listingEligible} THEN COALESCE(listing_eligible_ts, NOW())
        ELSE NULL
      END,
      listing_block_reason = ${listingBlockReason}
    WHERE id = ${candidateId}
    RETURNING
      id::text AS candidate_id,
      decision_status,
      listing_eligible,
      listing_block_reason
  `);

  console.log(
    JSON.stringify(
      {
        ok: true,
        candidateId,
        matchStatus,
        matchConfidence,
        safety,
        updatedRows: updated.rows,
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
