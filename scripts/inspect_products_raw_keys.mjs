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

  const queries = [
    {
      title: "products_raw columns",
      sql: `
        SELECT column_name, data_type
        FROM information_schema.columns
        WHERE table_name = 'products_raw'
        ORDER BY ordinal_position
      `,
    },
    {
      title: "sample products_raw rows",
      sql: `
        SELECT *
        FROM products_raw
        LIMIT 10
      `,
    },
    {
      title: "distinct supplier/product keys",
      sql: `
        SELECT supplier_key, supplier_product_id, COUNT(*)::int AS count
        FROM products_raw
        GROUP BY supplier_key, supplier_product_id
        ORDER BY count DESC, supplier_key, supplier_product_id
        LIMIT 20
      `,
    },
    {
      title: "matches distinct supplier/product keys",
      sql: `
        SELECT supplier_key, supplier_product_id, COUNT(*)::int AS count
        FROM matches
        GROUP BY supplier_key, supplier_product_id
        ORDER BY count DESC, supplier_key, supplier_product_id
        LIMIT 20
      `,
    }
  ];

  for (const q of queries) {
    console.log(`\n=== ${q.title} ===`);
    const res = await client.query(q.sql);
    console.table(res.rows);
  }

  await client.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
