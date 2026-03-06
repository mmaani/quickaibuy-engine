import "dotenv/config";
import type { Config } from "drizzle-kit";

const connectionString =
  process.env.DATABASE_URL_DIRECT ||
  process.env.DATABASE_URL ||
  "";

if (!connectionString) {
  throw new Error(
    "Missing DATABASE_URL_DIRECT (preferred) or DATABASE_URL for drizzle migrations."
  );
}

export default {
  schema: "./src/db/schema.ts",
  out: "./src/db/migrations",
  dialect: "postgresql",
  dbCredentials: { connectionString },
  verbose: true,
  strict: true,
} satisfies Config;
