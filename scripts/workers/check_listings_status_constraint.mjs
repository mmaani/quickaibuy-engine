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
    SELECT
      con.conname AS constraint_name,
      pg_get_constraintdef(con.oid) AS constraint_def
    FROM pg_constraint con
    INNER JOIN pg_class rel
      ON rel.oid = con.conrelid
    INNER JOIN pg_namespace nsp
      ON nsp.oid = con.connamespace
    WHERE rel.relname = 'listings'
      AND con.conname = 'listings_status_check'
  `);

  console.log(JSON.stringify(rows, null, 2));
  await client.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
