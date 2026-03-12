type RuntimeEnv = "production" | "preview" | "development";

function normalizeRuntimeEnv(): RuntimeEnv {
  const appEnv = String(process.env.APP_ENV ?? "").trim().toLowerCase();
  if (appEnv === "production" || appEnv === "prod") return "production";
  if (appEnv === "preview" || appEnv === "staging" || appEnv === "stage") return "preview";
  if (appEnv === "development" || appEnv === "dev" || appEnv === "local") return "development";

  const vercelEnv = String(process.env.VERCEL_ENV ?? "").trim().toLowerCase();
  if (vercelEnv === "production") return "production";
  if (vercelEnv === "preview") return "preview";

  const nodeEnv = String(process.env.NODE_ENV ?? "").trim().toLowerCase();
  if (nodeEnv === "production") return "production";

  return "development";
}

export function resolveBullPrefix(): string {
  const explicit = String(process.env.BULL_PREFIX ?? "").trim();
  if (explicit) return explicit;

  const env = normalizeRuntimeEnv();
  if (env === "production") return "qaib-prod";
  if (env === "preview") return "qaib-preview";
  return "qaib-dev";
}

export function resolveJobsQueueName(): string {
  const explicit = String(process.env.JOBS_QUEUE_NAME ?? "").trim();
  return explicit || "jobs";
}
