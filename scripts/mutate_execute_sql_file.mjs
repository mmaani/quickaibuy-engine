import dotenv from "dotenv";
import fs from "fs";
import pg from "pg";

dotenv.config({ path: ".env.local" });
dotenv.config();

const { Client } = pg;

function assertPreflight() {
  if (String(process.env.ALLOW_MUTATION_SCRIPTS ?? "false").toLowerCase() !== "true") {
    throw new Error(
      "Blocked: set ALLOW_MUTATION_SCRIPTS=true to run mutate_execute_sql_file.mjs"
    );
  }

  const env = String(process.env.APP_ENV ?? process.env.VERCEL_ENV ?? "development").toLowerCase();
  const isProd = env === "production" || env === "prod";
  if (isProd && String(process.env.ALLOW_PROD_MUTATIONS ?? "false").toLowerCase() !== "true") {
    throw new Error(
      "Blocked in production: set ALLOW_PROD_MUTATIONS=true to acknowledge production SQL mutation risk"
    );
  }
}

async function main() {
  assertPreflight();

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
