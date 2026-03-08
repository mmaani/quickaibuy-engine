import dotenv from "dotenv";
import pg from "pg";

dotenv.config({ path: ".env.local" });
dotenv.config();

const { Client } = pg;

async function scalar(client, label, query) {
  const { rows } = await client.query(query);
  return { label, value: rows[0]?.count ?? rows[0]?.value ?? null };
}

async function main() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });

  await client.connect();

  const stats = [];
  stats.push(await scalar(client, "products_raw", `select count(*)::int as count from products_raw`));
  stats.push(await scalar(client, "marketplace_prices", `select count(*)::int as count from marketplace_prices`));
  stats.push(await scalar(client, "matches", `select count(*)::int as count from matches`));
  stats.push(await scalar(client, "profitable_candidates", `select count(*)::int as count from profitable_candidates`));
  stats.push(await scalar(client, "active_matches", `select count(*)::int as count from matches where status = 'ACTIVE'`));

  console.log(JSON.stringify(stats, null, 2));
  await client.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
