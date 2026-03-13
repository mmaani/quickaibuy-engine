import "dotenv/config";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { getControlPanelData } from "@/lib/control/getControlPanelData";
import {
  getApprovedQueueItems,
  getListingsQueueDetail,
  type ListingsQueueFilters,
} from "@/lib/listings/getApprovedListingsQueueData";
import { markListingReadyToPublish } from "@/lib/listings/markListingReadyToPublish";
import { runInventoryRiskMonitor } from "@/lib/risk/inventoryRiskMonitor";

type Scenario = "LOW" | "MEDIUM" | "HIGH";

type FixtureDefinition = {
  scenario: Scenario;
  listingId: string;
  candidateId: string;
  supplierProductId: string;
  marketplaceListingId: string;
  baselineSupplierSnapshotId: string;
  marketplaceSnapshotId: string;
  idempotencyKey: string;
};

type BeforeAfterRow = {
  listingId: string;
  candidateId: string;
  listingStatus: string;
  decisionStatus: string;
  listingEligible: boolean;
  listingBlockReason: string | null;
  riskAction: string | null;
  riskSeverity: string | null;
  inventoryRisk: unknown;
  lastPublishError: string | null;
};

const FIXTURE_SUPPLIER_KEY = "inventory-risk-validation";
const FIXTURE_MARKETPLACE_KEY = "ebay";
const FIXTURE_ACTOR_PREFIX = "scripts/validate_inventory_risk_scenarios.ts";

const FIXTURES: FixtureDefinition[] = [
  {
    scenario: "LOW",
    listingId: "8ad97f86-bb2d-44ac-bf6e-fae68a6ce001",
    candidateId: "8ad97f86-bb2d-44ac-bf6e-fae68a6ce101",
    supplierProductId: "inventory-risk-low",
    marketplaceListingId: "inventory-risk-ebay-low",
    baselineSupplierSnapshotId: "8ad97f86-bb2d-44ac-bf6e-fae68a6ce201",
    marketplaceSnapshotId: "8ad97f86-bb2d-44ac-bf6e-fae68a6ce301",
    idempotencyKey: "inventory-risk-validation-low",
  },
  {
    scenario: "MEDIUM",
    listingId: "8ad97f86-bb2d-44ac-bf6e-fae68a6ce002",
    candidateId: "8ad97f86-bb2d-44ac-bf6e-fae68a6ce102",
    supplierProductId: "inventory-risk-medium",
    marketplaceListingId: "inventory-risk-ebay-medium",
    baselineSupplierSnapshotId: "8ad97f86-bb2d-44ac-bf6e-fae68a6ce202",
    marketplaceSnapshotId: "8ad97f86-bb2d-44ac-bf6e-fae68a6ce302",
    idempotencyKey: "inventory-risk-validation-medium",
  },
  {
    scenario: "HIGH",
    listingId: "8ad97f86-bb2d-44ac-bf6e-fae68a6ce003",
    candidateId: "8ad97f86-bb2d-44ac-bf6e-fae68a6ce103",
    supplierProductId: "inventory-risk-high",
    marketplaceListingId: "inventory-risk-ebay-high",
    baselineSupplierSnapshotId: "8ad97f86-bb2d-44ac-bf6e-fae68a6ce203",
    marketplaceSnapshotId: "8ad97f86-bb2d-44ac-bf6e-fae68a6ce303",
    idempotencyKey: "inventory-risk-validation-high",
  },
];

const EMPTY_FILTERS: ListingsQueueFilters = {
  supplier: "",
  marketplace: "",
  listingEligible: "",
  previewPrepared: "",
  listingStatus: "",
  riskFilter: "",
  minProfit: "",
  minMargin: "",
  minRoi: "",
  candidateId: "",
};

function assertListingIds(input: string[]): string[] {
  const ids = input.map((value) => value.trim()).filter(Boolean);
  if (ids.length === 0) {
    return [];
  }
  if (ids.length < 3) {
    throw new Error(
      "Usage: pnpm exec tsx scripts/validate_inventory_risk_scenarios.ts [<lowListingId> <mediumListingId> <highListingId>]"
    );
  }
  return ids.slice(0, 3);
}

function scenarioByListingIds(listingIds: string[]): Record<string, Scenario> {
  return {
    [listingIds[0]]: "LOW",
    [listingIds[1]]: "MEDIUM",
    [listingIds[2]]: "HIGH",
  };
}

async function seedFixtures(): Promise<string[]> {
  for (const fixture of FIXTURES) {
    await resetFixtureState(fixture);
  }
  return FIXTURES.map((fixture) => fixture.listingId);
}

async function resetFixtureState(fixture: FixtureDefinition) {
  await db.execute(sql`
    DELETE FROM audit_log
    WHERE entity_type = 'LISTING'
      AND entity_id = ${fixture.listingId}
      AND actor_id LIKE ${`${FIXTURE_ACTOR_PREFIX}%`}
  `);

  await db.execute(sql`
    DELETE FROM marketplace_prices
    WHERE marketplace_key = ${FIXTURE_MARKETPLACE_KEY}
      AND marketplace_listing_id = ${fixture.marketplaceListingId}
  `);

  await db.execute(sql`
    DELETE FROM products_raw
    WHERE supplier_key = ${FIXTURE_SUPPLIER_KEY}
      AND supplier_product_id = ${fixture.supplierProductId}
  `);

  const baselineSupplierPayload = {
    scenario: fixture.scenario,
    stage: "BASELINE",
    availability: "IN_STOCK",
  };

  const marketplacePayload = {
    fixture: "inventory-risk-validation",
    scenario: fixture.scenario,
    marketplaceListingId: fixture.marketplaceListingId,
  };

  await upsertById(
    sql`
      UPDATE profitable_candidates
      SET
        supplier_key = ${FIXTURE_SUPPLIER_KEY},
        supplier_product_id = ${fixture.supplierProductId},
        marketplace_key = ${FIXTURE_MARKETPLACE_KEY},
        marketplace_listing_id = ${fixture.marketplaceListingId},
        calc_ts = NOW(),
        supplier_snapshot_id = ${fixture.baselineSupplierSnapshotId},
        market_price_snapshot_id = ${fixture.marketplaceSnapshotId},
        estimated_fees = ${JSON.stringify({ marketplace: "ebay", total: 6.25 })}::jsonb,
        estimated_shipping = 4.50,
        estimated_cogs = 20.00,
        estimated_profit = 18.75,
        margin_pct = 22.50,
        roi_pct = 46.88,
        risk_flags = ARRAY['FIXTURE'],
        decision_status = 'APPROVED',
        reason = 'Inventory risk validation fixture',
        approved_ts = NOW(),
        approved_by = 'inventory-risk-validation',
        listing_eligible = TRUE,
        listing_eligible_ts = NOW(),
        listing_block_reason = NULL
      WHERE id = ${fixture.candidateId}
      RETURNING id
    `,
    sql`
      INSERT INTO profitable_candidates (
        id,
        supplier_key,
        supplier_product_id,
        marketplace_key,
        marketplace_listing_id,
        calc_ts,
        supplier_snapshot_id,
        market_price_snapshot_id,
        estimated_fees,
        estimated_shipping,
        estimated_cogs,
        estimated_profit,
        margin_pct,
        roi_pct,
        risk_flags,
        decision_status,
        reason,
        approved_ts,
        approved_by,
        listing_eligible,
        listing_eligible_ts,
        listing_block_reason
      ) VALUES (
        ${fixture.candidateId},
        ${FIXTURE_SUPPLIER_KEY},
        ${fixture.supplierProductId},
        ${FIXTURE_MARKETPLACE_KEY},
        ${fixture.marketplaceListingId},
        NOW(),
        ${fixture.baselineSupplierSnapshotId},
        ${fixture.marketplaceSnapshotId},
        ${JSON.stringify({ marketplace: "ebay", total: 6.25 })}::jsonb,
        4.50,
        20.00,
        18.75,
        22.50,
        46.88,
        ARRAY['FIXTURE'],
        'APPROVED',
        'Inventory risk validation fixture',
        NOW(),
        'inventory-risk-validation',
        TRUE,
        NOW(),
        NULL
      )
    `
  );

  await upsertById(
    sql`
      UPDATE listings
      SET
        candidate_id = ${fixture.candidateId},
        marketplace_key = ${FIXTURE_MARKETPLACE_KEY},
        status = 'ACTIVE',
        title = ${`Inventory Risk ${fixture.scenario} Fixture`},
        price = 49.99,
        quantity = 3,
        payload = ${JSON.stringify({
          shipFromCountry: "US",
          scenario: fixture.scenario,
          fixture: true,
        })}::jsonb,
        response = '{}'::jsonb,
        publish_marketplace = NULL,
        publish_started_ts = NULL,
        publish_finished_ts = NULL,
        published_external_id = NULL,
        publish_attempt_count = 0,
        last_publish_error = NULL,
        listing_date = CURRENT_DATE,
        idempotency_key = ${fixture.idempotencyKey},
        updated_at = NOW()
      WHERE id = ${fixture.listingId}
      RETURNING id
    `,
    sql`
      INSERT INTO listings (
        id,
        candidate_id,
        marketplace_key,
        status,
        title,
        price,
        quantity,
        payload,
        response,
        publish_marketplace,
        publish_started_ts,
        publish_finished_ts,
        published_external_id,
        publish_attempt_count,
        last_publish_error,
        listing_date,
        idempotency_key
      ) VALUES (
        ${fixture.listingId},
        ${fixture.candidateId},
        ${FIXTURE_MARKETPLACE_KEY},
        'ACTIVE',
        ${`Inventory Risk ${fixture.scenario} Fixture`},
        49.99,
        3,
        ${JSON.stringify({
          shipFromCountry: "US",
          scenario: fixture.scenario,
          fixture: true,
        })}::jsonb,
        '{}'::jsonb,
        NULL,
        NULL,
        NULL,
        NULL,
        0,
        NULL,
        CURRENT_DATE,
        ${fixture.idempotencyKey}
      )
    `
  );

  await db.execute(sql`
    INSERT INTO products_raw (
      id,
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
      ${fixture.baselineSupplierSnapshotId},
      ${FIXTURE_SUPPLIER_KEY},
      ${fixture.supplierProductId},
      ${`https://fixtures.local/${fixture.supplierProductId}`},
      ${`Inventory Risk ${fixture.scenario} Baseline`},
      'USD',
      24.99,
      24.99,
      'IN_STOCK',
      ${JSON.stringify([{ shipFromCountry: "US", service: "Standard" }])}::jsonb,
      ${JSON.stringify(baselineSupplierPayload)}::jsonb,
      NOW() - INTERVAL '96 hours'
    )
  `);

  await db.execute(sql`
    INSERT INTO marketplace_prices (
      id,
      marketplace_key,
      marketplace_listing_id,
      product_raw_id,
      supplier_key,
      supplier_product_id,
      trend_mode,
      matched_title,
      currency,
      price,
      shipping_price,
      availability_status,
      raw_payload,
      snapshot_ts
    ) VALUES (
      ${fixture.marketplaceSnapshotId},
      ${FIXTURE_MARKETPLACE_KEY},
      ${fixture.marketplaceListingId},
      ${fixture.baselineSupplierSnapshotId},
      ${FIXTURE_SUPPLIER_KEY},
      ${fixture.supplierProductId},
      FALSE,
      ${`Inventory Risk ${fixture.scenario} Baseline`},
      'USD',
      49.99,
      0,
      'IN_STOCK',
      ${JSON.stringify(marketplacePayload)}::jsonb,
      NOW() - INTERVAL '2 hours'
    )
  `);
}

async function upsertById(updateStatement: ReturnType<typeof sql>, insertStatement: ReturnType<typeof sql>) {
  const result = await db.execute<{ id: string }>(updateStatement);
  if ((result.rows?.length ?? 0) > 0) {
    return;
  }
  await db.execute(insertStatement);
}

async function getListingSnapshot(listingId: string) {
  const result = await db.execute<{
    listingId: string;
    candidateId: string;
    listingStatus: string;
    decisionStatus: string;
    listingEligible: boolean;
    listingBlockReason: string | null;
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
      pc.listing_block_reason AS "listingBlockReason",
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
  if (!row) {
    throw new Error(`Listing not found or not eBay: ${listingId}`);
  }
  return row;
}

async function insertScenarioSnapshot(
  row: Awaited<ReturnType<typeof getListingSnapshot>>,
  scenario: Scenario
) {
  const latestPrice = Number(row.latestPrice ?? row.basePrice ?? "0");
  const mediumPrice = Number.isFinite(latestPrice) && latestPrice > 0 ? (latestPrice * 1.2).toFixed(2) : null;

  const payload =
    scenario === "HIGH"
      ? { availability: "OUT_OF_STOCK", scenario }
      : { availability: "IN_STOCK", scenario };

  const priceForInsert = scenario === "MEDIUM" ? mediumPrice : row.latestPrice ?? row.basePrice;
  const availability = scenario === "HIGH" ? "OUT_OF_STOCK" : "IN_STOCK";
  const snapshotTsExpr = scenario === "LOW" ? sql`NOW() - INTERVAL '80 hours'` : sql`NOW()`;

  await db.execute(sql`
    INSERT INTO products_raw (
      id,
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
      ${randomUUID()},
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

async function getBeforeAfterRows(listingIds: string[]): Promise<BeforeAfterRow[]> {
  const result = await db.execute<BeforeAfterRow>(sql`
    SELECT
      l.id AS "listingId",
      l.candidate_id AS "candidateId",
      l.status AS "listingStatus",
      pc.decision_status AS "decisionStatus",
      pc.listing_eligible AS "listingEligible",
      pc.listing_block_reason AS "listingBlockReason",
      (l.response::jsonb)->'inventoryRisk'->>'action' AS "riskAction",
      (l.response::jsonb)->'inventoryRisk'->>'severity' AS "riskSeverity",
      (l.response::jsonb)->'inventoryRisk' AS "inventoryRisk",
      l.last_publish_error AS "lastPublishError"
    FROM listings l
    INNER JOIN profitable_candidates pc ON pc.id = l.candidate_id
    WHERE l.id IN (${sql.join(listingIds.map((id) => sql`${id}`), sql`, `)})
    ORDER BY l.id
  `);
  return result.rows ?? [];
}

async function getAuditRows(listingIds: string[], actorId: string) {
  const result = await db.execute<{
    entityId: string;
    eventType: string;
    eventTs: string | Date;
    details: unknown;
  }>(sql`
    SELECT
      entity_id AS "entityId",
      event_type AS "eventType",
      event_ts AS "eventTs",
      details
    FROM audit_log
    WHERE entity_type = 'LISTING'
      AND entity_id IN (${sql.join(listingIds.map((id) => sql`${id}`), sql`, `)})
      AND actor_id = ${actorId}
    ORDER BY event_ts ASC, event_type ASC
  `);
  return result.rows ?? [];
}

function mapByListing(rows: BeforeAfterRow[]) {
  return Object.fromEntries(rows.map((row) => [row.listingId, row]));
}

function iso(value: string | Date | null | undefined): string | null {
  if (!value) {
    return null;
  }
  return value instanceof Date ? value.toISOString() : String(value);
}

function queueFiltersForCandidate(candidateId: string): ListingsQueueFilters {
  return { ...EMPTY_FILTERS, candidateId };
}

async function buildAdminListingsVisibility(fixtures: FixtureDefinition[]) {
  const summaries = await Promise.all(
    fixtures.map(async (fixture) => {
      const items = await getApprovedQueueItems(queueFiltersForCandidate(fixture.candidateId));
      const detail = await getListingsQueueDetail(fixture.candidateId);
      const item = items[0] ?? null;

      return {
        scenario: fixture.scenario,
        candidateId: fixture.candidateId,
        listingId: fixture.listingId,
        visible: item != null,
        listRow:
          item == null
            ? null
            : {
                decisionStatus: item.decisionStatus,
                listingEligible: item.listingEligible,
                listingStatus: item.listingStatus,
                recoveryState: item.recoveryState,
                pausedByInventoryRisk: item.pausedByInventoryRisk,
                pauseReason: item.pauseReason,
              },
        detailAuditEvents:
          detail?.recentAuditEvents
            .filter((event) => event.entityId === fixture.listingId)
            .slice(0, 6)
            .map((event) => ({
              eventType: event.eventType,
              eventTs: event.eventTs,
            })) ?? [],
      };
    })
  );

  return summaries;
}

async function buildAdminControlVisibility() {
  try {
    const data = await getControlPanelData();
    return {
      available: true,
      inventoryRisk: data.inventoryRisk,
      listingThroughput: data.listingThroughput,
      recoveryStates: data.recoveryStates,
      listingLifecycle: {
        statusCounts: data.listingLifecycle.statusCounts,
        readyToPublishBacklog: data.listingLifecycle.readyToPublishBacklog,
      },
    };
  } catch (error) {
    return {
      available: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function buildPublishFlowProof(highFixture: FixtureDefinition) {
  const promotionAttempt = await markListingReadyToPublish({
    listingId: highFixture.listingId,
    actorType: "SYSTEM",
    actorId: `${FIXTURE_ACTOR_PREFIX}:publish-proof`,
  });

  const queueItems = await getApprovedQueueItems(queueFiltersForCandidate(highFixture.candidateId));
  const queueItem = queueItems[0] ?? null;

  return {
    promotionAttempt,
    queueVisibility:
      queueItem == null
        ? null
        : {
            listingStatus: queueItem.listingStatus,
            recoveryState: queueItem.recoveryState,
            pausedByInventoryRisk: queueItem.pausedByInventoryRisk,
          },
    stillBlockedFromPublish:
      promotionAttempt.ok === false &&
      promotionAttempt.reason ===
        "listing is PAUSED and requires explicit operator resume to PREVIEW before promotion",
  };
}

async function main() {
  const explicitListingIds = assertListingIds(process.argv.slice(2));
  const listingIds = explicitListingIds.length > 0 ? explicitListingIds : await seedFixtures();
  const actorId = `${FIXTURE_ACTOR_PREFIX}:${new Date().toISOString()}`;
  const scenarioLookup = scenarioByListingIds(listingIds);

  const beforeRows = await getBeforeAfterRows(listingIds);

  for (const listingId of listingIds) {
    const row = await getListingSnapshot(listingId);
    await insertScenarioSnapshot(row, scenarioLookup[listingId]);
  }

  const monitorResult = await runInventoryRiskMonitor({
    marketplaceKey: "ebay",
    limit: listingIds.length,
    listingIds,
    actorId,
  });

  const afterRows = await getBeforeAfterRows(listingIds);
  const beforeByListing = mapByListing(beforeRows);
  const afterByListing = mapByListing(afterRows);
  const auditRows = await getAuditRows(listingIds, actorId);

  const fixturesByListing = new Map(FIXTURES.map((fixture) => [fixture.listingId, fixture]));
  const seededFixtures = FIXTURES.filter((fixture) => listingIds.includes(fixture.listingId));
  const lowFixture = seededFixtures.find((fixture) => fixture.scenario === "LOW") ?? null;
  const highFixture = seededFixtures.find((fixture) => fixture.scenario === "HIGH") ?? null;

  const lowPayload = lowFixture ? afterByListing[lowFixture.listingId]?.inventoryRisk ?? null : null;
  const highAfter = highFixture ? afterByListing[highFixture.listingId] ?? null : null;
  const publishFlowProof = highFixture ? await buildPublishFlowProof(highFixture) : null;
  const adminListingsVisibility =
    seededFixtures.length === listingIds.length ? await buildAdminListingsVisibility(seededFixtures) : null;
  const adminControlVisibility = seededFixtures.length === listingIds.length ? await buildAdminControlVisibility() : null;

  const report = {
    usedFixtureSeedData: explicitListingIds.length === 0,
    listingIdsUsed: listingIds.map((listingId) => ({
      scenario: scenarioLookup[listingId],
      listingId,
      candidateId: afterByListing[listingId]?.candidateId ?? beforeByListing[listingId]?.candidateId ?? null,
      fixture: fixturesByListing.get(listingId) ?? null,
    })),
    monitorResult,
    beforeAfterListingStatus: listingIds.map((listingId) => ({
      scenario: scenarioLookup[listingId],
      listingId,
      before: beforeByListing[listingId]?.listingStatus ?? null,
      after: afterByListing[listingId]?.listingStatus ?? null,
    })),
    beforeAfterCandidateFields: listingIds.map((listingId) => ({
      scenario: scenarioLookup[listingId],
      listingId,
      candidateId: afterByListing[listingId]?.candidateId ?? beforeByListing[listingId]?.candidateId ?? null,
      before: {
        decisionStatus: beforeByListing[listingId]?.decisionStatus ?? null,
        listingEligible: beforeByListing[listingId]?.listingEligible ?? null,
        listingBlockReason: beforeByListing[listingId]?.listingBlockReason ?? null,
      },
      after: {
        decisionStatus: afterByListing[listingId]?.decisionStatus ?? null,
        listingEligible: afterByListing[listingId]?.listingEligible ?? null,
        listingBlockReason: afterByListing[listingId]?.listingBlockReason ?? null,
      },
    })),
    lowRiskFlagPayloadWritten: lowPayload,
    highAutoPauseResult:
      highAfter == null
        ? null
        : {
            listingId: highAfter.listingId,
            status: highAfter.listingStatus,
            riskAction: highAfter.riskAction,
            riskSeverity: highAfter.riskSeverity,
            lastPublishError: highAfter.lastPublishError,
            inventoryRisk: highAfter.inventoryRisk,
          },
    auditRowsByListing: listingIds.map((listingId) => ({
      scenario: scenarioLookup[listingId],
      listingId,
      rows: auditRows
        .filter((row) => row.entityId === listingId)
        .map((row) => ({
          eventType: row.eventType,
          eventTs: iso(row.eventTs),
          details: row.details,
        })),
    })),
    highPausedListingPublishFlowProof: publishFlowProof,
    adminControlVisibility,
    adminListingsVisibility,
  };

  console.log(JSON.stringify(report, null, 2));
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
