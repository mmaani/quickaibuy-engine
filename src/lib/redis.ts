import IORedis from "ioredis";

function getRedisUrl(): string {
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) throw new Error("Missing REDIS_URL");
  return redisUrl;
}

declare global {
  var __qaib_redis: IORedis | undefined;
}

export function getRedis(): IORedis {
  if (!global.__qaib_redis) {
    global.__qaib_redis = new IORedis(getRedisUrl(), {
      // Upstash + serverless friendly defaults
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
    });
  }
  return global.__qaib_redis;
}
