import type { ConnectionOptions } from "bullmq";

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing ${name}`);
  return v;
}

/**
 * BullMQ connection config.
 * We intentionally return ConnectionOptions (NOT an ioredis instance)
 * to avoid duplicate ioredis type conflicts.
 *
 * BullMQ supports a plain connection options object. 
 */
export function getBullConnection(): ConnectionOptions {
  const url = requireEnv("REDIS_URL");

  // Supports: rediss://default:password@host:port
  const u = new URL(url);

  const port = u.port ? Number(u.port) : 6379;
  const username = u.username || undefined;
  const password = u.password || undefined;

  const isTls = u.protocol === "rediss:";

  return {
    host: u.hostname,
    port,
    username,
    password,
    // For Upstash / managed TLS endpoints:
    tls: isTls ? {} : undefined,
  };
}

// Shared BullMQ connection options export for modules that need a singleton config.
export const bullConnection: ConnectionOptions = getBullConnection();
