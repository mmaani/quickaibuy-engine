import fs from "node:fs";
import path from "node:path";
import dns from "node:dns/promises";
import net from "node:net";
import { diagnosePgConnectivity } from "./pgRetry.mjs";
import { getDbTargetContext } from "./dbTarget.mjs";
import {
  ACTIVE_ENV_FILE,
  ACTIVE_ENV_LOCAL_MIRROR_FILE,
  ACTIVE_ENV_METADATA_FILE,
  DEV_ENV_FILE,
  LEGACY_PROD_ENV_FILE,
  PROD_ENV_FILE,
  loadRuntimeEnv,
} from "./envState.mjs";

const FILE_POLICY = {
  canonical: [".env", ".env.active.json", ".env.dev", ".env.prod"],
  compatibility: [".env.local"],
  compatibilitySensitive: [
    ".env.vercel",
    "codex.secrets.private",
    "codex.dev.secrets.private",
    "codex.prod.secrets.private",
  ],
};

function exists(relPath) {
  return fs.existsSync(path.resolve(relPath));
}

function truthyEnv(key) {
  return Boolean(String(process.env[key] ?? "").trim());
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isTransientNetworkError(error) {
  const code = error?.code ? String(error.code) : "";
  const message = error instanceof Error ? error.message : String(error ?? "");
  return (
    code === "EAI_AGAIN" ||
    code === "ENOTFOUND" ||
    code === "ECONNREFUSED" ||
    code === "ECONNRESET" ||
    code === "ETIMEDOUT" ||
    code === "ENETUNREACH" ||
    /\b(EAI_AGAIN|ENOTFOUND|ECONNREFUSED|ECONNRESET|ETIMEDOUT|ENETUNREACH)\b/i.test(message)
  );
}

async function lookupHost(host) {
  const attempts = Number(process.env.RUNTIME_DNS_RETRY_ATTEMPTS ?? 3);
  const baseDelayMs = Number(process.env.RUNTIME_DNS_RETRY_DELAY_MS ?? 400);
  let lastError = null;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const addresses = await dns.lookup(host, { all: true });
      return {
        ok: true,
        addresses: addresses.map((entry) => entry.address),
        family: addresses.map((entry) => entry.family),
      };
    } catch (error) {
      lastError = error;
      if (!isTransientNetworkError(error) || attempt >= attempts) {
        break;
      }
      await sleep(baseDelayMs * attempt);
    }
  }

  return {
    ok: false,
    code: lastError?.code ?? null,
    message: lastError instanceof Error ? lastError.message : String(lastError),
    addresses: [],
    family: [],
  };
}

function tcpProbe(host, port, timeoutMs = 5000) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port });
    let settled = false;

    const finish = (result) => {
      if (settled) return;
      settled = true;
      try {
        socket.destroy();
      } catch {}
      resolve(result);
    };

    socket.setTimeout(timeoutMs);
    socket.on("connect", () => finish({ ok: true }));
    socket.on("timeout", () => finish({ ok: false, code: "ETIMEDOUT", message: "TCP connection timed out" }));
    socket.on("error", (error) =>
      finish({
        ok: false,
        code: error?.code ?? null,
        message: error instanceof Error ? error.message : String(error),
      })
    );
  });
}

async function diagnoseRedisConnectivity(options = {}) {
  const redisUrl = String(process.env.REDIS_URL ?? "").trim();
  if (!redisUrl) {
    return {
      configured: false,
      host: null,
      port: null,
      dns_ok: false,
      dns_addresses: [],
      tcp_ok: false,
      error_kind: "missing",
      error_code: "MISSING_REDIS_URL",
      error_message: "REDIS_URL is not configured",
    };
  }

  let parsed;
  try {
    parsed = new URL(redisUrl);
  } catch (error) {
    return {
      configured: true,
      host: null,
      port: null,
      dns_ok: false,
      dns_addresses: [],
      tcp_ok: false,
      error_kind: "parse",
      error_code: "INVALID_REDIS_URL",
      error_message: error instanceof Error ? error.message : String(error),
    };
  }

  const host = parsed.hostname || null;
  const port = parsed.port ? Number(parsed.port) : 6379;
  if (!host) {
    return {
      configured: true,
      host: null,
      port,
      dns_ok: false,
      dns_addresses: [],
      tcp_ok: false,
      error_kind: "parse",
      error_code: "INVALID_REDIS_HOST",
      error_message: "REDIS_URL does not include a hostname",
    };
  }

  const dnsResult = await lookupHost(host);
  const tcpResult = dnsResult.ok ? await tcpProbe(host, port, Number(options.timeoutMs ?? 5000)) : { ok: false };

  return {
    configured: true,
    host,
    port,
    dns_ok: Boolean(dnsResult.ok),
    dns_addresses: dnsResult.addresses,
    tcp_ok: Boolean(tcpResult.ok),
    error_kind: dnsResult.ok ? (tcpResult.ok ? null : "tcp") : "dns",
    error_code: dnsResult.ok ? (tcpResult.ok ? null : tcpResult.code ?? null) : dnsResult.code ?? null,
    error_message: dnsResult.ok ? (tcpResult.ok ? null : tcpResult.message ?? null) : dnsResult.message ?? null,
  };
}

export async function getRuntimeDiagnostics(options = {}) {
  const dotenvPath = loadRuntimeEnv();
  const dbTarget = getDbTargetContext({ loadEnv: true, envPath: dotenvPath });
  const includeConnectivity = options.includeConnectivity !== false;
  const sensitiveFilePolicy = {
    canonical: FILE_POLICY.canonical.map((file) => ({ file, present: exists(file) })),
    compatibility: FILE_POLICY.compatibility.map((file) => ({ file, present: exists(file) })),
    compatibilitySensitive: FILE_POLICY.compatibilitySensitive.map((file) => ({
      file,
      present: exists(file),
    })),
    operatingBranch: /** @type {"main"} */ ("main"),
    canonicalFullCycleCommand: /** @type {"pnpm ops:full-cycle"} */ ("pnpm ops:full-cycle"),
  };
  const sensitiveFilesPresent = sensitiveFilePolicy.compatibilitySensitive
    .filter((item) => item.present)
    .map((item) => item.file);

  return {
    dotenvPath,
    envSource: dbTarget.envSource,
    dbTargetClassification: dbTarget.classification,
    dbTargetReason: dbTarget.classificationReason,
    hasDatabaseUrl: dbTarget.hasDatabaseUrl,
    hasDatabaseUrlDirect: dbTarget.hasDatabaseUrlDirect,
    hasEbayClientId: truthyEnv("EBAY_CLIENT_ID"),
    hasEbayClientSecret: truthyEnv("EBAY_CLIENT_SECRET"),
    hasRedisUrl: truthyEnv("REDIS_URL"),
    activeEnvFiles: {
      active: exists(ACTIVE_ENV_FILE),
      activeMetadata: exists(ACTIVE_ENV_METADATA_FILE),
      localMirror: exists(ACTIVE_ENV_LOCAL_MIRROR_FILE),
      devSource: exists(DEV_ENV_FILE),
      prodSource: exists(PROD_ENV_FILE),
      legacyProdSource: exists(LEGACY_PROD_ENV_FILE),
    },
    sensitiveFilePolicy,
    sensitiveFilesPresent,
    connectivity: includeConnectivity
      ? {
          postgres: await diagnosePgConnectivity({ attempts: 1 }),
          redis: await diagnoseRedisConnectivity({ timeoutMs: 5000 }),
        }
      : null,
  };
}
