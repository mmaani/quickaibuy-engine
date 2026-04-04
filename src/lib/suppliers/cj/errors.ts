import type { CjErrorCategory, CjWrappedResponse } from "./types";

const CATEGORY_BY_CODE = new Map<number, CjErrorCategory>([
  [1600001, "AUTH_INVALID"],
  [1600002, "AUTH_INVALID"],
  [1600003, "REFRESH_INVALID"],
  [1600031, "AUTH_INVALID"],
  [1600100, "PARAM_INVALID"],
  [1600200, "RATE_LIMITED"],
  [1600201, "QUOTA_EXHAUSTED"],
  [1600300, "UPSTREAM_UNAVAILABLE"],
  [1603000, "ORDER_CREATE_FAILED"],
  [1603001, "ORDER_CREATE_FAILED"],
  [1603003, "ORDER_DUPLICATE"],
  [1603102, "INVENTORY_FAILED"],
  [1605001, "LOGISTIC_INVALID"],
  [1606000, "WEBHOOK_INVALID"],
  [1606001, "WEBHOOK_INVALID"],
  [1607000, "WEBHOOK_INVALID"],
  [1607001, "WEBHOOK_INVALID"],
  [1607002, "WEBHOOK_INVALID"],
]);

export class CjError extends Error {
  readonly status: number;
  readonly code: number | null;
  readonly requestId: string | null;
  readonly category: CjErrorCategory;
  readonly retryable: boolean;
  readonly operation: string;
  readonly details: unknown;

  constructor(input: {
    message: string;
    status: number;
    code: number | null;
    requestId?: string | null;
    category: CjErrorCategory;
    retryable: boolean;
    operation: string;
    details?: unknown;
  }) {
    super(input.message);
    this.name = "CjError";
    this.status = input.status;
    this.code = input.code;
    this.requestId = input.requestId ?? null;
    this.category = input.category;
    this.retryable = input.retryable;
    this.operation = input.operation;
    this.details = input.details ?? null;
  }
}

export function isCjWrappedSuccess<T>(wrapped: CjWrappedResponse<T>): boolean {
  if (wrapped.success === false || wrapped.result === false) return false;
  if (typeof wrapped.code === "number") return wrapped.code === 200 || wrapped.code === 0;
  return true;
}

export function mapCjErrorCategory(input: {
  status: number;
  code: number | null;
  message?: string | null;
}): CjErrorCategory {
  if (input.status === 429) return "RATE_LIMITED";
  if (input.status >= 500) return "UPSTREAM_UNAVAILABLE";
  if (input.code != null && CATEGORY_BY_CODE.has(input.code)) {
    return CATEGORY_BY_CODE.get(input.code)!;
  }

  const message = String(input.message ?? "").toLowerCase();
  if (message.includes("quota")) return "QUOTA_EXHAUSTED";
  if (message.includes("rate")) return "RATE_LIMITED";
  if (message.includes("inventory")) return "INVENTORY_FAILED";
  if (message.includes("logistic")) return "LOGISTIC_INVALID";
  if (message.includes("param")) return "PARAM_INVALID";
  if (message.includes("token")) return "AUTH_INVALID";
  return "UNKNOWN";
}

export function isCjAuthFailure(status: number, code: number | null): boolean {
  return status === 401 || status === 403 || code === 1600001 || code === 1600002 || code === 1600031;
}

export function isCjRefreshFailure(code: number | null): boolean {
  return code === 1600003;
}

export function isCjRateOrQuotaFailure(error: unknown): boolean {
  return (
    error instanceof CjError &&
    (error.category === "RATE_LIMITED" || error.category === "QUOTA_EXHAUSTED")
  );
}

export function buildCjError<T>(input: {
  operation: string;
  status: number;
  wrapped: CjWrappedResponse<T>;
  details?: unknown;
}): CjError {
  const code = typeof input.wrapped.code === "number" ? input.wrapped.code : null;
  const category = mapCjErrorCategory({
    status: input.status,
    code,
    message: input.wrapped.message ?? null,
  });
  const retryable =
    category === "RATE_LIMITED" ||
    category === "QUOTA_EXHAUSTED" ||
    category === "UPSTREAM_UNAVAILABLE";

  return new CjError({
    message: `${input.operation} failed: ${category}${code != null ? ` (${code})` : ""}${input.wrapped.message ? ` ${input.wrapped.message}` : ""}`,
    status: input.status,
    code,
    requestId: typeof input.wrapped.requestId === "string" ? input.wrapped.requestId : null,
    category,
    retryable,
    operation: input.operation,
    details: input.details ?? input.wrapped.data ?? null,
  });
}
