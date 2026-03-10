import dotenv from "dotenv";
import pg from "pg";

dotenv.config({ path: ".env.local" });
dotenv.config();

const { Client } = pg;

function toNum(v: unknown): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function cleanTitle(input: string): string {
  return input
    .replace(/\s+/g, " ")
    .replace(/[^\p{L}\p{N}\s\-&,./()]/gu, "")
    .trim()
    .slice(0, 80);
}

function buildPreviewTitle(args: {
  marketplaceTitle: string | null;
  supplierTitle: string | null;
  supplierKey: string;
  supplierProductId: string;
}) {
  const base =
    args.marketplaceTitle?.trim() ||
    args.supplierTitle?.trim() ||
    `${args.supplierKey} ${args.supplierProductId}`;
  return cleanTitle(base);
}

function buildPreviewPrice(args: {
  marketplacePrice: number | null;
  supplierPrice: number | null;
}) {
  if (typeof args.marketplacePrice === "number" && Number.isFinite(args.marketplacePrice)) {
    return Number(args.marketplacePrice.toFixed(2));
  }
  if (typeof args.supplierPrice === "number" && Number.isFinite(args.supplierPrice)) {
    return Number((args.supplierPrice * 2).toFixed(2));
  }
  return 0;
}

async function main() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });

  await client.connect();

  const sourceRows = await client.query(`
    SELECT DISTINCT
      pc.id AS candidate_id,
      pc.supplier_key,
      pc.supplier_product_id,
      pc.marketplace_key,
      pc.marketplace_listing_id,
      pc.estimated_profit,
      pc.margin_pct,
      pc.roi_pct,
      pr.title AS supplier_title,
      pr.source_url AS supplier_source_url,
      pr.images AS supplier_images,
      pr.price_min AS supplier_price,
      mp.price AS marketplace_price,
      mp.matched_title AS marketplace_title
    FROM profitable_candidates pc
    JOIN products_raw pr
      ON pr.supplier_key = pc.supplier_key
     AND pr.supplier_product_id = pc.supplier_product_id
    JOIN marketplace_prices mp
      ON mp.marketplace_key = pc.marketplace_key
     AND mp.marketplace_listing_id = pc.marketplace_listing_id
    WHERE pc.decision_status = 'APPROVED'
      AND pc.listing_eligible = TRUE
      AND pc.marketplace_key = 'ebay'
    ORDER BY candidate_id
  `);

  console.log("approved eligible candidates:");
  console.table(sourceRows.rows.map((r) => ({
    candidate_id: r.candidate_id,
    supplier_key: r.supplier_key,
    supplier_product_id: r.supplier_product_id,
    marketplace_listing_id: r.marketplace_listing_id,
  })));

  let created = 0;
  let resetToPreview = 0;
  let skippedLivePath = 0;

  for (const row of sourceRows.rows) {
    const idempotencyKey = `listing-readiness:v1:ebay:${row.candidate_id}`;

    const existingRows = await client.query(
      `
        SELECT
          id,
          candidate_id,
          marketplace_key,
          status,
          idempotency_key,
          created_at,
          updated_at
        FROM listings
        WHERE candidate_id = $1
          AND marketplace_key = 'ebay'
        ORDER BY updated_at DESC NULLS LAST, created_at DESC NULLS LAST
      `,
      [row.candidate_id]
    );

    const livePath = existingRows.rows.find((r) =>
      ["READY_TO_PUBLISH", "PUBLISH_IN_PROGRESS", "ACTIVE"].includes(r.status)
    );

    if (livePath) {
      skippedLivePath++;
      console.log("skipping candidate with existing live-path row:");
      console.table([livePath]);
      continue;
    }

    const supplierImages = Array.isArray(row.supplier_images) ? row.supplier_images : [];
    const supplierImageUrl =
      supplierImages.find((v: unknown) => typeof v === "string") ?? null;

    const title = buildPreviewTitle({
      marketplaceTitle: row.marketplace_title,
      supplierTitle: row.supplier_title,
      supplierKey: row.supplier_key,
      supplierProductId: row.supplier_product_id,
    });

    const price = buildPreviewPrice({
      marketplacePrice: toNum(row.marketplace_price),
      supplierPrice: toNum(row.supplier_price),
    });

    if (!(price > 0) || !title) {
      console.log("skipping invalid preview source", {
        candidate_id: row.candidate_id,
        title,
        price,
      });
      continue;
    }

    const payload = {
      dryRun: true,
      marketplace: "ebay",
      listingType: "fixed_price",
      title,
      price,
      quantity: 1,
      condition: "NEW",
      source: {
        candidateId: row.candidate_id,
        supplierKey: row.supplier_key,
        supplierProductId: row.supplier_product_id,
        supplierTitle: row.supplier_title,
        supplierSourceUrl: row.supplier_source_url,
        supplierImageUrl,
      },
      matchedMarketplace: {
        marketplaceKey: row.marketplace_key,
        marketplaceListingId: row.marketplace_listing_id,
        marketplaceTitle: row.marketplace_title,
        marketplacePrice: toNum(row.marketplace_price),
      },
      economics: {
        estimatedProfit: toNum(row.estimated_profit),
        marginPct: toNum(row.margin_pct),
        roiPct: toNum(row.roi_pct),
      },
    };

    const response = {
      preview: true,
      previewVersion: "v1",
      liveApiCalled: false,
      titleLength: title.length,
      backfilled: true,
    };

    const existingByIdempotency = await client.query(
      `
        SELECT id, status
        FROM listings
        WHERE idempotency_key = $1
        LIMIT 1
      `,
      [idempotencyKey]
    );

    if (existingByIdempotency.rows.length > 0) {
      const existing = existingByIdempotency.rows[0];

      const updated = await client.query(
        `
          UPDATE listings
          SET
            status = 'PREVIEW',
            title = $2,
            price = $3,
            quantity = 1,
            payload = $4::jsonb,
            response = $5::jsonb,
            last_publish_error = NULL,
            publish_started_ts = NULL,
            publish_finished_ts = NULL,
            published_external_id = NULL,
            updated_at = NOW()
          WHERE id = $1
          RETURNING id, candidate_id, marketplace_key, status, updated_at
        `,
        [
          existing.id,
          title,
          String(price),
          JSON.stringify(payload),
          JSON.stringify(response),
        ]
      );

      resetToPreview++;
      console.log("reset existing row to PREVIEW:");
      console.table(updated.rows);
      continue;
    }

    const inserted = await client.query(
      `
        INSERT INTO listings (
          candidate_id,
          marketplace_key,
          status,
          title,
          price,
          quantity,
          payload,
          response,
          idempotency_key,
          created_at,
          updated_at
        )
        VALUES ($1, 'ebay', 'PREVIEW', $2, $3, 1, $4::jsonb, $5::jsonb, $6, NOW(), NOW())
        RETURNING id, candidate_id, marketplace_key, status, updated_at
      `,
      [
        row.candidate_id,
        title,
        String(price),
        JSON.stringify(payload),
        JSON.stringify(response),
        idempotencyKey,
      ]
    );

    created++;
    console.log("created preview:");
    console.table(inserted.rows);
  }

  console.log({ ok: true, created, resetToPreview, skippedLivePath });
  await client.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
