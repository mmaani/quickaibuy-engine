export type RuntimeEnv = "production" | "preview" | "development";

export type QueueNamespaceDiagnostics = {
  environment: RuntimeEnv;
  bullPrefix: string;
  jobsQueueName: string;
  explicitBullPrefix: boolean;
  explicitJobsQueueName: boolean;
};

const PROD_PREFIX = "qaib-prod";
const PROD_QUEUE = "jobs-prod";
const DEV_PREFIX = "qaib-dev";
const DEV_QUEUE = "jobs-dev";
const PREVIEW_PREFIX = "qaib-preview";
const PREVIEW_QUEUE = "jobs-preview";

function classifyRuntimeEnv(): RuntimeEnv {
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


function isBuildPhase(): boolean {
  return String(process.env.NEXT_PHASE ?? "").trim() === "phase-production-build";
}

function defaultPrefixForEnv(environment: RuntimeEnv): string {
  if (environment === "production") return PROD_PREFIX;
  if (environment === "preview") return PREVIEW_PREFIX;
  return DEV_PREFIX;
}

function defaultJobsQueueForEnv(environment: RuntimeEnv): string {
  if (environment === "production") return PROD_QUEUE;
  if (environment === "preview") return PREVIEW_QUEUE;
  return DEV_QUEUE;
}

export function resolveBullPrefix(): string {
  const explicit = String(process.env.BULL_PREFIX ?? "").trim();
  if (explicit) return explicit;
  return defaultPrefixForEnv(classifyRuntimeEnv());
}

export function resolveJobsQueueName(): string {
  const explicit = String(process.env.JOBS_QUEUE_NAME ?? "").trim();
  if (explicit) return explicit;
  return defaultJobsQueueForEnv(classifyRuntimeEnv());
}

export function getQueueNamespaceDiagnostics(): QueueNamespaceDiagnostics {
  return {
    environment: classifyRuntimeEnv(),
    bullPrefix: resolveBullPrefix(),
    jobsQueueName: resolveJobsQueueName(),
    explicitBullPrefix: Boolean(String(process.env.BULL_PREFIX ?? "").trim()),
    explicitJobsQueueName: Boolean(String(process.env.JOBS_QUEUE_NAME ?? "").trim()),
  };
}

export function assertSafeQueueNamespace(context: string): QueueNamespaceDiagnostics {
  const diagnostics = getQueueNamespaceDiagnostics();

  if (diagnostics.environment === "production") {
    if (isBuildPhase() && !diagnostics.explicitBullPrefix) {
      return diagnostics;
    }
    if (!diagnostics.explicitBullPrefix) {
      throw new Error(
        `[${context}] BULL_PREFIX must be explicitly set in production (expected '${PROD_PREFIX}').`
      );
    }
    if (diagnostics.bullPrefix !== PROD_PREFIX) {
      throw new Error(
        `[${context}] Unsafe BULL_PREFIX '${diagnostics.bullPrefix}' for production. Expected '${PROD_PREFIX}'.`
      );
    }
    if (diagnostics.jobsQueueName !== PROD_QUEUE) {
      throw new Error(
        `[${context}] Unsafe JOBS_QUEUE_NAME '${diagnostics.jobsQueueName}' for production. Expected '${PROD_QUEUE}'.`
      );
    }
  }

  if (diagnostics.environment === "development") {
    if (diagnostics.bullPrefix === PROD_PREFIX || diagnostics.jobsQueueName === PROD_QUEUE) {
      throw new Error(
        `[${context}] Development runtime cannot use production queue namespace (${PROD_PREFIX}/${PROD_QUEUE}).`
      );
    }
  }

  return diagnostics;
}
