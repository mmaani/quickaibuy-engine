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

async function main() {
  loadEnvSafely();

  const client = new pg.Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });

  await client.connect();

  const res = await client.query(`
    SELECT
      m.id AS match_id,
      m.supplier_key,
      m.supplier_product_id,
      m.marketplace_listing_id,
      m.confidence,
      m.match_type,
      pr.price_min AS supplier_cost,
      mp.price AS market_price,
      COALESCE(mp.shipping_price, 0) AS shipping_price,
      ROUND((mp.price * 0.12)::numeric, 2) AS est_fees,
      ROUND((pr.price_min + 2)::numeric, 2) AS est_cogs,
      ROUND((mp.price - (mp.price * 0.12) - COALESCE(mp.shipping_price,0) - (pr.price_min + 2))::numeric, 2) AS est_profit,
      ROUND(
        CASE
          WHEN (pr.price_min + 2) > 0
          THEN (((mp.price - (mp.price * 0.12) - COALESCE(mp.shipping_price,0) - (pr.price_min + 2)) / (pr.price_min + 2)) * 100)::numeric
          ELSE 0
        END
      , 2) AS roi_pct
    FROM matches m
    JOIN products_raw pr
      ON pr.supplier_key = m.supplier_key
     AND pr.supplier_product_id = m.supplier_product_id
    JOIN marketplace_prices mp
      ON mp.marketplace_key = m.marketplace_key
     AND mp.marketplace_listing_id = m.marketplace_listing_id
    WHERE m.status = 'ACTIVE'
      AND m.match_type IN ('strong_title_similarity', 'title_similarity', 'keyword_fuzzy')
      AND COALESCE(m.confidence, 0) >= 0.50
    ORDER BY roi_pct DESC, m.last_seen_ts DESC
    LIMIT 30
  `);

  console.table(res.rows);
  await client.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
