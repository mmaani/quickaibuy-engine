import dotenv from "dotenv";

const dotenvPath = process.env.DOTENV_CONFIG_PATH?.trim() || ".env.local";

let loaded = false;

export function loadRuntimeEnv() {
  if (loaded) return dotenvPath;
  dotenv.config({ path: dotenvPath });
  dotenv.config();
  loaded = true;
  return dotenvPath;
}

export function getRequiredDatabaseUrl() {
  loadRuntimeEnv();
  const connectionString = process.env.DATABASE_URL_DIRECT || process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      `Missing DATABASE_URL or DATABASE_URL_DIRECT. Set it in ${dotenvPath} or runtime env.`
    );
  }
  return connectionString;
}

export function getDotenvPath() {
  return dotenvPath;
}
