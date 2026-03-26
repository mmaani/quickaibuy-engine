import dotenv from "dotenv";
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

const dotenvPath = process.env.DOTENV_CONFIG_PATH?.trim() || ".env.local";
dotenv.config({ path: dotenvPath, override: true });
dotenv.config();

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
  const checks: DiagnosticResult[] = [];
  const dbVar = checkEnvVar("DATABASE_URL");
  const redisVar = checkEnvVar("REDIS_URL");
  const bullPrefixVar = checkEnvVar("BULL_PREFIX");
  const jobsQueueVar = checkEnvVar("JOBS_QUEUE_NAME");

  checks.push(dbVar, redisVar, bullPrefixVar, jobsQueueVar);

  if (dbVar.status === "OK") {
    await runHostChecks("Database", String(process.env.DATABASE_URL), 5432, checks);
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
