import dotenv from "dotenv";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

const dotenvPath = process.env.DOTENV_CONFIG_PATH?.trim() || ".env.local";
dotenv.config({ path: dotenvPath });
dotenv.config();

const DATABASE_URL = process.env.DATABASE_URL_DIRECT || process.env.DATABASE_URL;
if (!DATABASE_URL) {
  throw new Error(
    `Missing DATABASE_URL or DATABASE_URL_DIRECT. Set it in ${dotenvPath} (for local dev) or your runtime environment.`
  );
}

function normalizeDatabaseUrl(connectionString: string): string {
  // pg-connection-string warns for libpq SSL modes (prefer/require/verify-ca).
  // We normalize to verify-full to preserve strong TLS behavior without warnings.
  try {
    const parsed = new URL(connectionString);
    const sslmode = parsed.searchParams.get("sslmode")?.toLowerCase() ?? null;
    if (sslmode === "prefer" || sslmode === "require" || sslmode === "verify-ca") {
      parsed.searchParams.set("sslmode", "verify-full");
      return parsed.toString();
    }
    return connectionString;
  } catch {
    return connectionString;
  }
}

export const pool = new Pool({
  connectionString: normalizeDatabaseUrl(DATABASE_URL),
  // Neon requires SSL; pooled URLs typically include it, but enforce if needed:
  ssl: { rejectUnauthorized: true },
});

export const db = drizzle(pool);
