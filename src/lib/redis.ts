import IORedis from "ioredis";

const redisUrl = process.env.REDIS_URL;
if (!redisUrl) throw new Error("Missing REDIS_URL");

declare global {
  // eslint-disable-next-line no-var
  var __qaib_redis: IORedis | undefined;
}

export function getRedis(): IORedis {
  if (!global.__qaib_redis) {
    global.__qaib_redis = new IORedis(redisUrl, {
      // Upstash + serverless friendly defaults
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
    });
  }
  return global.__qaib_redis;
}
