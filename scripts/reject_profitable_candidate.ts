import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });
dotenv.config();

async function main() {
  const supplierKey = String(process.argv[2] || "").trim().toLowerCase();
  const supplierProductId = String(process.argv[3] || "").trim();
  const marketplaceKey = String(process.argv[4] || "").trim().toLowerCase();
  const marketplaceListingId = String(process.argv[5] || "").trim();

  if (!supplierKey || !supplierProductId || !marketplaceKey || !marketplaceListingId) {
    console.error(
      "Usage: pnpm exec tsx scripts/reject_profitable_candidate.ts <supplier_key> <supplier_product_id> <marketplace_key> <marketplace_listing_id>"
    );
    process.exit(1);
  }

  const { db } = await import("@/lib/db");
  const { profitableCandidates } = await import("@/lib/db/schema");
  const { and, eq } = await import("drizzle-orm");

  const result = await db
    .update(profitableCandidates)
    .set({
      decisionStatus: "REJECTED",
      reason: `rejected manually | ${supplierKey} | ${supplierProductId} | ${marketplaceKey} | ${marketplaceListingId}`,
    })
    .where(
      and(
        eq(profitableCandidates.supplierKey, supplierKey),
        eq(profitableCandidates.supplierProductId, supplierProductId),
        eq(profitableCandidates.marketplaceKey, marketplaceKey),
        eq(profitableCandidates.marketplaceListingId, marketplaceListingId),
      )
    )
    .returning();

  console.log(JSON.stringify(result, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
