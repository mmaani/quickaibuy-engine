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

  const { rows } = await client.query(`
    DELETE FROM listings l
    WHERE NOT EXISTS (
      SELECT 1
      FROM profitable_candidates pc
      WHERE pc.id = l.candidate_id
    )
    RETURNING
      l.id,
      l.candidate_id,
      l.marketplace_key,
      l.title,
      l.status,
      l.created_at,
      l.updated_at
  `);

  console.log(JSON.stringify({
    ok: true,
    deleted: rows.length,
    rows,
  }, null, 2));

  await client.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
