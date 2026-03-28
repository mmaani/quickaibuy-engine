import {
  checkDns,
  checkEnvVar,
  checkTcp,
  classifyError,
  isTransientDnsError,
  parseUrlHostPort,
  printStructuredResults,
  type DiagnosticResult,
  withRetries,
} from "./lib/runtimeDiagnostics";
import {
  PROD_BULL_PREFIX,
  PROD_JOBS_QUEUE_NAME,
} from "./lib/railwayWorkerEnv";
import { getDbTargetContext, printDbTargetBanner } from "./lib/dbTarget.mjs";
import { loadRuntimeEnv } from "./lib/runtimeEnv.mjs";

const dotenvPath = loadRuntimeEnv();

async function runHostChecks(
  label: string,
  urlValue: string,
  fallbackPort: number,
  checks: DiagnosticResult[]
): Promise<void> {
  const parsed = parseUrlHostPort(urlValue, fallbackPort);
  if (!parsed) {
    checks.push({
      check: `${label} URL parse`,
      status: "CONFIG_MISSING",
      reason: `${label} URL is invalid`,
      nextStep: `Fix ${label} URL format in the worker runtime environment.`,
    });
    return;
  }

  try {
    await withRetries(() => checkDns(parsed.host), {
      retries: 2,
      delayMs: 500,
      retryOn: isTransientDnsError,
    });
    checks.push({
      check: `${label} DNS`,
      status: "OK",
      reason: `${parsed.host} resolved`,
    });
  } catch (error) {
    const classified = classifyError(error);
    checks.push({
      check: `${label} DNS`,
      status: classified.status,
      reason: classified.reason,
      nextStep: classified.nextStep,
      detail: classified.detail,
    });
    return;
  }

  try {
    await checkTcp(parsed.host, parsed.port);
    checks.push({
      check: `${label} TCP`,
      status: "OK",
      reason: `${parsed.host}:${parsed.port} reachable`,
    });
  } catch (error) {
    const classified = classifyError(error);
    checks.push({
      check: `${label} TCP`,
      status: classified.status,
      reason: classified.reason,
      nextStep: classified.nextStep,
      detail: classified.detail,
    });
  }
}

async function main() {
  printDbTargetBanner(getDbTargetContext());
  const checks: DiagnosticResult[] = [];
  const hasDatabaseUrl =
    String(process.env.DATABASE_URL ?? "").trim().length > 0 ||
    String(process.env.DATABASE_URL_DIRECT ?? "").trim().length > 0;
  const dbVar = hasDatabaseUrl
    ? {
        check: "DATABASE_URL|DATABASE_URL_DIRECT",
        status: "OK" as const,
        reason: "Database URL configured",
      }
    : {
        check: "DATABASE_URL|DATABASE_URL_DIRECT",
        status: "CONFIG_MISSING" as const,
        reason: "Missing DATABASE_URL and DATABASE_URL_DIRECT",
        nextStep: "Set DATABASE_URL or DATABASE_URL_DIRECT in the worker runtime environment.",
      };
  const redisVar = checkEnvVar("REDIS_URL");
  const bullPrefixVar = checkEnvVar("BULL_PREFIX");
  const jobsQueueVar = checkEnvVar("JOBS_QUEUE_NAME");
  const appEnv = String(process.env.APP_ENV ?? "").trim().toLowerCase();
  const nodeEnv = String(process.env.NODE_ENV ?? "").trim().toLowerCase();

  checks.push(dbVar, redisVar, bullPrefixVar, jobsQueueVar);

  checks.push(
    appEnv === "production" || appEnv === "prod"
      ? {
          check: "APP_ENV",
          status: "OK",
          reason: "APP_ENV=production",
        }
      : {
          check: "APP_ENV",
          status: "CONFIG_MISSING",
          reason: "APP_ENV must be production",
          nextStep: "Set APP_ENV=production in the Railway jobs worker service.",
        }
  );

  checks.push(
    nodeEnv === "production"
      ? {
          check: "NODE_ENV",
          status: "OK",
          reason: "NODE_ENV=production",
        }
      : {
          check: "NODE_ENV",
          status: "CONFIG_MISSING",
          reason: "NODE_ENV must be production",
          nextStep: "Set NODE_ENV=production in the Railway jobs worker service.",
        }
  );

  if (bullPrefixVar.status === "OK" && String(process.env.BULL_PREFIX) !== PROD_BULL_PREFIX) {
    checks.push({
      check: "BULL_PREFIX value",
      status: "CONFIG_MISSING",
      reason: `BULL_PREFIX must be ${PROD_BULL_PREFIX}`,
      nextStep: `Set BULL_PREFIX=${PROD_BULL_PREFIX} in the Railway jobs worker service.`,
    });
  }

  if (jobsQueueVar.status === "OK" && String(process.env.JOBS_QUEUE_NAME) !== PROD_JOBS_QUEUE_NAME) {
    checks.push({
      check: "JOBS_QUEUE_NAME value",
      status: "CONFIG_MISSING",
      reason: `JOBS_QUEUE_NAME must be ${PROD_JOBS_QUEUE_NAME}`,
      nextStep: `Set JOBS_QUEUE_NAME=${PROD_JOBS_QUEUE_NAME} in the Railway jobs worker service.`,
    });
  }

  if (dbVar.status === "OK") {
    await runHostChecks(
      "Database",
      String(process.env.DATABASE_URL || process.env.DATABASE_URL_DIRECT),
      5432,
      checks
    );
  }
  if (redisVar.status === "OK") {
    await runHostChecks("Redis", String(process.env.REDIS_URL), 6379, checks);
  }

  printStructuredResults(`worker runtime dependency preflight (${dotenvPath})`, checks);
  process.exit(checks.some((check) => check.status !== "OK") ? 1 : 0);
}

main().catch((error) => {
  const classified = classifyError(error);
  printStructuredResults("worker runtime dependency preflight", [
    {
      check: "worker preflight execution",
      status: classified.status,
      reason: classified.reason,
      nextStep: classified.nextStep,
      detail: classified.detail,
    },
  ]);
  process.exit(1);
});
