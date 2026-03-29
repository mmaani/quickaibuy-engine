import pg from "pg";
import { getRequiredDatabaseUrl, loadRuntimeEnv } from "./runtimeEnv.mjs";

const { Client } = pg;

export function createRuntimePgClient(options = {}) {
  loadRuntimeEnv();
  return new Client({
    connectionString: getRequiredDatabaseUrl(),
    ssl: process.env.PGSSLMODE === "disable" ? false : { rejectUnauthorized: false },
    ...options,
  });
}

export async function withRuntimePgClient(task, options = {}) {
  const client = createRuntimePgClient(options);
  await client.connect();
  try {
    return await task(client);
  } finally {
    await client.end();
  }
}
