import {
  checkDns,
  checkEnvVar,
  checkTcp,
  classifyError,
  isTransientDnsError,
  parseUrlHostPort,
  withRetries,
} from "./lib/runtimeDiagnostics";
import { getDbTargetContext, printDbTargetBanner } from "./lib/dbTarget.mjs";
import { loadRuntimeEnv } from "./lib/runtimeEnv.mjs";

const dotenvPath = loadRuntimeEnv();

type PreflightIssue = {
  class: string;
  reason: string;
  nextStep: string;
};

async function checkRequiredEndpoint(name: string, value: string, fallbackPort: number): Promise<PreflightIssue | null> {
  const parsed = parseUrlHostPort(value, fallbackPort);
  if (!parsed) {
    return {
      class: "CONFIG_MISSING",
      reason: `${name} URL invalid`,
      nextStep: `Fix ${name} format in ${dotenvPath}`,
    };
  }

  try {
    await withRetries(() => checkDns(parsed.host), {
      retries: 2,
      delayMs: 500,
      retryOn: isTransientDnsError,
    });
  } catch (error) {
    const c = classifyError(error);
    return {
      class: c.status,
      reason: `${name} DNS failure (${parsed.host})`,
      nextStep: c.nextStep,
    };
  }

  try {
    await checkTcp(parsed.host, parsed.port);
  } catch (error) {
    const c = classifyError(error);
    return {
      class: c.status,
      reason: `${name} endpoint unreachable (${parsed.host}:${parsed.port})`,
      nextStep: c.nextStep,
    };
  }

  return null;
}

async function main() {
  printDbTargetBanner(getDbTargetContext());
  console.log(`[worker:engine] env_path=${dotenvPath}`);

  const db = checkEnvVar("DATABASE_URL");
  if (db.status !== "OK") {
    console.error(`[worker:engine] DEPENDENCY_CLASS=${db.status}`);
    console.error(`[worker:engine] reason=${db.reason}`);
    console.error(
      `[worker:engine] next_step=${db.nextStep ?? "Set DATABASE_URL in selected env file"}`
    );
    process.exit(1);
  }

  const redis = checkEnvVar("REDIS_URL");
  if (redis.status !== "OK") {
    console.error(`[worker:engine] DEPENDENCY_CLASS=${redis.status}`);
    console.error(`[worker:engine] reason=${redis.reason}`);
    console.error(`[worker:engine] next_step=${redis.nextStep ?? "Set REDIS_URL"}`);
    process.exit(1);
  }

  const dbIssue = await checkRequiredEndpoint("DATABASE_URL", String(process.env.DATABASE_URL), 5432);
  if (dbIssue) {
    const nextStep =
      dbIssue.class === "DNS_FAILURE" || dbIssue.class === "NETWORK_UNREACHABLE"
        ? `${dbIssue.nextStep} If running in a restricted environment, allow outbound DNS/TCP and retry.`
        : dbIssue.nextStep;
    console.error(`[worker:engine] DEPENDENCY_CLASS=${dbIssue.class}`);
    console.error(`[worker:engine] reason=${dbIssue.reason}`);
    console.error(`[worker:engine] next_step=${nextStep}`);
    process.exit(1);
  }

  const redisIssue = await checkRequiredEndpoint("REDIS_URL", String(process.env.REDIS_URL), 6379);
  if (redisIssue) {
    const nextStep =
      redisIssue.class === "DNS_FAILURE" || redisIssue.class === "NETWORK_UNREACHABLE"
        ? `${redisIssue.nextStep} If running in a restricted environment, allow outbound DNS/TCP and retry.`
        : redisIssue.nextStep;
    console.error(`[worker:engine] DEPENDENCY_CLASS=${redisIssue.class}`);
    console.error(`[worker:engine] reason=${redisIssue.reason}`);
    console.error(`[worker:engine] next_step=${nextStep}`);
    process.exit(1);
  }

  await import("../src/workers/engine.worker");
}

main().catch((error) => {
  const c = classifyError(error);
  console.error(`[worker:engine] DEPENDENCY_CLASS=${c.status}`);
  console.error(`[worker:engine] reason=${c.reason}`);
  console.error(`[worker:engine] next_step=${c.nextStep}`);
  if (process.env.DIAG_VERBOSE === "1") {
    console.error(error);
  }
  process.exit(1);
});
