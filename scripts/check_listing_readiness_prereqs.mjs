import fs from "fs";
import dotenv from "dotenv";
import pg from "pg";

function loadEnvSafely() {
  dotenv.config({ path: ".env.local" });
  dotenv.config();

  // Fallback parser for broken .env.local lines
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

function logSection(title) {
  console.log(`\n=== ${title} ===`);
}

async function main() {
  loadEnvSafely();

  console.log("Env checks:");
  console.log({
    DATABASE_URL: process.env.DATABASE_URL ? "loaded" : "missing",
    MIN_ROI_PCT: process.env.MIN_ROI_PCT ?? "(default 15)",
    PROFIT_MIN_MATCH_CONFIDENCE:
      process.env.PROFIT_MIN_MATCH_CONFIDENCE ?? "(default 0.50)",
    MARKETPLACE_FEE_PCT: process.env.MARKETPLACE_FEE_PCT ?? "(default 12)",
    OTHER_COST_USD: process.env.OTHER_COST_USD ?? "(default 2)",
  });

  if (!process.env.DATABASE_URL) {
    console.error("\nERROR: DATABASE_URL is missing.");
    process.exit(1);
  }

  const { Client } = pg;
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });

  await client.connect();

  const queries = [
    {
      title: "Table counts",
      sql: `
        SELECT
          (SELECT COUNT(*)::int FROM trend_signals) AS trend_signals,
          (SELECT COUNT(*)::int FROM trend_candidates) AS trend_candidates,
          (SELECT COUNT(*)::int FROM products_raw) AS products_raw,
          (SELECT COUNT(*)::int FROM marketplace_prices) AS marketplace_prices,
          (SELECT COUNT(*)::int FROM matches) AS matches,
          (SELECT COUNT(*)::int FROM profitable_candidates) AS profitable_candidates
      `,
    },
    {
      title: "Match counts by status/type",
      sql: `
        SELECT status, match_type, COUNT(*)::int AS count
        FROM matches
        GROUP BY status, match_type
        ORDER BY count DESC, status, match_type
      `,
    },
    {
      title: "Matches eligible for profit engine first filter",
      sql: `
        SELECT
          id, supplier_key, supplier_product_id, marketplace_key,
          marketplace_listing_id, confidence, status, match_type, last_seen_ts
        FROM matches
        WHERE status = 'ACTIVE'
          AND match_type IN ('strong_title_similarity', 'title_similarity', 'keyword_fuzzy')
        ORDER BY last_seen_ts DESC
        LIMIT 20
      `,
    },
    {
      title: "Price coverage snapshot used by profit engine",
      sql: `
        SELECT
          pr.supplier_key,
          pr.supplier_product_id,
          pr.price_min,
          mp.marketplace_key,
          mp.marketplace_listing_id,
          mp.price,
          mp.shipping_price
        FROM matches m
        JOIN products_raw pr
          ON pr.supplier_key = m.supplier_key
         AND pr.supplier_product_id = m.supplier_product_id
        JOIN marketplace_prices mp
          ON mp.marketplace_key = m.marketplace_key
         AND mp.marketplace_listing_id = m.marketplace_listing_id
        WHERE m.status = 'ACTIVE'
          AND m.match_type IN ('strong_title_similarity', 'title_similarity', 'keyword_fuzzy')
        ORDER BY m.last_seen_ts DESC
        LIMIT 20
      `,
    },
    {
      title: "Profitability simulation for top eligible rows",
      sql: `
        WITH cfg AS (
          SELECT
            COALESCE(NULLIF(current_setting('app.min_roi_pct', true), '')::numeric, ${Number(process.env.MIN_ROI_PCT || "15")}) AS min_roi_pct,
            COALESCE(NULLIF(current_setting('app.min_match_confidence', true), '')::numeric, ${Number(process.env.PROFIT_MIN_MATCH_CONFIDENCE || "0.50")}) AS min_match_confidence,
            COALESCE(NULLIF(current_setting('app.marketplace_fee_pct', true), '')::numeric, ${Number(process.env.MARKETPLACE_FEE_PCT || "12")}) AS fee_pct,
            COALESCE(NULLIF(current_setting('app.other_cost_usd', true), '')::numeric, ${Number(process.env.OTHER_COST_USD || "2")}) AS other_cost_usd
        )
        SELECT
          m.id AS match_id,
          m.supplier_key,
          m.supplier_product_id,
          m.marketplace_key,
          m.marketplace_listing_id,
          m.confidence,
          pr.price_min AS supplier_cost,
          mp.price AS market_price,
          COALESCE(mp.shipping_price, 0) AS shipping_price,
          ROUND((mp.price * cfg.fee_pct / 100.0)::numeric, 2) AS est_fees,
          ROUND((pr.price_min + cfg.other_cost_usd)::numeric, 2) AS est_cogs,
          ROUND((mp.price - (mp.price * cfg.fee_pct / 100.0) - COALESCE(mp.shipping_price,0) - (pr.price_min + cfg.other_cost_usd))::numeric, 2) AS est_profit,
          ROUND((
            CASE WHEN mp.price > 0
              THEN ((mp.price - (mp.price * cfg.fee_pct / 100.0) - COALESCE(mp.shipping_price,0) - (pr.price_min + cfg.other_cost_usd)) / mp.price) * 100
              ELSE 0 END
          )::numeric, 2) AS margin_pct,
          ROUND((
            CASE WHEN (pr.price_min + cfg.other_cost_usd) > 0
              THEN ((mp.price - (mp.price * cfg.fee_pct / 100.0) - COALESCE(mp.shipping_price,0) - (pr.price_min + cfg.other_cost_usd)) / (pr.price_min + cfg.other_cost_usd)) * 100
              ELSE 0 END
          )::numeric, 2) AS roi_pct,
          CASE
            WHEN m.confidence < cfg.min_match_confidence THEN 'SKIP_LOW_CONFIDENCE'
            WHEN pr.price_min IS NULL OR mp.price IS NULL THEN 'SKIP_MISSING_PRICE'
            WHEN (
              CASE WHEN (pr.price_min + cfg.other_cost_usd) > 0
                THEN ((mp.price - (mp.price * cfg.fee_pct / 100.0) - COALESCE(mp.shipping_price,0) - (pr.price_min + cfg.other_cost_usd)) / (pr.price_min + cfg.other_cost_usd)) * 100
                ELSE 0 END
            ) < cfg.min_roi_pct THEN 'SKIP_LOW_ROI'
            ELSE 'WOULD_INSERT_PENDING'
          END AS profit_engine_result
        FROM matches m
        JOIN products_raw pr
          ON pr.supplier_key = m.supplier_key
         AND pr.supplier_product_id = m.supplier_product_id
        JOIN marketplace_prices mp
          ON mp.marketplace_key = m.marketplace_key
         AND mp.marketplace_listing_id = m.marketplace_listing_id
        CROSS JOIN cfg
        WHERE m.status = 'ACTIVE'
          AND m.match_type IN ('strong_title_similarity', 'title_similarity', 'keyword_fuzzy')
        ORDER BY m.last_seen_ts DESC
        LIMIT 20
      `,
    },
    {
      title: "Would insert count into profitable_candidates",
      sql: `
        WITH cfg AS (
          SELECT
            ${Number(process.env.MIN_ROI_PCT || "15")}::numeric AS min_roi_pct,
            ${Number(process.env.PROFIT_MIN_MATCH_CONFIDENCE || "0.50")}::numeric AS min_match_confidence,
            ${Number(process.env.MARKETPLACE_FEE_PCT || "12")}::numeric AS fee_pct,
            ${Number(process.env.OTHER_COST_USD || "2")}::numeric AS other_cost_usd
        )
        SELECT COUNT(*)::int AS would_insert
        FROM matches m
        JOIN products_raw pr
          ON pr.supplier_key = m.supplier_key
         AND pr.supplier_product_id = m.supplier_product_id
        JOIN marketplace_prices mp
          ON mp.marketplace_key = m.marketplace_key
         AND mp.marketplace_listing_id = m.marketplace_listing_id
        CROSS JOIN cfg
        WHERE m.status = 'ACTIVE'
          AND m.match_type IN ('strong_title_similarity', 'title_similarity', 'keyword_fuzzy')
          AND COALESCE(m.confidence, 0) >= cfg.min_match_confidence
          AND pr.price_min IS NOT NULL
          AND mp.price IS NOT NULL
          AND (
            CASE WHEN (pr.price_min + cfg.other_cost_usd) > 0
              THEN ((mp.price - (mp.price * cfg.fee_pct / 100.0) - COALESCE(mp.shipping_price,0) - (pr.price_min + cfg.other_cost_usd)) / (pr.price_min + cfg.other_cost_usd)) * 100
              ELSE 0 END
          ) >= cfg.min_roi_pct
      `,
    },
    {
      title: "Current profitable_candidates",
      sql: `
        SELECT
          id, supplier_key, supplier_product_id, marketplace_key, marketplace_listing_id,
          estimated_profit, margin_pct, roi_pct, decision_status, reason, calc_ts
        FROM profitable_candidates
        ORDER BY calc_ts DESC
        LIMIT 20
      `,
    },
    {
      title: "Current decision_status counts",
      sql: `
        SELECT decision_status, COUNT(*)::int AS count
        FROM profitable_candidates
        GROUP BY decision_status
        ORDER BY count DESC, decision_status
      `,
    },
    {
      title: "Recent audit events",
      sql: `
        SELECT event_ts, actor_type, actor_id, entity_type, entity_id, event_type
        FROM audit_log
        ORDER BY event_ts DESC
        LIMIT 20
      `,
    },
  ];

  for (const q of queries) {
    logSection(q.title);
    try {
      const res = await client.query(q.sql);
      console.table(res.rows);
    } catch (err) {
      console.error(`Query failed in section: ${q.title}`);
      console.error(err.message);
    }
  }

  await client.end();
  console.log("\nDone.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
