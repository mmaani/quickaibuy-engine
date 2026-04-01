import { NextResponse } from "next/server";
import postgres from "postgres";
import Redis from "ioredis";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

export async function GET() {
  const started = Date.now();

  let db = false;
  let redis = false;
  let dbDetail: string | null = null;
  let redisDetail: string | null = null;

  try {
    const dbUrl = process.env.DATABASE_URL || process.env.DATABASE_URL_DIRECT;
    if (!dbUrl) throw new Error("Missing DATABASE_URL or DATABASE_URL_DIRECT");
    await withTransientRetry(async () => {
      const sql = postgres(dbUrl, { max: 1, idle_timeout: 2, connect_timeout: 5 });
      try {
        await sql`SELECT 1`;
      } finally {
        await sql.end({ timeout: 2 });
      }
    });
    db = true;
  } catch (error) {
    db = false;
    dbDetail = error instanceof Error ? error.message : String(error);
  }

  try {
    const redisUrl = process.env.REDIS_URL;
    if (!redisUrl) throw new Error("Missing REDIS_URL");
    const pong = await withTransientRetry(async () => {
      const client = new Redis(redisUrl, { maxRetriesPerRequest: 1, enableReadyCheck: false, lazyConnect: true });
      try {
        await client.connect();
        return await client.ping();
      } finally {
        await client.quit().catch(() => client.disconnect());
      }
    });
    redis = pong === "PONG";
  } catch (error) {
    redis = false;
    redisDetail = error instanceof Error ? error.message : String(error);
  }

  return NextResponse.json({
    ok: db && redis,
    db,
    redis,
    dbDetail,
    redisDetail,
    ms: Date.now() - started,
    env: process.env.NODE_ENV ?? "unknown",
  });
}
