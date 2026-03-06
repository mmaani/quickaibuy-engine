import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";

const connectionString =
  process.env.DATABASE_URL ||
  process.env.DATABASE_URL_DIRECT ||
  "";

if (!connectionString) {
  throw new Error("Missing DATABASE_URL or DATABASE_URL_DIRECT");
}

// Neon recommends SSL; postgres-js handles it via connection string params.
// Keep connections low on serverless.
const sql = postgres(connectionString, {
  max: 5,
  idle_timeout: 20,
  connect_timeout: 10,
});

export const db = drizzle(sql);
export { sql };
