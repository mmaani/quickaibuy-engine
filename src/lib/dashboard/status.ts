import { normalizeMarketplaceKey } from "@/lib/marketplaces/normalizeMarketplaceKey";
import { canonicalSupplierKey } from "@/lib/suppliers/intelligence";

export type DashboardMetricState =
  | "FRESH_HEALTHY"
  | "FRESH_DEGRADED"
  | "STALE"
  | "PARTIAL_FAILURE"
  | "TOTAL_FAILURE"
  | "UNKNOWN"
  | "ZERO_VALID";

export type DashboardRenderState =
  | "HEALTHY"
  | "DEGRADED"
  | "STALE"
  | "PARTIAL_FAILURE"
  | "QUERY_FAILED"
  | "UNKNOWN"
  | "ZERO";

export type DashboardSeverity = "info" | "warning" | "error";

export type CoverageState = "FULL" | "PARTIAL" | "ZERO_VALID" | "UNKNOWN";

export type StageDerivationInput = {
  totalRows: number | null;
  freshRows: number | null;
  staleRows: number | null;
  lastDataTs: string | null;
  lastSuccessfulRunTs: string | null;
  latestFailedRunTs?: string | null;
  scheduleActive?: boolean | null;
  queryFailed?: boolean;
};

export type DashboardAlertLinkInput = {
  surface: "review" | "listings" | "control";
  params?: Record<string, string | number | boolean | null | undefined>;
};

export type DashboardAlertTone = "info" | "warning" | "error";

export type DashboardAlert = {
  id: string;
  tone: DashboardAlertTone;
  title: string;
  detail: string;
  href: string;
};

export type DashboardFieldLineage = {
  field: string;
  source: string;
  query: string;
  businessRule: string;
  failureMode: string;
};

function parseTs(value: string | null | undefined): number | null {
  if (!value) return null;
  const ts = new Date(value).getTime();
  return Number.isFinite(ts) ? ts : null;
}

function isFailureNewerThanSuccess(input: StageDerivationInput): boolean {
  const failedTs = parseTs(input.latestFailedRunTs ?? null);
  if (failedTs == null) return false;
  const successTs = parseTs(input.lastSuccessfulRunTs);
  return successTs == null || failedTs >= successTs;
}

export function deriveFreshnessState(input: StageDerivationInput): DashboardMetricState {
  if (input.queryFailed) return "TOTAL_FAILURE";
  if (input.totalRows == null || input.freshRows == null || input.staleRows == null) return "UNKNOWN";
  if (input.totalRows === 0) return "ZERO_VALID";
  if (input.freshRows === 0) return "STALE";
  if (input.staleRows > 0) return "FRESH_DEGRADED";
  return "FRESH_HEALTHY";
}

export function deriveCoverageState(input: Pick<StageDerivationInput, "totalRows" | "freshRows" | "queryFailed">): CoverageState {
  if (input.queryFailed || input.totalRows == null || input.freshRows == null) return "UNKNOWN";
  if (input.totalRows === 0) return "ZERO_VALID";
  if (input.freshRows >= input.totalRows) return "FULL";
  if (input.freshRows > 0) return "PARTIAL";
  return "ZERO_VALID";
}

export function deriveHealthStatus(input: StageDerivationInput): DashboardMetricState {
  const freshnessState = deriveFreshnessState(input);
  if (freshnessState === "TOTAL_FAILURE" || freshnessState === "UNKNOWN" || freshnessState === "ZERO_VALID") {
    return freshnessState;
  }
  if (freshnessState === "STALE") return "STALE";
  if (input.scheduleActive === false) return "PARTIAL_FAILURE";
  if (!input.lastSuccessfulRunTs) return "PARTIAL_FAILURE";
  if (isFailureNewerThanSuccess(input)) return "PARTIAL_FAILURE";
  return freshnessState;
}

export function deriveSeverity(state: DashboardMetricState): DashboardSeverity {
  if (state === "TOTAL_FAILURE" || state === "PARTIAL_FAILURE" || state === "STALE") return "error";
  if (state === "FRESH_DEGRADED" || state === "UNKNOWN") return "warning";
  return "info";
}

export function deriveRenderState(state: DashboardMetricState, options?: { queryFailed?: boolean }): DashboardRenderState {
  if (options?.queryFailed || state === "TOTAL_FAILURE") return "QUERY_FAILED";
  if (state === "PARTIAL_FAILURE") return "PARTIAL_FAILURE";
  if (state === "STALE") return "STALE";
  if (state === "UNKNOWN") return "UNKNOWN";
  if (state === "ZERO_VALID") return "ZERO";
  if (state === "FRESH_DEGRADED") return "DEGRADED";
  return "HEALTHY";
}

export function normalizeDashboardSupplierKey(value: string | null | undefined): string {
  return canonicalSupplierKey(value);
}

export function normalizeDashboardMarketplaceKey(value: string | null | undefined): string {
  return normalizeMarketplaceKey(value);
}

export function normalizeDashboardProductIdentity(input: {
  supplierKey: string | null | undefined;
  supplierProductId: string | null | undefined;
  marketplaceKey?: string | null | undefined;
  marketplaceListingId?: string | null | undefined;
}): string {
  const supplierKey = normalizeDashboardSupplierKey(input.supplierKey);
  const supplierProductId = String(input.supplierProductId ?? "").trim().toLowerCase();
  const marketplaceKey = normalizeDashboardMarketplaceKey(input.marketplaceKey);
  const marketplaceListingId = String(input.marketplaceListingId ?? "").trim().toLowerCase();
  return [supplierKey, supplierProductId, marketplaceKey, marketplaceListingId].filter(Boolean).join("::");
}

export function buildDashboardAlertHref(input: DashboardAlertLinkInput): string {
  const path =
    input.surface === "review" ? "/admin/review" : input.surface === "listings" ? "/admin/listings" : "/admin/control";
  const params = new URLSearchParams();
  Object.entries(input.params ?? {}).forEach(([key, value]) => {
    if (value == null) return;
    params.set(key, String(value));
  });
  const query = params.toString();
  return query ? `${path}?${query}` : path;
}

export function countAlertsBySeverity(alerts: DashboardAlert[]): { info: number; warning: number; error: number } {
  return alerts.reduce(
    (acc, alert) => {
      acc[alert.tone] += 1;
      return acc;
    },
    { info: 0, warning: 0, error: 0 }
  );
}

export function getReadOnlyRefreshDescription() {
  return {
    pageCaching: "force-dynamic" as const,
    dataSource: "Canonical DB truth + worker_runs + queue schedule metadata + audit_log",
    refreshAction: "Read-only router refresh; never enqueues jobs or mutates state.",
    readOnly: true,
  };
}
