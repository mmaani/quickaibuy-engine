import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import type { PoolConfig } from "pg";
import { loadRuntimeEnv } from "@/lib/runtimeEnv";

const dotenvPath = loadRuntimeEnv();

const DATABASE_URL = process.env.DATABASE_URL_DIRECT || process.env.DATABASE_URL;
if (!DATABASE_URL) {
  throw new Error(
    `Missing DATABASE_URL or DATABASE_URL_DIRECT. Set it in ${dotenvPath} (for local dev) or your runtime environment.`
  );
}

function buildPoolConfig(connectionString: string): PoolConfig {
  const parsed = new URL(connectionString);
  const database = parsed.pathname.replace(/^\/+/, "") || undefined;
  const port = parsed.port ? Number(parsed.port) : undefined;

  return {
    host: parsed.hostname,
    port: Number.isFinite(port) ? port : undefined,
    user: parsed.username || undefined,
    password: parsed.password || undefined,
    database,
    ssl: { rejectUnauthorized: true },
  };
}

export const pool = new Pool(buildPoolConfig(DATABASE_URL));

const TRANSIENT_PG_ERROR_CODES = new Set([
  "EAI_AGAIN",
  "ENOTFOUND",
  "ECONNRESET",
  "ECONNREFUSED",
  "ETIMEDOUT",
  "ENETUNREACH",
  "57P01",
  "53300",
]);

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isTransientPgError(error: unknown): boolean {
  const code = error && typeof error === "object" && "code" in error ? String(error.code ?? "") : "";
  const message = error instanceof Error ? error.message : String(error ?? "");
  return (
    TRANSIENT_PG_ERROR_CODES.has(code) ||
    /\b(EAI_AGAIN|ENOTFOUND|ECONNRESET|ECONNREFUSED|ETIMEDOUT|ENETUNREACH)\b/i.test(message)
  );
}

const originalQuery = pool.query.bind(pool) as typeof pool.query;

async function queryWithRetry(...args: Parameters<typeof pool.query>): Promise<Awaited<ReturnType<typeof pool.query>>> {
  const attempts = Number(process.env.PG_RETRY_ATTEMPTS ?? 3);
  const baseDelayMs = Number(process.env.PG_RETRY_BASE_DELAY_MS ?? 500);
  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await originalQuery(...args);
    } catch (error) {
      lastError = error;
      if (!isTransientPgError(error) || attempt >= attempts) {
        throw error;
      }

      console.warn("[db] transient postgres query failure, retrying", {
        attempt,
        attempts,
        code: error && typeof error === "object" && "code" in error ? error.code ?? null : null,
        message: error instanceof Error ? error.message : String(error),
      });
      await sleep(baseDelayMs * attempt);
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError ?? "Database query failed"));
}

(pool as typeof pool & { query: typeof pool.query }).query = queryWithRetry as typeof pool.query;

export const db = drizzle(pool);
