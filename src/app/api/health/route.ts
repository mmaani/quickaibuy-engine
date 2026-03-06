import { NextResponse } from "next/server";
import { pool } from "@/lib/db";
import Redis from "ioredis";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const t0 = Date.now();

  // DB
  await pool.query("select 1 as ok");

  // Redis
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) throw new Error("Missing REDIS_URL");
  const redis = new Redis(redisUrl, { maxRetriesPerRequest: 1 });
  const pong = await redis.ping();
  redis.disconnect();

  return NextResponse.json({
    ok: true,
    db: true,
    redis: pong === "PONG",
    ms: Date.now() - t0,
    env: process.env.APP_ENV ?? process.env.VERCEL_ENV ?? "unknown",
  });
}
