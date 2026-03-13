import "dotenv/config";
import { db } from "@/lib/db";
import { runInventoryRiskMonitor } from "@/lib/risk/inventoryRiskMonitor";
import { sql } from "drizzle-orm";

type Scenario = "LOW" | "MEDIUM" | "HIGH";

function assertListingIds(input: string[]): string[] {
  const ids = input.map((v) => v.trim()).filter(Boolean);
  if (ids.length < 3) {
    throw new Error(
      "Usage: pnpm exec tsx scripts/validate_inventory_risk_scenarios.ts <lowListingId> <mediumListingId> <highListingId>"
    );
  }
  return ids.slice(0, 3);
}

async function getListingSnapshot(listingId: string) {
  const result = await db.execute<{
    listingId: string;
    candidateId: string;
    listingStatus: string;
    decisionStatus: string;
    listingEligible: boolean;
    supplierKey: string;
    supplierProductId: string;
    baseSnapshotId: string;
    basePrice: string | null;
    latestPrice: string | null;
    latestAvailability: string | null;
  }>(sql`
    SELECT
      l.id AS "listingId",
      l.candidate_id AS "candidateId",
      l.status AS "listingStatus",
      pc.decision_status AS "decisionStatus",
      pc.listing_eligible AS "listingEligible",
      pc.supplier_key AS "supplierKey",
      pc.supplier_product_id AS "supplierProductId",
      pc.supplier_snapshot_id AS "baseSnapshotId",
      base_pr.price_min::text AS "basePrice",
      latest_pr.price_min::text AS "latestPrice",
      latest_pr.availability_status AS "latestAvailability"
    FROM listings l
    INNER JOIN profitable_candidates pc ON pc.id = l.candidate_id
    LEFT JOIN products_raw base_pr ON base_pr.id = pc.supplier_snapshot_id
    LEFT JOIN LATERAL (
      SELECT pr.price_min, pr.availability_status
      FROM products_raw pr
      WHERE pr.supplier_key = pc.supplier_key
        AND pr.supplier_product_id = pc.supplier_product_id
      ORDER BY pr.snapshot_ts DESC, pr.id DESC
      LIMIT 1
    ) latest_pr ON TRUE
    WHERE l.id = ${listingId}
      AND l.marketplace_key = 'ebay'
  `);

  const row = result.rows?.[0];
  if (!row) throw new Error(`Listing not found or not eBay: ${listingId}`);
  return row;
}

async function insertScenarioSnapshot(row: Awaited<ReturnType<typeof getListingSnapshot>>, scenario: Scenario) {
  const latestPrice = Number(row.latestPrice ?? row.basePrice ?? "0");
  const mediumPrice = Number.isFinite(latestPrice) && latestPrice > 0 ? (latestPrice * 1.2).toFixed(2) : null;

  const payload =
    scenario === "HIGH"
      ? { availability: "OUT_OF_STOCK", scenario }
      : { availability: "IN_STOCK", scenario };

  const priceForInsert = scenario === "MEDIUM" ? mediumPrice : row.latestPrice ?? row.basePrice;
  const availability = scenario === "HIGH" ? "OUT_OF_STOCK" : "IN_STOCK";
  const snapshotTsExpr =
    scenario === "LOW" ? sql`NOW() - INTERVAL '80 hours'` : sql`NOW()`;

  await db.execute(sql`
    INSERT INTO products_raw (
      supplier_key,
      supplier_product_id,
      source_url,
      title,
      currency,
      price_min,
      price_max,
      availability_status,
      shipping_estimates,
      raw_payload,
      snapshot_ts
    ) VALUES (
      ${row.supplierKey},
      ${row.supplierProductId},
      NULL,
      ${`inventory-risk-scenario-${scenario}`},
      'USD',
      ${priceForInsert},
      ${priceForInsert},
      ${availability},
      ${JSON.stringify([{ shipFromCountry: "US", service: "Standard" }])}::jsonb,
      ${JSON.stringify(payload)}::jsonb,
      ${snapshotTsExpr}
    )
  `);
}

async function main() {
  const listingIds = assertListingIds(process.argv.slice(2));
  const scenarioByListing: Record<string, Scenario> = {
    [listingIds[0]]: "LOW",
    [listingIds[1]]: "MEDIUM",
    [listingIds[2]]: "HIGH",
  };

  const before = [] as unknown[];
  for (const listingId of listingIds) {
    const row = await getListingSnapshot(listingId);
    before.push({ scenario: scenarioByListing[listingId], ...row });
    await insertScenarioSnapshot(row, scenarioByListing[listingId]);
  }

  const result = await runInventoryRiskMonitor({
    marketplaceKey: "ebay",
    limit: listingIds.length,
    listingIds,
    actorId: "scripts/validate_inventory_risk_scenarios.ts",
  });

  const afterRows = await db.execute(sql`
    SELECT
      l.id,
      l.status,
      pc.decision_status,
      pc.listing_eligible,
      (l.response::jsonb)->'inventoryRisk'->>'action' AS risk_action,
      (l.response::jsonb)->'inventoryRisk'->>'severity' AS risk_severity
    FROM listings l
    INNER JOIN profitable_candidates pc ON pc.id = l.candidate_id
    WHERE l.id IN (${sql.join(listingIds.map((id) => sql`${id}`), sql`, `)})
    ORDER BY l.id
  `);

  const auditRows = await db.execute(sql`
    SELECT
      entity_id,
      event_type,
      event_ts,
      details
    FROM audit_log
    WHERE entity_type = 'LISTING'
      AND entity_id IN (${sql.join(listingIds.map((id) => sql`${id}`), sql`, `)})
      AND actor_id = 'scripts/validate_inventory_risk_scenarios.ts'
    ORDER BY event_ts DESC
    LIMIT 20
  `);

  console.log("\nBefore:");
  console.table(before);
  console.log("\nMonitor result:", result);
  console.log("\nAfter:");
  console.table(afterRows.rows ?? []);
  console.log("\nAudit rows:");
  console.table((auditRows.rows ?? []).map((r) => ({
    entity_id: r.entity_id,
    event_type: r.event_type,
    event_ts: r.event_ts,
  })));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
