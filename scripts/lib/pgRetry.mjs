import dns from "node:dns/promises";
import net from "node:net";
import pg from "pg";

const { Client } = pg;

const RETRYABLE_CODES = new Set([
  "EAI_AGAIN",
  "ENOTFOUND",
  "ECONNRESET",
  "ECONNREFUSED",
  "ETIMEDOUT",
  "57P01",
  "53300",
]);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeDatabaseUrl(connectionString) {
  if (!connectionString) return connectionString;

  try {
    const parsed = new URL(connectionString);
    const sslmode = parsed.searchParams.get("sslmode")?.toLowerCase() ?? null;
    if (!sslmode) {
      parsed.searchParams.set("sslmode", "require");
      return parsed.toString();
    }
    if (sslmode === "prefer" || sslmode === "require" || sslmode === "verify-ca") {
      parsed.searchParams.set("sslmode", "verify-full");
      return parsed.toString();
    }
    return parsed.toString();
  } catch {
    return connectionString;
  }
}

function parseTargetUrl(connectionString) {
  try {
    return new URL(connectionString);
  } catch {
    return null;
  }
}

function redactTarget(target) {
  const parsed = parseTargetUrl(target.connectionString);
  if (!parsed) {
    return {
      label: target.label,
      host: null,
      port: null,
      database: null,
    };
  }

  return {
    label: target.label,
    host: parsed.hostname || null,
    port: parsed.port ? Number(parsed.port) : 5432,
    database: parsed.pathname?.replace(/^\//, "") || null,
  };
}

export function getPgTargets(options = {}) {
  const preferred = [];

  if (!options.directOnly && process.env.DATABASE_URL) {
    preferred.push({ label: "pooled", connectionString: process.env.DATABASE_URL });
  }
  if (process.env.DATABASE_URL_DIRECT) {
    preferred.push({ label: "direct", connectionString: process.env.DATABASE_URL_DIRECT });
  }
  if (options.directOnly && process.env.DATABASE_URL) {
    preferred.push({ label: "pooled", connectionString: process.env.DATABASE_URL });
  }

  const deduped = [];
  const seen = new Set();
  for (const target of preferred) {
    if (!target.connectionString) continue;
    const normalized = normalizeDatabaseUrl(target.connectionString);
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    deduped.push({ ...target, connectionString: normalized });
  }

  if (!deduped.length) {
    throw new Error("Missing DATABASE_URL or DATABASE_URL_DIRECT.");
  }

  return deduped;
}

export function classifyPgError(error) {
  const code = error?.code ? String(error.code) : "";
  const message = error instanceof Error ? error.message : String(error ?? "");

  if (code === "EAI_AGAIN" || code === "ENOTFOUND") return "dns";
  if (code === "ECONNREFUSED" || code === "ECONNRESET" || code === "ETIMEDOUT") return "tcp";
  if (code === "28P01") return "auth";
  if (
    /self[- ]signed|certificate|tls|ssl|hostname/i.test(message) ||
    code === "DEPTH_ZERO_SELF_SIGNED_CERT"
  ) {
    return "tls";
  }
  if (code.startsWith("57") || code === "53300") return "postgres";
  return "unknown";
}

function isRetryablePgError(error) {
  const code = error?.code ? String(error.code) : "";
  const kind = classifyPgError(error);
  return RETRYABLE_CODES.has(code) || kind === "dns" || kind === "tcp" || kind === "postgres";
}

function buildAttemptError(error, target, attempt, attempts) {
  return {
    target: redactTarget(target),
    attempt,
    attempts,
    code: error?.code ?? null,
    kind: classifyPgError(error),
    message: error instanceof Error ? error.message : String(error),
  };
}

export async function withPgClient(task, options = {}) {
  const targets = getPgTargets(options);
  const attempts = Number(options.attempts ?? process.env.PG_RETRY_ATTEMPTS ?? 4);
  const baseDelayMs = Number(options.baseDelayMs ?? process.env.PG_RETRY_BASE_DELAY_MS ?? 750);
  const errors = [];

  for (let attempt = 1; attempt <= attempts; attempt++) {
    for (const target of targets) {
      const client = new Client({
        connectionString: target.connectionString,
        ssl: process.env.PGSSLMODE === "disable" ? false : { rejectUnauthorized: true },
      });

      try {
        await client.connect();
        return await task(client, { target: redactTarget(target), attempt, attempts });
      } catch (error) {
        const detail = buildAttemptError(error, target, attempt, attempts);
        errors.push(detail);

        if (!isRetryablePgError(error)) {
          const failure = new Error(`Database connection failed (${detail.kind}) via ${detail.target.label}.`);
          failure.cause = error;
          failure.pgDiagnostics = errors;
          throw failure;
        }

        console.warn("[pg-retry] transient database error", detail);
      } finally {
        try {
          await client.end();
        } catch {}
      }
    }

    if (attempt < attempts) {
      await sleep(baseDelayMs * attempt);
    }
  }

  const failure = new Error("Database operation failed after retrying pooled/direct targets.");
  failure.pgDiagnostics = errors;
  throw failure;
}

function tcpProbeAddress(address, family, port, timeoutMs) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: address, family, port });
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
    socket.on("connect", () => finish({ ok: true, address, family }));
    socket.on("timeout", () => finish({ ok: false, code: "ETIMEDOUT", message: "TCP connection timed out" }));
    socket.on("error", (error) =>
      finish({
        ok: false,
        address,
        family,
        code: error?.code ?? null,
        message: error instanceof Error ? error.message : String(error),
      })
    );
  });
}

async function tcpProbe(host, port, timeoutMs) {
  let addresses;
  try {
    addresses = await dns.lookup(host, { all: true });
  } catch (error) {
    return {
      ok: false,
      code: error?.code ?? null,
      message: error instanceof Error ? error.message : String(error),
      attempts: [],
    };
  }

  const attempts = [];
  for (const entry of addresses) {
    const family = entry.family ?? (entry.address.includes(":") ? 6 : 4);
    const result = await tcpProbeAddress(entry.address, family, port, timeoutMs);
    attempts.push(result);
    if (result.ok) {
      return {
        ...result,
        attempts,
      };
    }
  }

  const lastFailure = attempts.at(-1) ?? null;
  return {
    ok: false,
    code: lastFailure?.code ?? null,
    message: lastFailure?.message ?? "TCP connection failed",
    attempts,
  };
}

export async function diagnosePgConnectivity(options = {}) {
  const timeoutMs = Number(options.timeoutMs ?? process.env.PG_CONNECT_TIMEOUT_MS ?? 5000);
  const targets = getPgTargets(options);
  const results = [];

  for (const target of targets) {
    const redacted = redactTarget(target);
    const parsed = parseTargetUrl(target.connectionString);
    const host = parsed?.hostname ?? null;
    const port = parsed?.port ? Number(parsed.port) : 5432;

    const result = {
      ...redacted,
      dns_ok: false,
      dns_addresses: [],
      tcp_ok: false,
      pg_ok: false,
      pg_error_kind: null,
      pg_error_code: null,
      pg_error_message: null,
    };

    if (!host) {
      result.pg_error_kind = "config";
      result.pg_error_message = "Invalid connection string host";
      results.push(result);
      continue;
    }

    try {
      const addresses = await dns.lookup(host, { all: true });
      result.dns_ok = addresses.length > 0;
      result.dns_addresses = addresses.map((entry) => entry.address);
    } catch (error) {
      result.pg_error_kind = "dns";
      result.pg_error_code = error?.code ?? null;
      result.pg_error_message = error instanceof Error ? error.message : String(error);
      results.push(result);
      continue;
    }

    const tcp = await tcpProbe(host, port, timeoutMs);
    result.tcp_ok = tcp.ok;
    result.tcp_attempts = tcp.attempts ?? [];
    if (!tcp.ok) {
      result.pg_error_kind = "tcp";
      result.pg_error_code = tcp.code ?? null;
      result.pg_error_message = tcp.message ?? "TCP connection failed";
      results.push(result);
      continue;
    }

    try {
      await withPgClient(
        async (client) => {
          await client.query("select 1 as ok");
        },
        {
          ...options,
          attempts: 1,
          directOnly: target.label === "direct",
        }
      );
      result.pg_ok = true;
    } catch (error) {
      const diagnostics = Array.isArray(error?.pgDiagnostics) ? error.pgDiagnostics : [];
      const last = diagnostics.find((entry) => entry?.target?.label === target.label) ?? diagnostics.at(-1) ?? null;
      result.pg_error_kind = last?.kind ?? classifyPgError(error?.cause ?? error);
      result.pg_error_code = last?.code ?? error?.cause?.code ?? error?.code ?? null;
      result.pg_error_message =
        last?.message ??
        (error?.cause instanceof Error ? error.cause.message : error instanceof Error ? error.message : String(error));
    }

    results.push(result);
  }

  return {
    env: {
      has_database_url: Boolean(process.env.DATABASE_URL),
      has_database_url_direct: Boolean(process.env.DATABASE_URL_DIRECT),
      pgsslmode: process.env.PGSSLMODE ?? null,
    },
    targets: results,
  };
}
