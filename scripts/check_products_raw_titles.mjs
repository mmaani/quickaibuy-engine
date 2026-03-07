import "dotenv/config";
import pg from "pg";

const { Client } = pg;

async function main() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });

  await client.connect();

  const { rows } = await client.query(`
    SELECT
      id,
      supplier_key,
      supplier_product_id,
      title,
      snapshot_ts
    FROM products_raw
    WHERE COALESCE(title, '') <> ''
    ORDER BY snapshot_ts DESC
    LIMIT 20
  `);

  console.log(JSON.stringify(rows, null, 2));
  await client.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
