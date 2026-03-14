import pg from "pg";

const { Client } = pg;

const RETRYABLE_CODES = new Set([
  "EAI_AGAIN",
  "ENOTFOUND",
  "ECONNRESET",
  "ECONNREFUSED",
  "ETIMEDOUT",
  "57P01",
  "53300",
]);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeDatabaseUrl(connectionString) {
  if (!connectionString) return connectionString;

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

function isRetryablePgError(error) {
  const code = error?.code ? String(error.code) : "";
  return RETRYABLE_CODES.has(code);
}

export async function withPgClient(task, options = {}) {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("Missing DATABASE_URL.");
  }

  const attempts = Number(options.attempts ?? process.env.PG_RETRY_ATTEMPTS ?? 4);
  const baseDelayMs = Number(options.baseDelayMs ?? process.env.PG_RETRY_BASE_DELAY_MS ?? 750);

  let lastError = null;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    const client = new Client({
      connectionString: normalizeDatabaseUrl(connectionString),
      ssl: { rejectUnauthorized: true },
    });

    try {
      await client.connect();
      return await task(client);
    } catch (error) {
      lastError = error;

      if (!isRetryablePgError(error) || attempt === attempts) {
        throw error;
      }

      const waitMs = baseDelayMs * attempt;
      console.warn("[pg-retry] transient database error; retrying", {
        attempt,
        attempts,
        waitMs,
        code: error?.code ?? null,
        message: error instanceof Error ? error.message : String(error),
      });
      await sleep(waitMs);
    } finally {
      try {
        await client.end();
      } catch {}
    }
  }

  throw lastError ?? new Error("Database operation failed.");
}
