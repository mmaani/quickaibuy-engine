import fs from "node:fs";
import dotenv from "dotenv";

const ACTIVE_ENV_FILE = ".env";
const LEGACY_LOCAL_ENV_FILE = ".env.local";

let loadedPath: string | null = null;

function fileExists(filePath: string): boolean {
  return Boolean(filePath) && fs.existsSync(filePath);
}

export function resolveRuntimeEnvPath(): string {
  const explicit = String(process.env.DOTENV_CONFIG_PATH ?? "").trim();
  if (explicit) return explicit;
  if (fileExists(ACTIVE_ENV_FILE)) return ACTIVE_ENV_FILE;
  if (fileExists(LEGACY_LOCAL_ENV_FILE)) return LEGACY_LOCAL_ENV_FILE;
  return ACTIVE_ENV_FILE;
}

export function loadRuntimeEnv(): string {
  const envPath = resolveRuntimeEnvPath();
  if (loadedPath === envPath) return envPath;
  if (fileExists(envPath)) {
    dotenv.config({ path: envPath, override: true });
  }
  loadedPath = envPath;
  return envPath;
}

export function getLoadedRuntimeEnvPath(): string {
  return loadedPath ?? resolveRuntimeEnvPath();
}
