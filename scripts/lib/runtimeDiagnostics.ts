import { lookup } from "node:dns/promises";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import net from "node:net";

export type DiagnosticClass =
  | "OK"
  | "CONFIG_MISSING"
  | "DNS_FAILURE"
  | "AUTH_FAILURE"
  | "NETWORK_UNREACHABLE"
  | "UNKNOWN";

export type DiagnosticResult = {
  check: string;
  status: DiagnosticClass;
  reason: string;
  nextStep?: string;
  detail?: string;
};

function flattenErrorDetail(error: unknown): string {
  if (!error) return "unknown error";
  if (typeof error === "string") return error;

  const parts: string[] = [];
  let cursor: unknown = error;
  let depth = 0;

  while (cursor && depth < 4) {
    if (cursor instanceof Error) {
      if (cursor.message) {
        parts.push(cursor.message);
      }
      cursor = (cursor as Error & { cause?: unknown }).cause;
      depth += 1;
      continue;
    }

    if (typeof cursor === "object") {
      const maybeMessage = (cursor as { message?: unknown }).message;
      const maybeCause = (cursor as { cause?: unknown }).cause;
      if (typeof maybeMessage === "string" && maybeMessage.trim()) {
        parts.push(maybeMessage);
      }
      cursor = maybeCause;
      depth += 1;
      continue;
    }

    break;
  }

  if (!parts.length) {
    try {
      return JSON.stringify(error);
    } catch {
      return String(error);
    }
  }

  return parts.join(" | ");
}

export function parseUrlHostPort(input: string, fallbackPort: number): { host: string; port: number } | null {
  try {
    const parsed = new URL(input);
    return {
      host: parsed.hostname,
      port: parsed.port ? Number(parsed.port) : fallbackPort,
    };
  } catch {
    return null;
  }
}

export function classifyError(error: unknown): {
  status: Exclude<DiagnosticClass, "OK">;
  reason: string;
  nextStep: string;
  detail: string;
} {
  const detail = flattenErrorDetail(error);
  const message = detail.toLowerCase();

  if (
    message.includes("eai_again") ||
    message.includes("enotfound") ||
    message.includes("dns") ||
    message.includes("name resolution")
  ) {
    return {
      status: "DNS_FAILURE",
      reason: "Hostname lookup failed",
      nextStep: "Verify host DNS resolution and retry in 30-60 seconds.",
      detail,
    };
  }

  if (
    message.includes("unauthorized") ||
    message.includes("not logged in") ||
    message.includes("authentication") ||
    message.includes("forbidden") ||
    message.includes("token")
  ) {
    return {
      status: "AUTH_FAILURE",
      reason: "Authentication failed",
      nextStep: "Login/link credentials again and retry.",
      detail,
    };
  }

  if (
    message.includes("econnrefused") ||
    message.includes("etimedout") ||
    message.includes("timeout") ||
    message.includes("unreachable")
  ) {
    return {
      status: "NETWORK_UNREACHABLE",
      reason: "Network endpoint unreachable",
      nextStep: "Check firewall/network routing and endpoint status.",
      detail,
    };
  }

  if (message.includes("missing") || message.includes("invalid") || message.includes("not set")) {
    return {
      status: "CONFIG_MISSING",
      reason: "Required configuration missing or invalid",
      nextStep: "Set required environment values and retry.",
      detail,
    };
  }

  return {
    status: "UNKNOWN",
    reason: "Unclassified runtime failure",
    nextStep: "Run again with DIAG_VERBOSE=1 and inspect full error output.",
    detail,
  };
}

export async function withRetries<T>(
  fn: () => Promise<T>,
  opts: { retries: number; delayMs: number; retryOn: (error: unknown) => boolean }
): Promise<T> {
  let lastError: unknown;
  for (let i = 0; i <= opts.retries; i += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (i >= opts.retries || !opts.retryOn(error)) {
        throw error;
      }
      await sleep(opts.delayMs);
    }
  }
  throw lastError;
}

export function isTransientDnsError(error: unknown): boolean {
  const message = flattenErrorDetail(error).toLowerCase();
  return message.includes("eai_again") || message.includes("dns lookup timeout");
}

export async function checkDns(host: string): Promise<void> {
  await withTimeout(lookup(host), 2500, `DNS lookup timeout for ${host}`);
}

export async function checkTcp(host: string, port: number): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const socket = net.createConnection({ host, port });
    const onError = (error: Error) => {
      socket.destroy();
      reject(error);
    };

    socket.setTimeout(3000, () => {
      socket.destroy();
      reject(new Error(`TCP timeout for ${host}:${port}`));
    });

    socket.once("error", onError);
    socket.once("connect", () => {
      socket.destroy();
      resolve();
    });
  });
}

export function checkEnvVar(name: string): DiagnosticResult {
  const value = String(process.env[name] ?? "").trim();
  if (!value) {
    return {
      check: `${name} present`,
      status: "CONFIG_MISSING",
      reason: `${name} is not set`,
      nextStep: `Set ${name} in your runtime environment or .env.local`,
    };
  }

  return {
    check: `${name} present`,
    status: "OK",
    reason: "configured",
  };
}

export function checkVercelCli(): DiagnosticResult {
  const result = spawnSync("vercel", ["--version"], { stdio: "pipe", encoding: "utf8" });
  if (result.status === 0) {
    return {
      check: "Vercel CLI",
      status: "OK",
      reason: (result.stdout || "installed").trim(),
    };
  }

  return {
    check: "Vercel CLI",
    status: "CONFIG_MISSING",
    reason: "vercel CLI not found in PATH",
    nextStep: "Install Vercel CLI or run diagnostics through pnpm dlx vercel.",
    detail: (result.stderr || result.stdout || "not found").trim(),
  };
}

export function checkVercelLinkState(): DiagnosticResult {
  if (fs.existsSync(".vercel/project.json")) {
    return {
      check: "Vercel project link",
      status: "OK",
      reason: ".vercel/project.json exists",
    };
  }
  return {
    check: "Vercel project link",
    status: "CONFIG_MISSING",
    reason: "project is not linked (.vercel/project.json missing)",
    nextStep: "Run `vercel link` in this repo.",
  };
}

export async function withTimeout<T>(promise: Promise<T>, ms: number, timeoutReason: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(timeoutReason)), ms);
    promise
      .then((value) => {
        clearTimeout(timeout);
        resolve(value);
      })
      .catch((error) => {
        clearTimeout(timeout);
        reject(error);
      });
  });
}

export function printStructuredResults(title: string, results: DiagnosticResult[]): void {
  const hasFailures = results.some((r) => r.status !== "OK");
  const payload = {
    title,
    status: hasFailures ? "FAILED" : "OK",
    checks: results,
  };
  console.log(JSON.stringify(payload, null, 2));
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
