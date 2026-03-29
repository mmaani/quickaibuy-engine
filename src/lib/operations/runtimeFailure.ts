export type RuntimeFailureClassification = {
  reasonCode: string;
  class: "infrastructure" | "safety" | "business_data" | "unknown";
  service: "db" | "redis" | "runtime" | "unknown";
  retryable: boolean;
  message: string;
};

function normalizeMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error ?? "Unknown error");
}

export function classifyRuntimeFailure(error: unknown): RuntimeFailureClassification {
  const message = normalizeMessage(error);
  const upper = message.toUpperCase();
  const infraDns = /\b(EAI_AGAIN|ENOTFOUND)\b/i.test(message);
  const infraConnect = /\b(ECONNREFUSED|ECONNRESET|ETIMEDOUT|ENETUNREACH)\b/i.test(message);
  const redisSignal = /UPSTASH|REDIS/i.test(upper);
  const dbSignal =
    /NEON|POSTGRES|DATABASE_URL|FAILED QUERY:|INFORMATION_SCHEMA|PG_/i.test(upper) || !redisSignal;

  if (infraDns && redisSignal) {
    return {
      reasonCode: "INFRA_REDIS_DNS_FAILURE",
      class: "infrastructure",
      service: "redis",
      retryable: true,
      message,
    };
  }

  if (infraDns && dbSignal) {
    return {
      reasonCode: "INFRA_DB_DNS_FAILURE",
      class: "infrastructure",
      service: "db",
      retryable: true,
      message,
    };
  }

  if (infraConnect && redisSignal) {
    return {
      reasonCode: "INFRA_REDIS_CONNECTIVITY_FAILURE",
      class: "infrastructure",
      service: "redis",
      retryable: true,
      message,
    };
  }

  if (infraConnect && dbSignal) {
    return {
      reasonCode: "INFRA_DB_CONNECTIVITY_FAILURE",
      class: "infrastructure",
      service: "db",
      retryable: true,
      message,
    };
  }

  if (/FAILED QUERY:/i.test(message)) {
    return {
      reasonCode: "INFRA_DB_QUERY_FAILURE",
      class: "infrastructure",
      service: "db",
      retryable: true,
      message,
    };
  }

  if (/PAUSE_|SPIKE|EMERGENCY_READ_ONLY|BLOCKED/i.test(upper)) {
    return {
      reasonCode: "SAFETY_BLOCK",
      class: "safety",
      service: "runtime",
      retryable: false,
      message,
    };
  }

  if (/MISSING_|STALE_|LOW STOCK|AVAILABILITY NOT CONFIRMED|RESTRICTED TITLE|MANUAL REVIEW/i.test(upper)) {
    return {
      reasonCode: "BUSINESS_DATA_BLOCK",
      class: "business_data",
      service: "runtime",
      retryable: false,
      message,
    };
  }

  return {
    reasonCode: upper.replace(/\s+/g, "_").slice(0, 120) || "UNKNOWN_RUNTIME_FAILURE",
    class: "unknown",
    service: "unknown",
    retryable: false,
    message,
  };
}
