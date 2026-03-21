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

  const safety = await validateProfitSafety({
    candidateId,
    mode: "publish",
  });

  const listingEligible = safety.allow;
  const decisionStatus = listingEligible ? "APPROVED" : "MANUAL_REVIEW";
  const listingBlockReason = listingEligible
    ? null
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
