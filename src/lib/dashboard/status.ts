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

export type DashboardScopedDomain =
  | "worker_heartbeat"
  | "supplier_discovery"
  | "marketplace_scan"
  | "order_sync"
  | "listing_pipeline";

export type DashboardZeroReason = "idle" | "blocked" | "not_applicable" | "unknown" | "missing_data";

export type DashboardActionState = "ACTIONABLE" | "BLOCKED" | "READ_ONLY";

export type DashboardIncidentState = "CURRENT" | "HISTORICAL_RESOLVED" | "UNKNOWN";

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

export type ScopedHealthDerivationInput = StageDerivationInput & {
  domain: DashboardScopedDomain;
  viableCount?: number | null;
  downstreamContributionCount?: number | null;
  repeatedFailures?: number | null;
  authInvalid?: boolean;
  blockedCount?: number | null;
  missingData?: boolean;
};

export type DashboardAlertLinkInput = {
  surface: "review" | "listings" | "control" | "orders";
  params?: Record<string, string | number | boolean | null | undefined>;
};

export type DashboardAlertTone = "info" | "warning" | "error";

export type DashboardAlert = {
  id: string;
  tone: DashboardAlertTone;
  title: string;
  detail: string;
  href: string;
  domain?: DashboardScopedDomain;
  incidentState?: DashboardIncidentState;
  actionState?: DashboardActionState;
  blockedReason?: string | null;
  count?: number | null;
};

export type DashboardFieldLineage = {
  field: string;
  source: string;
  query: string;
  businessRule: string;
  failureMode: string;
};

export type DashboardScopedHealth = {
  domain: DashboardScopedDomain;
  label: string;
  state: DashboardMetricState;
  severity: DashboardSeverity;
  renderState: DashboardRenderState;
  actionState: DashboardActionState;
  incidentState: DashboardIncidentState;
  detail: string;
  blockedReason: string | null;
  actionableHref: string;
  latestEvidenceTs: string | null;
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

export function deriveScopedHealthStatus(input: ScopedHealthDerivationInput): DashboardMetricState {
  const base = deriveHealthStatus(input);
  if (base === "TOTAL_FAILURE" || base === "UNKNOWN" || base === "STALE" || base === "PARTIAL_FAILURE") return base;

  if (input.domain === "supplier_discovery") {
    if ((input.totalRows ?? 0) === 0) return "ZERO_VALID";
    if ((input.freshRows ?? 0) === 0) return "STALE";
    if ((input.viableCount ?? 0) <= 0) return "FRESH_DEGRADED";
    if ((input.downstreamContributionCount ?? 0) <= 0) return "FRESH_DEGRADED";
  }

  if (input.domain === "order_sync") {
    if (input.authInvalid) return "TOTAL_FAILURE";
    if ((input.repeatedFailures ?? 0) > 0) return "PARTIAL_FAILURE";
  }

  if (input.domain === "listing_pipeline") {
    if ((input.blockedCount ?? 0) > 0 && (input.freshRows ?? 0) === 0) return "FRESH_DEGRADED";
  }

  return base;
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

export function explainZeroState(input: {
  state: DashboardMetricState;
  label?: string;
  blocked?: boolean;
  missingData?: boolean;
  notApplicable?: boolean;
}): { reason: DashboardZeroReason; detail: string } {
  const labelPrefix = input.label ? input.label + " " : "";
  if (input.missingData || input.state === "UNKNOWN" || input.state === "TOTAL_FAILURE") {
    return {
      reason: "missing_data",
      detail: (labelPrefix + "data is unavailable, so zero cannot be treated as a valid empty state.").trim(),
    };
  }
  if (input.notApplicable) {
    return {
      reason: "not_applicable",
      detail: (labelPrefix + "does not currently apply to any canonical rows.").trim(),
    };
  }
  if (input.blocked) {
    return {
      reason: "blocked",
      detail: (labelPrefix + "is zero because the current flow is blocked, not because work completed cleanly.").trim(),
    };
  }
  if (input.state === "ZERO_VALID") {
    return {
      reason: "idle",
      detail: (labelPrefix + "is zero because no canonical rows currently satisfy this metric.").trim(),
    };
  }
  return {
    reason: "unknown",
    detail: (labelPrefix + "zero state could not be classified deterministically.").trim(),
  };
}

export function deriveEvidenceState(input: {
  status: string | null | undefined;
  isLatestForWorker?: boolean;
}): DashboardIncidentState {
  const status = String(input.status ?? "").trim().toUpperCase();
  if (status !== "FAILED") return "CURRENT";
  return input.isLatestForWorker === false ? "HISTORICAL_RESOLVED" : "CURRENT";
}

export function buildScopedHealth(input: {
  domain: DashboardScopedDomain;
  label: string;
  state: DashboardMetricState;
  actionableHref: string;
  latestEvidenceTs: string | null;
  blockedReason?: string | null;
  zeroState?: ReturnType<typeof explainZeroState> | null;
  incidentState?: DashboardIncidentState;
  detail?: string;
}): DashboardScopedHealth {
  const severity = deriveSeverity(input.state);
  const renderState = deriveRenderState(input.state, { queryFailed: input.state === "TOTAL_FAILURE" });
  const blockedReason = input.blockedReason ?? null;
  return {
    domain: input.domain,
    label: input.label,
    state: input.state,
    severity,
    renderState,
    actionState: blockedReason ? "BLOCKED" : "READ_ONLY",
    incidentState: input.incidentState ?? (input.state === "PARTIAL_FAILURE" || input.state === "TOTAL_FAILURE" ? "CURRENT" : "UNKNOWN"),
    detail:
      input.detail ??
      input.zeroState?.detail ??
      input.label + " is currently " + renderState.replaceAll("_", " ").toLowerCase() + ".",
    blockedReason,
    actionableHref: input.actionableHref,
    latestEvidenceTs: input.latestEvidenceTs,
  };
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
    input.surface === "review"
      ? "/admin/review"
      : input.surface === "listings"
        ? "/admin/listings"
        : input.surface === "orders"
          ? "/admin/orders"
          : "/admin/control";
  const params = new URLSearchParams();
  Object.entries(input.params ?? {}).forEach(([key, value]) => {
    if (value == null) return;
    params.set(key, String(value));
  });
  const query = params.toString();
  return query ? `${path}?${query}` : path;
}

export function summarizeIncidents(alerts: DashboardAlert[]): DashboardAlert[] {
  const grouped = new Map<string, DashboardAlert>();
  for (const alert of alerts) {
    const key = [alert.domain ?? "generic", alert.title, alert.blockedReason ?? "", alert.incidentState ?? "CURRENT"].join("::");
    const existing = grouped.get(key);
    if (!existing) {
      grouped.set(key, { ...alert, count: alert.count ?? 1 });
      continue;
    }
    grouped.set(key, {
      ...existing,
      count: (existing.count ?? 1) + (alert.count ?? 1),
    });
  }
  return Array.from(grouped.values());
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
