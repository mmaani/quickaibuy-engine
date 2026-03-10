import dotenv from "dotenv";
import pg from "pg";

dotenv.config({ path: ".env.local" });
dotenv.config();

const { Client } = pg;

function usage() {
  console.error("Usage: node scripts/inspect_failed_listing_payload.ts <listing_id>");
  process.exit(1);
}

async function main() {
  const listingId = String(process.argv[2] ?? "").trim();
  if (!listingId) usage();

  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });

  await client.connect();

  const res = await client.query(
    `
      SELECT
        id,
        candidate_id,
        marketplace_key,
        status,
        title,
        price,
        quantity,
        payload,
        response,
        last_publish_error,
        published_external_id,
        publish_attempt_count,
        publish_started_ts,
        publish_finished_ts,
        updated_at
      FROM listings
      WHERE id = $1
      LIMIT 1
    `,
    [listingId]
  );

  if (res.rows.length === 0) {
    console.error("Listing not found.");
    await client.end();
    process.exit(1);
  }

  const row = res.rows[0];
  const payload = row.payload ?? {};
  const response = row.response ?? {};

  const summary = {
    id: row.id,
    candidate_id: row.candidate_id,
    marketplace_key: row.marketplace_key,
    status: row.status,
    title: row.title,
    price: row.price,
    quantity: row.quantity,
    published_external_id: row.published_external_id,
    publish_attempt_count: row.publish_attempt_count,
    last_publish_error: row.last_publish_error,
    publish_started_ts: row.publish_started_ts,
    publish_finished_ts: row.publish_finished_ts,
    updated_at: row.updated_at,

    payload_title: payload.title ?? null,
    payload_subtitle: payload.subtitle ?? null,
    payload_description: payload.description ?? null,
    payload_condition: payload.condition ?? null,
    payload_brand: payload.brand ?? null,
    payload_mpn: payload.mpn ?? null,
    payload_category_id: payload.categoryId ?? null,
    payload_location_key: payload.merchantLocationKey ?? null,
    payload_ship_from_country:
      payload.shipFromCountry ??
      payload.ship_from_country ??
      payload.availability?.shipToLocationAvailability?.shipFromCountry ??
      null,
    payload_source_supplier_title: payload.source?.supplierTitle ?? null,
    payload_source_supplier_url: payload.source?.supplierSourceUrl ?? null,
    payload_matched_marketplace_listing_id: payload.matchedMarketplace?.marketplaceListingId ?? null,
  };

  console.log("FAILED LISTING SUMMARY");
  console.log(JSON.stringify(summary, null, 2));

  console.log("\nFULL PAYLOAD");
  console.log(JSON.stringify(payload, null, 2));

  console.log("\nFULL RESPONSE");
  console.log(JSON.stringify(response, null, 2));

  await client.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
