import fs from "fs";
import pg from "pg";
import { assertMutationAllowed } from "./lib/mutationGuard.mjs";
import { loadRuntimeEnv } from "./lib/envState.mjs";

loadRuntimeEnv();

const { Client } = pg;

async function main() {
  assertMutationAllowed("mutate_execute_sql_file.mjs");

  const file = process.argv[2];
  if (!file) {
    throw new Error("Usage: node scripts/mutate_execute_sql_file.mjs <sql-file>");
  }

  if (!fs.existsSync(file)) {
    throw new Error(`SQL file not found: ${file}`);
  }

  const sql = fs.readFileSync(file, "utf8");

  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });

  await client.connect();
  await client.query(sql);
  await client.end();

  console.log(JSON.stringify({ ok: true, file }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
