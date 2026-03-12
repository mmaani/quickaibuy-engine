import fs from "fs";
import path from "path";
import dotenv from "dotenv";
import { Queue, type ConnectionOptions } from "bullmq";

type EnvName = "dev" | "prod";

type EnvConfig = {
  env: EnvName;
  file: string;
  redisUrl: string | null;
  bullPrefix: string;
  jobsQueueName: string;
};

type QueueProbe = {
  ok: boolean;
  reason?: string;
  counts?: Record<string, number>;
};

type RedisFingerprint = {
  protocol: string;
  host: string;
  port: number;
  dbPath: string;
};

function loadEnvConfig(file: string, env: EnvName): EnvConfig {
  const abs = path.resolve(file);
  const parsed = fs.existsSync(abs) ? dotenv.parse(fs.readFileSync(abs, "utf8")) : {};
  const redisUrl = String(parsed.REDIS_URL ?? "").trim() || null;
  const bullPrefix = String(parsed.BULL_PREFIX ?? "qaib").trim() || "qaib";
  const jobsQueueName = String(parsed.JOBS_QUEUE_NAME ?? "jobs").trim() || "jobs";

  return {
    env,
    file: abs,
    redisUrl,
    bullPrefix,
    jobsQueueName,
  };
}

function parseRedisFingerprint(redisUrl: string): RedisFingerprint {
  const url = new URL(redisUrl);
  return {
    protocol: url.protocol.replace(":", ""),
    host: url.hostname,
    port: url.port ? Number(url.port) : 6379,
    dbPath: url.pathname || "/",
  };
}

function connectionFromUrl(redisUrl: string): ConnectionOptions {
  return {
    url: redisUrl,
    connectTimeout: 3000,
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
    retryStrategy: () => null,
  };
}

async function probeQueue(config: EnvConfig): Promise<QueueProbe> {
  if (!config.redisUrl) {
    return { ok: false, reason: "REDIS_URL missing" };
  }

  const queue = new Queue(config.jobsQueueName, {
    connection: connectionFromUrl(config.redisUrl),
    prefix: config.bullPrefix,
  });

  try {
    const client = await queue.client;
    await client.ping();
    const counts = await queue.getJobCounts("waiting", "active", "completed", "failed", "delayed");
    return { ok: true, counts };
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof Error ? error.message : String(error),
    };
  } finally {
    await queue.close().catch(() => {});
  }
}

async function main() {
  const dev = loadEnvConfig(".env.local", "dev");
  const prod = loadEnvConfig(".env.vercel", "prod");

  const envs = [dev, prod];
  const missing = envs.filter((cfg) => !cfg.redisUrl);
  if (missing.length) {
    console.log(
      JSON.stringify(
        {
          status: "FAILED",
          reason: "Missing REDIS_URL in one or more env files.",
          missing: missing.map((cfg) => ({ env: cfg.env, file: cfg.file })),
        },
        null,
        2
      )
    );
    process.exit(1);
  }

  const [devProbe, prodProbe] = await Promise.all([probeQueue(dev), probeQueue(prod)]);
  const devFp = parseRedisFingerprint(dev.redisUrl as string);
  const prodFp = parseRedisFingerprint(prod.redisUrl as string);

  const sameRedisEndpoint =
    devFp.protocol === prodFp.protocol &&
    devFp.host === prodFp.host &&
    devFp.port === prodFp.port &&
    devFp.dbPath === prodFp.dbPath;
  const sameNamespace =
    dev.bullPrefix === prod.bullPrefix && dev.jobsQueueName === prod.jobsQueueName;

  const warnings: string[] = [];
  if (sameRedisEndpoint && sameNamespace) {
    warnings.push("dev/prod share the same Redis endpoint and Bull queue namespace");
  } else if (sameRedisEndpoint) {
    warnings.push("dev/prod share the same Redis endpoint (namespace differs)");
  }
  if (!devProbe.ok) warnings.push(`dev queue probe failed: ${devProbe.reason}`);
  if (!prodProbe.ok) warnings.push(`prod queue probe failed: ${prodProbe.reason}`);

  const status = warnings.length ? "WARN" : "OK";
  const output = {
    status,
    checks: {
      sameRedisEndpoint,
      sameNamespace,
    },
    dev: {
      file: dev.file,
      redisFingerprint: devFp,
      bullPrefix: dev.bullPrefix,
      jobsQueueName: dev.jobsQueueName,
      probe: devProbe,
    },
    prod: {
      file: prod.file,
      redisFingerprint: prodFp,
      bullPrefix: prod.bullPrefix,
      jobsQueueName: prod.jobsQueueName,
      probe: prodProbe,
    },
    warnings,
    recommendation:
      warnings.length === 0
        ? "Upstash setup is isolated and reachable."
        : "Use separate REDIS_URL and/or BULL_PREFIX per environment to isolate queues.",
  };

  console.log(JSON.stringify(output, null, 2));
}

main().catch((error) => {
  console.error(
    JSON.stringify(
      {
        status: "FAILED",
        reason: error instanceof Error ? error.message : String(error),
      },
      null,
      2
    )
  );
  process.exit(1);
});
