import dotenv from "dotenv";
import {
  checkDns,
  checkEnvVar,
  checkTcp,
  checkVercelCli,
  checkVercelLinkState,
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
      nextStep: `Fix ${label} URL format in env.`,
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
    const c = classifyError(error);
    checks.push({
      check: `${label} DNS`,
      status: c.status,
      reason: c.reason,
      nextStep: c.nextStep,
      detail: c.detail,
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
    const c = classifyError(error);
    checks.push({
      check: `${label} TCP`,
      status: c.status,
      reason: c.reason,
      nextStep: c.nextStep,
      detail: c.detail,
    });
  }
}

async function main() {
  const checks: DiagnosticResult[] = [];

  const dbVar = checkEnvVar("DATABASE_URL");
  const redisVar = checkEnvVar("REDIS_URL");
  checks.push(dbVar, redisVar);

  if (dbVar.status === "OK") {
    await runHostChecks("Database", String(process.env.DATABASE_URL), 5432, checks);
  }
  if (redisVar.status === "OK") {
    await runHostChecks("Redis", String(process.env.REDIS_URL), 6379, checks);
  }

  checks.push(checkVercelCli());
  checks.push(checkVercelLinkState());

  printStructuredResults(`runtime dependency preflight (${dotenvPath})`, checks);

  const hasFailures = checks.some((c) => c.status !== "OK");
  process.exit(hasFailures ? 1 : 0);
}

main().catch((error) => {
  const c = classifyError(error);
  printStructuredResults("runtime dependency preflight", [
    {
      check: "preflight execution",
      status: c.status,
      reason: c.reason,
      nextStep: c.nextStep,
      detail: c.detail,
    },
  ]);
  process.exit(1);
});
