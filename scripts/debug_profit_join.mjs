import fs from "fs";
import dotenv from "dotenv";
import pg from "pg";

function loadEnvSafely() {
  dotenv.config({ path: ".env.local" });
  dotenv.config();

  if (!process.env.DATABASE_URL && fs.existsSync(".env.local")) {
    const raw = fs.readFileSync(".env.local", "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const m = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
      if (!m) continue;
      const key = m[1];
      let val = m[2].trim();
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1);
      }
      if (!(key in process.env)) process.env[key] = val;
    }
  }
}

async function run(title, client, sql) {
  console.log(`\n=== ${title} ===`);
  try {
    const res = await client.query(sql);
    console.table(res.rows);
  } catch (err) {
    console.error(err.message);
  }
}

async function main() {
  loadEnvSafely();

  const client = new pg.Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });

  await client.connect();

  await run(
    "Top matches",
    client,
    `
    SELECT
      id,
      supplier_key,
      supplier_product_id,
      marketplace_key,
      marketplace_listing_id,
      confidence,
      status,
      match_type,
      last_seen_ts
    FROM matches
    ORDER BY last_seen_ts DESC
    LIMIT 20
    `
  );

  await run(
    "Top products_raw keys",
    client,
    `
    SELECT
      id,
      supplier_key,
      supplier_product_id,
      price_min,
      title
    FROM products_raw
    ORDER BY created_at DESC NULLS LAST, id DESC
    LIMIT 20
    `
  );

  await run(
    "Top marketplace_prices keys",
    client,
    `
    SELECT
      id,
      marketplace_key,
      marketplace_listing_id,
      product_raw_id,
      price,
      shipping_price,
      title
    FROM marketplace_prices
    ORDER BY last_seen_ts DESC NULLS LAST, id DESC
    LIMIT 20
    `
  );

  await run(
    "Match -> products_raw join coverage",
    client,
    `
    SELECT
      m.id AS match_id,
      m.supplier_key,
      m.supplier_product_id,
      pr.id AS matched_product_raw_id,
      pr.price_min
    FROM matches m
    LEFT JOIN products_raw pr
      ON pr.supplier_key = m.supplier_key
     AND pr.supplier_product_id = m.supplier_product_id
    WHERE m.status = 'ACTIVE'
      AND m.match_type IN ('strong_title_similarity', 'title_similarity', 'keyword_fuzzy')
    ORDER BY m.last_seen_ts DESC
    LIMIT 20
    `
  );

  await run(
    "Match -> marketplace_prices join coverage",
    client,
    `
    SELECT
      m.id AS match_id,
      m.marketplace_key,
      m.marketplace_listing_id,
      mp.id AS matched_marketplace_price_id,
      mp.price,
      mp.shipping_price
    FROM matches m
    LEFT JOIN marketplace_prices mp
      ON mp.marketplace_key = m.marketplace_key
     AND mp.marketplace_listing_id = m.marketplace_listing_id
    WHERE m.status = 'ACTIVE'
      AND m.match_type IN ('strong_title_similarity', 'title_similarity', 'keyword_fuzzy')
    ORDER BY m.last_seen_ts DESC
    LIMIT 20
    `
  );

  await run(
    "Profit-engine exact join coverage",
    client,
    `
    SELECT
      m.id AS match_id,
      m.supplier_key,
      m.supplier_product_id,
      m.marketplace_key,
      m.marketplace_listing_id,
      pr.id AS product_raw_id,
      pr.price_min,
      mp.id AS marketplace_price_id,
      mp.price,
      mp.shipping_price
    FROM matches m
    LEFT JOIN products_raw pr
      ON pr.supplier_key = m.supplier_key
     AND pr.supplier_product_id = m.supplier_product_id
    LEFT JOIN marketplace_prices mp
      ON mp.marketplace_key = m.marketplace_key
     AND mp.marketplace_listing_id = m.marketplace_listing_id
    WHERE m.status = 'ACTIVE'
      AND m.match_type IN ('strong_title_similarity', 'title_similarity', 'keyword_fuzzy')
    ORDER BY m.last_seen_ts DESC
    LIMIT 20
    `
  );

  await run(
    "Counts: product join / marketplace join / both join",
    client,
    `
    WITH base AS (
      SELECT
        m.id,
        pr.id AS product_raw_id,
        mp.id AS marketplace_price_id
      FROM matches m
      LEFT JOIN products_raw pr
        ON pr.supplier_key = m.supplier_key
       AND pr.supplier_product_id = m.supplier_product_id
      LEFT JOIN marketplace_prices mp
        ON mp.marketplace_key = m.marketplace_key
       AND mp.marketplace_listing_id = m.marketplace_listing_id
      WHERE m.status = 'ACTIVE'
        AND m.match_type IN ('strong_title_similarity', 'title_similarity', 'keyword_fuzzy')
    )
    SELECT
      COUNT(*)::int AS eligible_matches,
      COUNT(product_raw_id)::int AS joined_products_raw,
      COUNT(marketplace_price_id)::int AS joined_marketplace_prices,
      COUNT(*) FILTER (WHERE product_raw_id IS NOT NULL AND marketplace_price_id IS NOT NULL)::int AS joined_both
    FROM base
    `
  );

  await client.end();
  console.log("\nDone.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
