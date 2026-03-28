import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";

export const ACTIVE_ENV_FILE = ".env";
export const ACTIVE_ENV_METADATA_FILE = ".env.active.json";
export const ACTIVE_ENV_LOCAL_MIRROR_FILE = ".env.local";
export const DEV_ENV_FILE = ".env.dev";
export const PROD_ENV_FILE = ".env.prod";
export const LEGACY_DEV_ENV_FILE = ".env.local";
export const LEGACY_PROD_ENV_FILE = ".env.vercel";

let loadedPath = null;

function fileExists(filePath) {
  return Boolean(filePath) && fs.existsSync(filePath);
}

function normalizePath(filePath) {
  if (!filePath) return null;
  return path.normalize(filePath);
}

export function resolveRuntimeEnvPath() {
  const explicit = process.env.DOTENV_CONFIG_PATH?.trim();
  if (explicit) return explicit;
  if (fileExists(ACTIVE_ENV_FILE)) return ACTIVE_ENV_FILE;
  if (fileExists(LEGACY_DEV_ENV_FILE)) return LEGACY_DEV_ENV_FILE;
  return ACTIVE_ENV_FILE;
}

export function readEnvFile(filePath) {
  if (!fileExists(filePath)) return null;
  return fs.readFileSync(filePath, "utf8");
}

export function parseEnvFile(filePath) {
  const raw = readEnvFile(filePath);
  return raw == null ? {} : dotenv.parse(raw);
}

export function readActiveEnvMetadata() {
  if (!fileExists(ACTIVE_ENV_METADATA_FILE)) return null;
  try {
    const raw = fs.readFileSync(ACTIVE_ENV_METADATA_FILE, "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function inferActiveEnvSource(envPath = resolveRuntimeEnvPath()) {
  if (process.env.DOTENV_CONFIG_PATH?.trim()) {
    return normalizePath(process.env.DOTENV_CONFIG_PATH.trim());
  }

  const normalizedPath = normalizePath(envPath);
  if (normalizedPath !== ACTIVE_ENV_FILE) {
    return normalizedPath;
  }

  const metadata = readActiveEnvMetadata();
  if (metadata?.source) {
    return normalizePath(metadata.source);
  }

  const activeRaw = readEnvFile(ACTIVE_ENV_FILE);
  if (activeRaw != null) {
    for (const candidate of [DEV_ENV_FILE, PROD_ENV_FILE, LEGACY_DEV_ENV_FILE, LEGACY_PROD_ENV_FILE]) {
      const candidateRaw = readEnvFile(candidate);
      if (candidateRaw != null && candidateRaw === activeRaw) {
        return candidate;
      }
    }
  }

  return normalizedPath;
}

export function writeActiveEnvMetadata(source) {
  fs.writeFileSync(
    ACTIVE_ENV_METADATA_FILE,
    JSON.stringify(
      {
        source,
        mirror: ACTIVE_ENV_LOCAL_MIRROR_FILE,
        updatedAt: new Date().toISOString(),
      },
      null,
      2
    ) + "\n",
    "utf8"
  );
}

export function switchActiveEnv(target) {
  const sourceFile = target === "dev" ? DEV_ENV_FILE : PROD_ENV_FILE;
  if (!fileExists(sourceFile)) {
    throw new Error(`Missing ${sourceFile}. Create it before switching active env.`);
  }

  fs.copyFileSync(sourceFile, ACTIVE_ENV_FILE);
  // Next.js always loads .env.local ahead of .env, so keep a mirror in sync.
  fs.copyFileSync(sourceFile, ACTIVE_ENV_LOCAL_MIRROR_FILE);
  writeActiveEnvMetadata(sourceFile);
  loadedPath = null;
  return sourceFile;
}

export function loadRuntimeEnv() {
  const envPath = resolveRuntimeEnvPath();
  if (loadedPath === envPath) return envPath;
  if (fileExists(envPath)) {
    dotenv.config({ path: envPath, override: true });
  }
  loadedPath = envPath;
  return envPath;
}

export function getLoadedEnvPath() {
  return loadedPath ?? resolveRuntimeEnvPath();
}
