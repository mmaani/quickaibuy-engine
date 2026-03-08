import dotenv from "dotenv";
import pg from "pg";

dotenv.config({ path: ".env.local" });
dotenv.config();

const { Client } = pg;

async function main() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });

  await client.connect();

  const sections = [
    {
      title: "[1] Counts by supplier",
      query: `
        SELECT
          supplier_key,
          COUNT(*)::int AS candidate_count
        FROM profitable_candidates
        GROUP BY supplier_key
        ORDER BY candidate_count DESC, supplier_key ASC
      `,
    },
    {
      title: "[2] Average economics",
      query: `
        SELECT
          ROUND(AVG(estimated_profit::numeric), 2) AS avg_profit,
          ROUND(AVG(margin_pct::numeric), 2) AS avg_margin_pct,
          ROUND(AVG(roi_pct::numeric), 2) AS avg_roi_pct
        FROM profitable_candidates
      `,
    },
    {
      title: "[3] Pending review queue",
      query: `
        SELECT
          supplier_key,
          supplier_product_id,
          marketplace_key,
          marketplace_listing_id,
          estimated_profit,
          margin_pct,
          roi_pct,
          decision_status,
          calc_ts
        FROM profitable_candidates
        ORDER BY calc_ts DESC
      `,
    },
  ];

  for (const section of sections) {
    console.log(`\n${section.title}`);
    const { rows } = await client.query(section.query);
    console.log(JSON.stringify(rows, null, 2));
  }

  await client.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
