import { NextResponse } from "next/server";
import postgres from "postgres";
import Redis from "ioredis";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const started = Date.now();

  let db = false;
  let redis = false;

  try {
    const dbUrl = process.env.DATABASE_URL || process.env.DATABASE_URL_DIRECT;
    if (!dbUrl) throw new Error("Missing DATABASE_URL or DATABASE_URL_DIRECT");
    const sql = postgres(dbUrl, { max: 1, idle_timeout: 2 });
    await sql`SELECT 1`;
    db = true;
    await sql.end({ timeout: 2 });
  } catch {
    db = false;
  }

  try {
    const redisUrl = process.env.REDIS_URL;
    if (!redisUrl) throw new Error("Missing REDIS_URL");
    const client = new Redis(redisUrl, { maxRetriesPerRequest: 1 });
    const pong = await client.ping();
    redis = pong === "PONG";
    await client.quit();
  } catch {
    redis = false;
  }

  return NextResponse.json({
    ok: db && redis,
    db,
    redis,
    ms: Date.now() - started,
    env: process.env.NODE_ENV ?? "unknown",
  });
}
