import { readFile } from "node:fs/promises";
import pg from "pg";
import { getDotenvPath, getRequiredDatabaseUrl, loadRuntimeEnv } from "./lib/runtimeEnv.mjs";
import { assertMutationAllowed } from "./lib/mutationGuard.mjs";

const { Client } = pg;

async function main() {
  loadRuntimeEnv();
  assertMutationAllowed("apply_sql_file.ts");
  const filePath = String(process.argv[2] ?? "").trim();
  if (!filePath) {
    throw new Error("Usage: node --import tsx scripts/apply_sql_file.ts <sql_file_path>");
  }

  const sqlText = await readFile(filePath, "utf8");
  if (!sqlText.trim()) {
    throw new Error(`SQL file is empty: ${filePath}`);
  }

  const client = new Client({
    connectionString: getRequiredDatabaseUrl(),
    ssl: { rejectUnauthorized: false },
  });

  await client.connect();
  try {
    await client.query(sqlText);
    console.log(
      JSON.stringify(
        {
          ok: true,
          filePath,
          dotenvPath: getDotenvPath(),
        },
        null,
        2
      )
    );
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
