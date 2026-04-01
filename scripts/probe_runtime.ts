import { getRuntimeDiagnostics } from "./lib/runtimeDiagnostics.mjs";
import { pool } from "../src/lib/db";
import { getRedis } from "../src/lib/redis";

type ProbeCheck = {
  check: string;
  status: "OK" | "WARN" | "FAILED";
  reason: string;
};

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out after ${ms}ms`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isTransientNetworkError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return /\b(EAI_AGAIN|ENOTFOUND|ECONNRESET|ECONNREFUSED|ETIMEDOUT|ENETUNREACH)\b/i.test(message);
}

async function withTransientRetry<T>(fn: () => Promise<T>, attempts = 3, baseDelayMs = 500): Promise<T> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (!isTransientNetworkError(error) || attempt >= attempts) {
        throw error;
      }
      await sleep(baseDelayMs * attempt);
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError ?? "Transient retry failed"));
}

async function main() {
  const checks: ProbeCheck[] = [];
  let dbStatus: "ok" | "warn" | "failed" = "failed";
  let redisStatus: "PONG" | "WARN" | "FAILED" = "FAILED";
  let hardFailure = false;

  try {
    const db = await withTransientRetry(() => pool.query("select 1 as ok"));
    dbStatus = db.rows[0]?.ok === 1 ? "ok" : "warn";
    checks.push({
      check: "postgres",
      status: db.rows[0]?.ok === 1 ? "OK" : "WARN",
      reason: db.rows[0]?.ok === 1 ? "Database query succeeded" : "Database query returned unexpected payload",
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    if (isTransientNetworkError(error)) {
      dbStatus = "warn";
      checks.push({
        check: "postgres",
        status: "WARN",
        reason,
      });
    } else {
      hardFailure = true;
      checks.push({
        check: "postgres",
        status: "FAILED",
        reason,
      });
    }
  }

  const redis = getRedis();

  try {
    const pong = await withTransientRetry(() => redis.ping());
    redisStatus = pong === "PONG" ? "PONG" : "WARN";
    checks.push({
      check: "redis",
      status: pong === "PONG" ? "OK" : "WARN",
      reason: pong === "PONG" ? "Redis ping succeeded" : `Unexpected Redis ping response: ${pong}`,
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    if (isTransientNetworkError(error)) {
      redisStatus = "WARN";
      checks.push({
        check: "redis",
        status: "WARN",
        reason,
      });
    } else {
      hardFailure = true;
      checks.push({
        check: "redis",
        status: "FAILED",
        reason,
      });
    }
  }

  const diagnostics = await getRuntimeDiagnostics({ includeConnectivity: false });

  console.log(
    JSON.stringify(
      {
        ok: !hardFailure,
        status: hardFailure ? "FAILED" : checks.some((check) => check.status === "WARN") ? "WARN" : "OK",
        db: dbStatus,
        redis: redisStatus,
        checks,
        runtime: diagnostics,
      },
      null,
      2
    )
  );

  return hardFailure ? 1 : 0;
}

let exitCode = 0;

main()
  .then((code) => {
    exitCode = code;
  })
  .catch((err) => {
    exitCode = 1;
    console.error(
      JSON.stringify(
        {
          ok: false,
          status: "FAILED",
          reason: err instanceof Error ? err.message : String(err),
        },
        null,
        2
      )
    );
  })
  .finally(async () => {
    try {
      await withTimeout(pool.end(), 2_000);
    } catch {}
    try {
      const redis = getRedis();
      await withTimeout(redis.quit(), 2_000);
    } catch {
      try {
        getRedis().disconnect();
      } catch {}
    }
    process.exit(exitCode);
  });
