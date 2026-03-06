import "dotenv/config";
import pg from "pg";

const { Client } = pg;

async function run() {
  const sql = process.argv.slice(2).join(" ").trim();
  if (!sql) {
    console.error("Usage: node --import dotenv/config scripts/db_inspect.mjs \"select ...\"");
    process.exit(1);
  }

  const client = new Client({
    connectionString: process.env.DATABASE_URL,
  });

  await client.connect();

  try {
    const res = await client.query(sql);
    console.log("ROW COUNT:", res.rowCount ?? 0);
    console.dir(res.rows, { depth: null, colors: true, maxArrayLength: 200 });
  } finally {
    await client.end();
  }
}

run().catch((err) => {
  console.error("DB INSPECT ERROR");
  console.error(err);
  process.exit(1);
});
