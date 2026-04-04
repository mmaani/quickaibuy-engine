import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { pool } from "../src/lib/db";
import { getQueueNamespaceDiagnostics } from "../src/lib/queueNamespace";
import { getReviewConsoleCredentials } from "../src/lib/review/auth";
import { getDbTargetContext } from "./lib/dbTarget.mjs";
import { getRuntimeDiagnostics } from "./lib/runtimeDiagnostics.mjs";
import { loadRuntimeEnv } from "./lib/runtimeEnv.mjs";
import { getExecutionContext, type ExecutionContext } from "./lib/runtimeDiagnostics";

type CheckResult = {
  check: string;
  status: "OK" | "FAILED" | "WARN";
  reason: string;
  detail?: string;
};

type ControlPageProbe = {
  attempted: boolean;
  url: string;
  status: number | null;
  ok: boolean;
  outcome: "verified" | "skipped" | "failed";
  reason: string;
};

type ControlPageProbeResult = {
  curlExitCode: number;
  httpStatus: number | null;
};

type BubblewrapProbe = {
  installed: boolean;
  version: string | null;
  runnable: boolean;
  reason: string;
  detail?: string;
};

const execFileAsync = promisify(execFile);

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

function isLocalServerUnavailable(error: unknown): boolean {
  const code = error && typeof error === "object" && "code" in error ? String(error.code ?? "").trim() : "";
  const text = String(error instanceof Error ? error.message : error ?? "")
    .trim()
    .toLowerCase();
  return code === "7" || text.includes("econnrefused") || text.includes("bad port") || text.includes("exit code 7");
}

function parseProbeResult(stdout: string): ControlPageProbeResult {
  const text = String(stdout ?? "");
  const curlExitMatch = text.match(/CURL_EXIT:(\d+)/);
  const httpStatusMatch = text.match(/HTTP_STATUS:(\d{3})/);

  if (!curlExitMatch) {
    throw new Error(`Control page probe did not report curl exit code: ${text.trim()}`);
  }

  return {
    curlExitCode: Number(curlExitMatch[1]),
    httpStatus: httpStatusMatch ? Number(httpStatusMatch[1]) : null,
  };
}

async function requestStatus(url: string, dotenvPath: string, timeoutMs: number): Promise<ControlPageProbeResult> {
  const { stdout } = await execFileAsync(
    "bash",
    [
      "-lc",
      "set -a; source \"$DOTENV_PATH\"; set +a; curl -s -o /dev/null -w 'HTTP_STATUS:%{http_code}\n' -u \"$REVIEW_CONSOLE_USERNAME:$REVIEW_CONSOLE_PASSWORD\" --max-time \"$MAX_TIME\" \"$PROBE_URL\"; printf 'CURL_EXIT:%s\n' \"$?\"",
    ],
    {
      timeout: timeoutMs,
      env: {
        ...process.env,
        DOTENV_PATH: dotenvPath,
        MAX_TIME: String(Math.max(1, Math.ceil(timeoutMs / 1000))),
        PROBE_URL: url,
      },
    }
  );
  return parseProbeResult(stdout);
}

async function probeControlPage(
  reviewConsole: NonNullable<ReturnType<typeof getReviewConsoleCredentials>> | null,
  dotenvPath: string
): Promise<ControlPageProbe> {
  const baseUrl = String(process.env.CODESPACE_LOCAL_APP_URL ?? "http://127.0.0.1:3000").trim().replace(/\/+$/, "");
  const url = `${baseUrl}/admin/control`;

  if (!reviewConsole) {
    return {
      attempted: false,
      url,
      status: null,
      ok: false,
      outcome: "skipped",
      reason: "Review console credentials are not configured; authenticated control page probe skipped.",
    };
  }

  try {
    const result = await requestStatus(
      url,
      dotenvPath,
      Number(process.env.CODESPACE_CONTROL_PAGE_TIMEOUT_MS ?? 20000)
    );

    if (result.curlExitCode === 7) {
      return {
        attempted: true,
        url,
        status: result.httpStatus,
        ok: false,
        outcome: "skipped",
        reason: "No local app server is listening on the configured control page URL; probe skipped.",
      };
    }

    if (result.curlExitCode !== 0) {
      return {
        attempted: true,
        url,
        status: result.httpStatus,
        ok: false,
        outcome: "failed",
        reason: `Control page probe curl exit ${result.curlExitCode}.`,
      };
    }

    const status = result.httpStatus;
    if (!status || !Number.isFinite(status)) {
      return {
        attempted: true,
        url,
        status: null,
        ok: false,
        outcome: "failed",
        reason: "Control page probe did not return a valid HTTP status.",
      };
    }

    if (status >= 200 && status < 300) {
      return {
        attempted: true,
        url,
        status,
        ok: true,
        outcome: "verified",
        reason: `Authenticated control page responded with HTTP ${status}.`,
      };
    }

    return {
      attempted: true,
      url,
      status,
      ok: false,
      outcome: "failed",
      reason: `Authenticated control page responded with HTTP ${status}.`,
    };
  } catch (error) {
    if (isLocalServerUnavailable(error)) {
      return {
        attempted: true,
        url,
        status: null,
        ok: false,
        outcome: "skipped",
        reason: "No local app server is listening on the configured control page URL; probe skipped.",
      };
    }

    return {
      attempted: true,
      url,
      status: null,
      ok: false,
      outcome: "failed",
      reason: error instanceof Error ? error.message : String(error),
    };
  }
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

function summarizeWhatsappContactConfig(runtimeDiagnostics: Awaited<ReturnType<typeof getRuntimeDiagnostics>>): CheckResult {
  const whatsapp = runtimeDiagnostics.contactNotifications?.whatsapp;
  if (!whatsapp) {
    return {
      check: "Lead WhatsApp contact path",
      status: "FAILED",
      reason: "Lead WhatsApp diagnostics were not produced",
    };
  }

  if (whatsapp.primaryReady) {
    return {
      check: "Lead WhatsApp contact path",
      status: "OK",
      reason: whatsapp.automatedReady
        ? "WhatsApp contact path is ready with an automated provider."
        : whatsapp.usingDefaultManualTarget
          ? "WhatsApp contact path is ready via manual link using the built-in fallback target."
          : "WhatsApp contact path is ready via manual link.",
    };
  }

  return {
    check: "Lead WhatsApp contact path",
    status: "FAILED",
    reason: "WhatsApp primary contact path is not ready in runtime env.",
    detail: JSON.stringify({
      mode: whatsapp.mode,
      hasTwilioAccountSid: whatsapp.hasTwilioAccountSid,
      hasWebhookUrl: whatsapp.hasWebhookUrl,
      hasRecipient: whatsapp.hasRecipient,
      hasManualTarget: whatsapp.hasManualTarget,
    }),
  };
}

function summarizeOptionalEmailConfig(runtimeDiagnostics: Awaited<ReturnType<typeof getRuntimeDiagnostics>>): CheckResult {
  const email = runtimeDiagnostics.contactNotifications?.email;
  if (!email) {
    return {
      check: "Lead email notification config",
      status: "WARN",
      reason: "Lead email diagnostics were not produced.",
    };
  }

  if (email.ready) {
    return {
      check: "Lead email notification config",
      status: "OK",
      reason: "Lead email runtime is ready via " + email.mode + ".",
    };
  }

  return {
    check: "Lead email notification config",
    status: "WARN",
    reason: "Lead email is optional and not configured for the primary contact path.",
    detail: JSON.stringify({
      mode: email.mode,
      hasResendApiKey: email.hasResendApiKey,
      hasWebhookUrl: email.hasWebhookUrl,
      hasRecipient: email.hasRecipient,
    }),
  };
}

function extractExecFailure(error: unknown): string {
  if (!error || typeof error !== "object") return String(error ?? "").trim();

  const stderr = "stderr" in error ? String((error as { stderr?: unknown }).stderr ?? "").trim() : "";
  const stdout = "stdout" in error ? String((error as { stdout?: unknown }).stdout ?? "").trim() : "";
  const message = error instanceof Error ? error.message.trim() : String(error ?? "").trim();

  return [stderr, stdout, message].filter(Boolean).join(" | ");
}

async function probeBubblewrap(): Promise<BubblewrapProbe> {
  try {
    const versionResult = await execFileAsync("bwrap", ["--version"]);
    const version = String(versionResult.stdout ?? "").trim() || null;

    try {
      await execFileAsync("bwrap", ["--ro-bind", "/", "/", "true"]);
      return {
        installed: true,
        version,
        runnable: true,
        reason: "bubblewrap is installed and namespace creation succeeded.",
      };
    } catch (error) {
      const detail = extractExecFailure(error);
      const normalized = detail.toLowerCase();
      const namespaceBlocked =
        normalized.includes("no permissions to create new namespace") ||
        normalized.includes("kernel does not allow non-privileged user namespaces") ||
        normalized.includes("operation not permitted");

      return {
        installed: true,
        version,
        runnable: false,
        reason: namespaceBlocked
          ? "bubblewrap is installed but namespace creation is blocked by the workspace/container policy."
          : "bubblewrap is installed but the readiness probe failed.",
        detail,
      };
    }
  } catch (error) {
    const detail = extractExecFailure(error);
    const normalized = detail.toLowerCase();
    const missing = normalized.includes("enoent") || normalized.includes("not found");

    return {
      installed: false,
      version: null,
      runnable: false,
      reason: missing
        ? "bubblewrap is not installed in this workspace image."
        : "bubblewrap version probe failed.",
      detail,
    };
  }
}

function withSandboxContext(result: CheckResult, executionContext: ExecutionContext): CheckResult {
  if (!executionContext.sandboxNetworkDisabled) return result;

  if (
    result.status === "WARN" &&
    (result.check === "Postgres runtime probe" ||
      result.check === "Postgres runtime connectivity" ||
      result.check === "Redis runtime connectivity")
  ) {
    return {
      ...result,
      reason: `${result.reason} (sandbox-limited network context)`,
      detail: result.detail
        ? `${result.detail} | CODEX_SANDBOX_NETWORK_DISABLED=1`
        : "CODEX_SANDBOX_NETWORK_DISABLED=1",
    };
  }

  if (result.status === "WARN" && result.check === "Control page probe") {
    return {
      ...result,
      detail: result.detail
        ? `${result.detail} | if the app is running outside the sandbox, rerun this check in the same runtime context`
        : "If the app is running outside the sandbox, rerun this check in the same runtime context.",
    };
  }

  return result;
}

async function main() {
  const shellNodeEnv = String(process.env.NODE_ENV ?? "").trim().toLowerCase();
  const dotenvPath = loadRuntimeEnv();
  const executionContext = getExecutionContext();
  const context = getDbTargetContext();
  const queue = getQueueNamespaceDiagnostics();
  const reviewConsole = getReviewConsoleCredentials();
  const runtimeDiagnostics = await getRuntimeDiagnostics({ includeConnectivity: true });
  const controlPageProbe = await probeControlPage(reviewConsole, dotenvPath);
  const bubblewrap = await probeBubblewrap();
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
    shellNodeEnv === "production"
      ? {
          check: "NODE_ENV",
          status: "OK",
          reason: "NODE_ENV=production",
        }
      : {
          check: "NODE_ENV",
          status: "WARN",
          reason: "Shell NODE_ENV is not production",
          detail: "Pass NODE_ENV=production in the shell that launches codespace:check; the .env file value alone is not treated as sufficient here.",
        }
  );

  checks.push(
    bubblewrap.installed && bubblewrap.runnable
      ? {
          check: "Codex sandbox namespace readiness",
          status: "OK",
          reason: bubblewrap.reason,
          detail: bubblewrap.version ?? undefined,
        }
      : {
          check: "Codex sandbox namespace readiness",
          status: "FAILED",
          reason: bubblewrap.reason,
          detail: bubblewrap.detail ?? bubblewrap.version ?? undefined,
        }
  );

  checks.push(
    reviewConsole
      ? {
          check: "Review console auth",
          status: "OK",
          reason: "Review console credentials are configured in runtime env",
        }
      : {
          check: "Review console auth",
          status: "WARN",
          reason: "REVIEW_CONSOLE_USERNAME / REVIEW_CONSOLE_PASSWORD are not configured",
          detail: "Authenticated /admin/control verification will not be possible until review console credentials are present.",
        }
  );

  checks.push(
    controlPageProbe.outcome === "verified"
      ? {
          check: "Control page probe",
          status: "OK",
          reason: controlPageProbe.reason,
          detail: controlPageProbe.url,
        }
      : controlPageProbe.outcome === "skipped"
        ? {
            check: "Control page probe",
            status: "WARN",
            reason: controlPageProbe.reason,
            detail: controlPageProbe.url,
          }
        : {
            check: "Control page probe",
            status: "FAILED",
            reason: controlPageProbe.reason,
            detail: controlPageProbe.url,
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

  checks.push(withSandboxContext(summarizePgConnectivity(runtimeDiagnostics), executionContext));
  checks.push(withSandboxContext(summarizeRedisConnectivity(runtimeDiagnostics), executionContext));
  checks.push(withSandboxContext(summarizeWhatsappContactConfig(runtimeDiagnostics), executionContext));
  checks.push(withSandboxContext(summarizeOptionalEmailConfig(runtimeDiagnostics), executionContext));

  for (let index = 0; index < checks.length; index += 1) {
    checks[index] = withSandboxContext(checks[index], executionContext);
  }

  const hasFailure = checks.some((check) => check.status === "FAILED");

  console.log(
    JSON.stringify(
      {
        title: "codespace runtime validation",
        dotenvPath,
        envSource: context.envSource,
        classification: context.classification,
        mutationSafety: context.mutationSafety.classification,
        shellNodeEnv,
        executionContext,
        queue,
        bubblewrap,
        reviewConsole: {
          configured: Boolean(reviewConsole),
          usernameSet: Boolean(String(process.env.REVIEW_CONSOLE_USERNAME ?? "").trim()),
          passwordSet: Boolean(String(process.env.REVIEW_CONSOLE_PASSWORD ?? "")),
        },
        controlPageProbe,
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
