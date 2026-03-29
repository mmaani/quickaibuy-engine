import fs from "node:fs";
import path from "node:path";
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

const SENSITIVE_REPO_FILES = [
  ".env.prod",
  ".env.vercel",
  "codex.secrets.private",
  "codex.dev.secrets.private",
  "codex.prod.secrets.private",
];

function exists(relPath) {
  return fs.existsSync(path.resolve(relPath));
}

function truthyEnv(key) {
  return Boolean(String(process.env[key] ?? "").trim());
}

export async function getRuntimeDiagnostics(options = {}) {
  const dotenvPath = loadRuntimeEnv();
  const dbTarget = getDbTargetContext({ loadEnv: true, envPath: dotenvPath });
  const includeConnectivity = options.includeConnectivity !== false;

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
    sensitiveFilesPresent: SENSITIVE_REPO_FILES.filter((file) => exists(file)),
    connectivity: includeConnectivity ? await diagnosePgConnectivity({ attempts: 1 }) : null,
  };
}
