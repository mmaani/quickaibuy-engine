import { NextResponse } from "next/server";
import { sql } from "@/src/db/client";
import { getRedis } from "@/src/lib/redis";

export const runtime = "nodejs";

export async function GET() {
  const started = Date.now();

  let dbOk = false;
  let redisOk = false;
  let dbError: string | null = null;
  let redisError: string | null = null;

  try {
    // Fast: no table dependency
    await sql`SELECT 1`;
    dbOk = true;
  } catch (e) {
    dbError = e instanceof Error ? e.message : String(e);
  }

  try {
    const r = getRedis();
    const pong = await r.ping();
    redisOk = pong === "PONG";
    if (!redisOk) redisError = `Unexpected PING response: ${pong}`;
  } catch (e) {
    redisError = e instanceof Error ? e.message : String(e);
  }

  const ok = dbOk && redisOk;

  return NextResponse.json(
    {
      ok,
      service: "QuickAIBuy Engine",
      version: process.env.APP_VERSION ?? "unknown",
      db: { ok: dbOk, error: dbError },
      redis: { ok: redisOk, error: redisError },
      timestamp: new Date().toISOString(),
      durationMs: Date.now() - started,
    },
    { status: ok ? 200 : 503 }
  );
}
