import { DB_TARGET_RULES } from "../../config/db-targets.mjs";
import {
  inferActiveEnvSource,
  loadRuntimeEnv,
  parseEnvFile,
  resolveRuntimeEnvPath,
} from "./envState.mjs";

function parseHost(connectionString) {
  if (!connectionString) return null;
  try {
    return new URL(connectionString).hostname || null;
  } catch {
    return null;
  }
}

function isTrue(value) {
  return String(value ?? "").trim().toLowerCase() === "true";
}

function classifyRuntimeEnvHint() {
  const appEnv = String(process.env.APP_ENV ?? "").trim().toLowerCase();
  if (appEnv === "production" || appEnv === "prod") return "PROD";
  if (appEnv === "preview" || appEnv === "staging" || appEnv === "stage") return "PREVIEW";
  if (appEnv === "development" || appEnv === "dev" || appEnv === "local") return "DEV";

  const vercelEnv = String(process.env.VERCEL_ENV ?? "").trim().toLowerCase();
  if (vercelEnv === "production") return "PROD";
  if (vercelEnv === "preview") return "PREVIEW";

  const nodeEnv = String(process.env.NODE_ENV ?? "").trim().toLowerCase();
  if (nodeEnv === "production") return "PROD";
  if (nodeEnv === "development") return "DEV";

  return null;
}

function scoreRule(rule, envSource, hosts) {
  let score = 0;
  const reasons = [];

  if (envSource && rule.envSourcePatterns.some((pattern) => pattern.test(envSource))) {
    score += 10;
    reasons.push(`env source matched ${rule.classification}`);
  }

  for (const host of hosts) {
    if (host && rule.hostPatterns.some((pattern) => pattern.test(host))) {
      score += 4;
      reasons.push(`db host matched ${rule.classification} (${host})`);
    }
  }

  return { score, reasons };
}

export function classifyDbTarget(input) {
  const envSource = input.envSource ?? null;
  const hosts = [input.databaseUrlHost, input.databaseUrlDirectHost].filter(Boolean);
  const runtimeEnvHint = classifyRuntimeEnvHint();
  let best = {
    classification: "UNKNOWN",
    score: 0,
    reasons: [],
  };

  for (const rule of DB_TARGET_RULES) {
    const scored = scoreRule(rule, envSource, hosts);
    if (scored.score > best.score) {
      best = {
        classification: rule.classification,
        score: scored.score,
        reasons: scored.reasons,
      };
    }
  }

  if (best.score === 0 && runtimeEnvHint) {
    return {
      classification: runtimeEnvHint,
      reason: `Runtime environment hint matched ${runtimeEnvHint}.`,
      reasons: [`runtime environment matched ${runtimeEnvHint}`],
    };
  }

  return {
    classification: best.classification,
    reason:
      best.reasons[0] ??
      "No known env-source or host pattern matched. Use .env.dev/.env.prod or update config/db-targets.mjs.",
    reasons: best.reasons,
  };
}

export function getMutationSafety(context) {
  const allowMutationScripts = isTrue(process.env.ALLOW_MUTATION_SCRIPTS);
  const allowProdDbMutation = isTrue(process.env.ALLOW_PROD_DB_MUTATION);
  const confirmProdDbTarget = String(process.env.CONFIRM_PROD_DB_TARGET ?? "").trim();

  if (context.classification === "PROD") {
    const allowed =
      allowMutationScripts && allowProdDbMutation && confirmProdDbTarget === "YES";
    return {
      allowed,
      classification: allowed ? "PROD_OVERRIDE_ACTIVE" : "PROD_BLOCKED",
      missing: [
        !allowMutationScripts ? "ALLOW_MUTATION_SCRIPTS=true" : null,
        !allowProdDbMutation ? "ALLOW_PROD_DB_MUTATION=true" : null,
        confirmProdDbTarget !== "YES" ? "CONFIRM_PROD_DB_TARGET=YES" : null,
      ].filter(Boolean),
    };
  }

  if (context.classification === "UNKNOWN") {
    return {
      allowed: false,
      classification: "UNKNOWN_BLOCKED",
      missing: ["Known DB target classification (DEV, PROD, or PREVIEW)"],
    };
  }

  return {
    allowed: allowMutationScripts,
    classification: allowMutationScripts ? "NON_PROD_GUARD_OPEN" : "NON_PROD_GUARDED",
    missing: allowMutationScripts ? [] : ["ALLOW_MUTATION_SCRIPTS=true"],
  };
}

export function getDbTargetContext(options = {}) {
  const envPath = options.envPath ?? resolveRuntimeEnvPath();
  if (options.loadEnv !== false) {
    loadRuntimeEnv();
  }

  const envSource = inferActiveEnvSource(envPath);
  const envValues =
    options.loadEnv === false ? parseEnvFile(envPath) : process.env;
  const databaseUrl = String(envValues.DATABASE_URL ?? "").trim() || null;
  const databaseUrlDirect = String(envValues.DATABASE_URL_DIRECT ?? "").trim() || null;
  const databaseUrlHost = parseHost(databaseUrl);
  const databaseUrlDirectHost = parseHost(databaseUrlDirect);
  const classified = classifyDbTarget({
    envSource,
    databaseUrlHost,
    databaseUrlDirectHost,
  });
  const context = {
    envPath,
    envSource,
    databaseUrlHost,
    databaseUrlDirectHost,
    hasDatabaseUrl: Boolean(databaseUrl),
    hasDatabaseUrlDirect: Boolean(databaseUrlDirect),
    classification: classified.classification,
    classificationReason: classified.reason,
    classificationReasons: classified.reasons,
  };

  return {
    ...context,
    mutationSafety: getMutationSafety(context),
  };
}

export function formatDbTargetBanner(context) {
  const host = context.databaseUrlDirectHost ?? context.databaseUrlHost ?? "missing";
  return `DB TARGET: ${context.classification} | host=${host} | env_source=${context.envSource}`;
}

export function printDbTargetBanner(context) {
  console.log(formatDbTargetBanner(context));
}

export function assertDbClassification(expected, context) {
  const allowedExpected = Array.isArray(expected) ? expected : [expected];
  if (allowedExpected.includes(context.classification)) return;
  throw new Error(
    [
      `DB target assertion failed: expected ${allowedExpected.join(" or ")}, got ${context.classification}.`,
      formatDbTargetBanner(context),
      `Reason: ${context.classificationReason}`,
    ].join(" ")
  );
}
