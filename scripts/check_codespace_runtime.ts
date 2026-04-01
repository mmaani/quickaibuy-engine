import { pool } from "../src/lib/db";
import { getQueueNamespaceDiagnostics } from "../src/lib/queueNamespace";
import { getDbTargetContext } from "./lib/dbTarget.mjs";
import { getRuntimeDiagnostics } from "./lib/runtimeDiagnostics.mjs";
import { loadRuntimeEnv } from "./lib/runtimeEnv.mjs";

type CheckResult = {
  check: string;
  status: "OK" | "FAILED" | "WARN";
  reason: string;
  detail?: string;
};

function isTransientNetworkError(error: unknown): boolean {
  const text = String(error instanceof Error ? error.message : error ?? "")
    .trim()
    .toLowerCase();
  return (
    text.includes("eai_again") ||
    text.includes("enotfound") ||
    text.includes("etimedout") ||
    text.includes("econnrefused") ||
    text.includes("enetunreach") ||
    text.includes("dns")
  );
}

function summarizePgConnectivity(runtimeDiagnostics: Awaited<ReturnType<typeof getRuntimeDiagnostics>>): CheckResult {
  const targets = runtimeDiagnostics.connectivity?.postgres?.targets ?? [];
  const hasPgSuccess = targets.some((target) => target.pg_ok);
  if (hasPgSuccess) {
    return {
      check: "Postgres runtime connectivity",
      status: "OK",
      reason: "Database connectivity diagnostics succeeded",
    };
  }

  const transientTargets = targets.filter((target) => target.pg_error_kind === "dns" || target.pg_error_kind === "tcp");
  if (targets.length > 0 && transientTargets.length === targets.length) {
    return {
      check: "Postgres runtime connectivity",
      status: "WARN",
      reason: "Database connectivity hit transient DNS/TCP failure",
      detail: transientTargets.map((target) => `${target.label}:${target.pg_error_code ?? target.pg_error_kind}`).join(", "),
    };
  }

  return {
    check: "Postgres runtime connectivity",
    status: "FAILED",
    reason: targets[0]?.pg_error_message ?? "Database connectivity diagnostics failed",
  };
}

function summarizeRedisConnectivity(runtimeDiagnostics: Awaited<ReturnType<typeof getRuntimeDiagnostics>>): CheckResult {
  const redis = runtimeDiagnostics.connectivity?.redis;
  if (!redis) {
    return {
      check: "Redis runtime connectivity",
      status: "FAILED",
      reason: "Redis connectivity diagnostics were not produced",
    };
  }

  if (redis.configured && redis.dns_ok && redis.tcp_ok) {
    return {
      check: "Redis runtime connectivity",
      status: "OK",
      reason: "Redis DNS and TCP checks succeeded",
    };
  }

  if (redis.configured && (redis.error_kind === "dns" || redis.error_kind === "tcp")) {
    return {
      check: "Redis runtime connectivity",
      status: "WARN",
      reason: "Redis connectivity hit transient DNS/TCP failure",
      detail: redis.error_code ?? redis.error_message ?? undefined,
    };
  }

  return {
    check: "Redis runtime connectivity",
    status: "FAILED",
    reason: redis.error_message ?? "Redis connectivity diagnostics failed",
  };
}

async function main() {
  const dotenvPath = loadRuntimeEnv();
  const context = getDbTargetContext();
  const queue = getQueueNamespaceDiagnostics();
  const runtimeDiagnostics = await getRuntimeDiagnostics({ includeConnectivity: true });
  const checks: CheckResult[] = [];

  checks.push(
    context.classification === "PROD"
      ? {
          check: "DB target classification",
          status: "OK",
          reason: "Workspace is targeting PROD",
          detail: `${context.envSource} -> ${context.databaseUrlDirectHost ?? context.databaseUrlHost ?? "missing"}`,
        }
      : {
          check: "DB target classification",
          status: "FAILED",
          reason: `Expected PROD, got ${context.classification}`,
          detail: context.classificationReason,
        }
  );

  checks.push(
    context.mutationSafety.classification === "PROD_BLOCKED"
      ? {
          check: "Mutation safety",
          status: "OK",
          reason: "Production mutation guards are closed",
        }
      : {
          check: "Mutation safety",
          status: "FAILED",
          reason: `Expected PROD_BLOCKED, got ${context.mutationSafety.classification}`,
          detail: context.mutationSafety.missing.join(", "),
        }
  );

  checks.push(
    queue.environment === "production" &&
      queue.bullPrefix === "qaib-prod" &&
      queue.jobsQueueName === "jobs-prod"
      ? {
          check: "Queue namespace",
          status: "OK",
          reason: "Production queue namespace is explicit and safe",
        }
      : {
          check: "Queue namespace",
          status: "FAILED",
          reason: "Queue namespace is not aligned to production-safe values",
          detail: JSON.stringify(queue),
        }
  );

  checks.push(
    String(process.env.NODE_ENV ?? "").trim().toLowerCase() === "production"
      ? {
          check: "NODE_ENV",
          status: "OK",
          reason: "NODE_ENV=production",
        }
      : {
          check: "NODE_ENV",
          status: "WARN",
          reason: "Shell NODE_ENV is not production",
          detail: "Codespaces diagnostics can still be valid, but Railway worker preflight will flag this shell.",
        }
  );

  try {
    const result = await pool.query("select 1 as ok");
    checks.push(
      result.rows[0]?.ok === 1
        ? {
            check: "Postgres runtime probe",
            status: "OK",
            reason: "Database query succeeded",
          }
        : {
            check: "Postgres runtime probe",
            status: "FAILED",
            reason: "Unexpected database probe result",
          }
    );
  } catch (error) {
    checks.push({
      check: "Postgres runtime probe",
      status: isTransientNetworkError(error) ? "WARN" : "FAILED",
      reason: error instanceof Error ? error.message : String(error),
    });
  }

  checks.push(summarizePgConnectivity(runtimeDiagnostics));
  checks.push(summarizeRedisConnectivity(runtimeDiagnostics));

  const hasFailure = checks.some((check) => check.status === "FAILED");

  console.log(
    JSON.stringify(
      {
        title: "codespace runtime validation",
        dotenvPath,
        envSource: context.envSource,
        classification: context.classification,
        mutationSafety: context.mutationSafety.classification,
        queue,
        connectivity: runtimeDiagnostics.connectivity,
        checks,
      },
      null,
      2
    )
  );

  process.exit(hasFailure ? 1 : 0);
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.stack ?? error.message : String(error));
    process.exit(1);
  })
  .finally(async () => {
    try {
      await pool.end();
    } catch {}
  });
