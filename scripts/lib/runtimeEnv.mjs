import { getLoadedEnvPath, loadRuntimeEnv as loadSelectedRuntimeEnv } from "./envState.mjs";

export function getRequiredDatabaseUrl() {
  loadRuntimeEnv();
  const connectionString = process.env.DATABASE_URL_DIRECT || process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      `Missing DATABASE_URL or DATABASE_URL_DIRECT. Set it in ${getDotenvPath()} or runtime env.`
    );
  }
  return connectionString;
}

export function getDotenvPath() {
  return getLoadedEnvPath();
}

export function loadRuntimeEnv() {
  return loadSelectedRuntimeEnv();
}
