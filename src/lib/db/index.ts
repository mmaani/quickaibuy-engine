import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) throw new Error("Missing DATABASE_URL");

export const pool = new Pool({
  connectionString: DATABASE_URL,
  // Neon requires SSL; pooled URLs typically include it, but enforce if needed:
  ssl: { rejectUnauthorized: true },
});

export const db = drizzle(pool);
