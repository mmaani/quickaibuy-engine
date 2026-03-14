import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";
import { Pool } from "pg";

dotenv.config({ path: ".env.local" });
dotenv.config();

type JournalEntry = {
  tag: string;
  when: number;
};

function getConnectionString(): string {
  const connectionString = process.env.DATABASE_URL_DIRECT || process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("Missing DATABASE_URL_DIRECT or DATABASE_URL");
  }
  return connectionString;
}

function getJournalEntries(repoRoot: string): Array<{ tag: string; createdAt: number; hash: string }> {
  const journalPath = path.join(repoRoot, "drizzle", "meta", "_journal.json");
  const journal = JSON.parse(fs.readFileSync(journalPath, "utf8")) as {
    entries?: JournalEntry[];
  };

  return (journal.entries ?? []).map((entry) => {
    const sqlPath = path.join(repoRoot, "drizzle", `${entry.tag}.sql`);
    const sql = fs.readFileSync(sqlPath, "utf8");
    return {
      tag: entry.tag,
      createdAt: entry.when,
      hash: crypto.createHash("sha256").update(sql).digest("hex"),
    };
  });
}

async function main() {
  const repoRoot = process.cwd();
  const entries = getJournalEntries(repoRoot);

  const pool = new Pool({
    connectionString: getConnectionString(),
    ssl: { rejectUnauthorized: false },
  });

  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS public.__drizzle_migrations (
        id SERIAL PRIMARY KEY,
        hash text NOT NULL,
        created_at numeric
      )
    `);

    const existing = await pool.query<{ hash: string; created_at: string }>(
      `SELECT hash, created_at::text AS created_at FROM public.__drizzle_migrations`
    );

    const existingKeys = new Set(existing.rows.map((row) => `${row.hash}:${row.created_at}`));
    const inserted: Array<{ tag: string; createdAt: number }> = [];

    for (const entry of entries) {
      const key = `${entry.hash}:${entry.createdAt}`;
      if (existingKeys.has(key)) {
        continue;
      }

      await pool.query(
        `INSERT INTO public.__drizzle_migrations (hash, created_at) VALUES ($1, $2)`,
        [entry.hash, entry.createdAt]
      );
      inserted.push({ tag: entry.tag, createdAt: entry.createdAt });
    }

    const finalCount = await pool.query<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM public.__drizzle_migrations`
    );

    console.log(
      JSON.stringify(
        {
          status: "OK",
          inserted,
          expectedEntries: entries.length,
          finalLedgerCount: Number(finalCount.rows[0]?.n ?? 0),
        },
        null,
        2
      )
    );
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(
    JSON.stringify(
      {
        status: "FAILED",
        reason: message,
      },
      null,
      2
    )
  );
  process.exit(1);
});
