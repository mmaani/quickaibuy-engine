import dotenv from "dotenv";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import type { PoolConfig } from "pg";

const dotenvPath = process.env.DOTENV_CONFIG_PATH?.trim() || ".env.local";
dotenv.config({ path: dotenvPath });
dotenv.config();

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

export const db = drizzle(pool);
