import { headers } from "next/headers";
import type { Metadata } from "next";
import {
  REVIEW_ROUTE,
  REVIEW_STATUSES,
  getCandidateDetail,
  getReviewCandidates,
  getReviewFilterOptions,
  getReviewFiltersFromSearchParams,
  getSupplierImageUrl,
  LOW_MATCH_CONFIDENCE_THRESHOLD,
  type AuditEntry,
  type CandidateDetail,
  type ReviewFilters,
  type ReviewListItem,
} from "@/lib/review/console";
import { isReviewConsoleConfigured } from "@/lib/review/auth";
import { getControlPlaneOverview } from "@/lib/controlPlane/getControlPlaneOverview";
import { AiListingDiagnostics } from "@/components/admin/AiListingDiagnostics";
import { ControlPlaneOverviewPanel } from "@/components/admin/ControlPlaneOverviewPanel";
import { OptimizationDiagnostics } from "@/components/admin/OptimizationDiagnostics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata: Metadata = {
  title: "Review Console",
  robots: {
    index: false,
    follow: false,
  },
};

type SearchParams = Record<string, string | string[] | undefined>;

function formatMoney(value: number | null, currency = "USD"): string {
  if (value == null) return "-";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(value);
}

function formatPercent(value: number | null): string {
  if (value == null) return "-";
  return `${value.toFixed(2)}%`;
}

function formatHours(value: number | null): string {
  if (value == null) return "-";
  return `${value.toFixed(2)}h`;
}

function formatListingStatus(status: string | null | undefined): string {
  const normalized = (status ?? "").trim();
  if (!normalized) return "No preview";
  if (normalized.toUpperCase() === "PREVIEW") return "PREVIEW ready";
  return normalized;
}

function formatDateTime(value: string | null | undefined): string {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  });
}

function serializeDetails(value: unknown): string {
  if (value == null) return "-";
  return JSON.stringify(value, null, 2);
}

function asObject(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function getNestedValue(
  obj: Record<string, unknown> | null,
  path: readonly string[]
): string | number | boolean | null {
  if (!obj) return null;
  let current: unknown = obj;
  for (const key of path) {
    const record = asObject(current);
    if (!record || !(key in record)) return null;
    current = record[key];
  }
  if (typeof current === "string" || typeof current === "number" || typeof current === "boolean") {
    return current;
  }
  return null;
}

function shortJson(value: unknown, maxLength = 420): string {
  try {
    const text = JSON.stringify(value, null, 2);
    if (!text) return "-";
    return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
  } catch {
    return "-";
  }
}

function renderListingPayloadSummary(payload: unknown): React.ReactNode {
  const root = asObject(payload);
  if (!root) {
    return (
      <div className="rounded-2xl border border-white/10 bg-black/20 p-4 text-sm text-white/55">
        No payload summary available.
      </div>
    );
  }

  const summaryFields: Array<{ label: string; value: React.ReactNode }> = [];
  const dryRun = getNestedValue(root, ["dryRun"]);
  const marketplace = getNestedValue(root, ["marketplace"]);
  const listingType = getNestedValue(root, ["listingType"]);
  const condition = getNestedValue(root, ["condition"]);
  const supplierTitle = getNestedValue(root, ["source", "supplierTitle"]);
  const supplierSourceUrl = getNestedValue(root, ["source", "supplierSourceUrl"]);
  const matchedMarketplaceListingId = getNestedValue(root, ["matchedMarketplace", "marketplaceListingId"]);

  if (dryRun != null) summaryFields.push({ label: "Dry Run", value: String(dryRun) });
  if (marketplace != null) summaryFields.push({ label: "Marketplace", value: String(marketplace) });
  if (listingType != null) summaryFields.push({ label: "Listing Type", value: String(listingType) });
  if (condition != null) summaryFields.push({ label: "Condition", value: String(condition) });
  if (supplierTitle != null) summaryFields.push({ label: "Supplier Title", value: String(supplierTitle) });
  if (supplierSourceUrl != null) {
    const url = String(supplierSourceUrl);
    summaryFields.push({
      label: "Supplier Source",
      value: (
        <a href={url} className="text-cyan-100 underline" target="_blank" rel="noreferrer">
          {url}
        </a>
      ),
    });
  }
  if (matchedMarketplaceListingId != null) {
    summaryFields.push({
      label: "Matched Listing ID",
      value: String(matchedMarketplaceListingId),
    });
  }

  if (!summaryFields.length) {
    return (
      <pre className="overflow-x-auto rounded-2xl border border-white/10 bg-[#0a1020] p-3 text-xs text-white/75">
        {shortJson(root)}
      </pre>
    );
  }

  return (
    <div className="grid gap-3 md:grid-cols-2">
      {summaryFields.map((field) => (
        <KeyValue key={field.label} label={field.label} value={field.value} />
      ))}
    </div>
  );
}

function renderListingResponseSummary(response: unknown): React.ReactNode {
  const root = asObject(response);
  if (!root) return null;

  const previewVersion = getNestedValue(root, ["previewVersion"]);
  const liveApiCalled = getNestedValue(root, ["liveApiCalled"]);
  const titleLength = getNestedValue(root, ["titleLength"]);

  const fields = [
    previewVersion != null ? { label: "Preview Version", value: String(previewVersion) } : null,
    liveApiCalled != null ? { label: "Live API Called", value: String(liveApiCalled) } : null,
    titleLength != null ? { label: "Title Length", value: String(titleLength) } : null,
  ].filter(Boolean) as Array<{ label: string; value: string }>;

  if (!fields.length) return null;

  return (
    <div className="mt-4">
      <div className="mb-2 text-xs uppercase tracking-[0.16em] text-white/45">Preview Metadata</div>
      <div className="grid gap-3 md:grid-cols-3">
        {fields.map((field) => (
          <KeyValue key={field.label} label={field.label} value={field.value} />
        ))}
      </div>
    </div>
  );
}

function buildReviewHref(filters: ReviewFilters, candidateId: string): string {
  const params = new URLSearchParams();

  if (filters.supplier) params.set("supplier", filters.supplier);
  if (filters.marketplace) params.set("marketplace", filters.marketplace);
  if (filters.decisionStatus) params.set("decisionStatus", filters.decisionStatus);
  if (filters.minProfit) params.set("minProfit", filters.minProfit);
  if (filters.minMargin) params.set("minMargin", filters.minMargin);
  if (filters.minRoi) params.set("minRoi", filters.minRoi);
  if (filters.riskOnly) params.set("riskOnly", "1");
  if (filters.sort) params.set("sort", filters.sort);
  if (candidateId) params.set("candidateId", candidateId);

  const query = params.toString();
  return query ? `${REVIEW_ROUTE}?${query}` : REVIEW_ROUTE;
}

function isSafePresetCandidate(candidate: ReviewListItem): boolean {
  const hasPriceGuardBlock = (candidate.listingBlockReason ?? "").toUpperCase().startsWith("PRICE_GUARD_");
  return (
    candidate.marketplaceKey === "ebay" &&
    candidate.decisionStatus !== "MANUAL_REVIEW" &&
    candidate.blockingRiskFlags.length === 0 &&
    !hasPriceGuardBlock
  );
}

function hasShippingException(candidate: ReviewListItem): boolean {
  return candidate.riskFlags.some((flag) => flag === "SHIPPING_SIGNAL_MISSING" || flag === "SHIPPING_SIGNAL_WEAK");
}

function hasSupplierException(candidate: ReviewListItem): boolean {
  return candidate.riskFlags.some((flag) =>
    [
      "SUPPLIER_LOW_STOCK",
      "SUPPLIER_OUT_OF_STOCK",
      "SUPPLIER_AVAILABILITY_UNKNOWN",
      "AVAILABILITY_NOT_CONFIRMED",
      "SUPPLIER_BLOCKED",
      "STALE_SUPPLIER_SNAPSHOT",
      "SUPPLIER_SIGNAL_INSUFFICIENT",
    ].includes(flag)
  );
}

function hasMarketplaceException(candidate: ReviewListItem): boolean {
  return (
    candidate.riskFlags.includes("STALE_MARKETPLACE_SNAPSHOT") ||
    (candidate.listingBlockReason ?? "").toUpperCase().includes("MARKETPLACE SNAPSHOT AGE")
  );
}

function getPrimaryTriageLabel(candidate: ReviewListItem): { label: string; tone: string } {
  if (isSafePresetCandidate(candidate)) return { label: "Safe for batch", tone: "text-emerald-200" };
  if (hasMarketplaceException(candidate)) return { label: "Refresh marketplace", tone: "text-amber-200" };
  if (hasShippingException(candidate)) return { label: "Resolve shipping", tone: "text-amber-200" };
  if (hasSupplierException(candidate)) return { label: "Supplier evidence", tone: "text-rose-200" };
  return { label: "Manual review", tone: "text-amber-200" };
}

function RiskBadge({ flag }: { flag: string }) {
  const isBlocking =
    flag === "LOW_MATCH_CONFIDENCE" ||
    flag === "MISSING_SHIPPING_ESTIMATE" ||
    flag === "SHIPPING_SIGNAL_MISSING" ||
    flag === "SHIPPING_SIGNAL_WEAK" ||
    flag === "BRAND_OR_RESTRICTED_TITLE" ||
    flag === "DUPLICATE_CANDIDATE_PATTERN" ||
    flag === "SOURCE_CHALLENGE_PAGE" ||
    flag === "SOURCE_PROVIDER_BLOCK" ||
    flag === "SUPPLIER_BLOCKED" ||
    flag === "SUPPLIER_OUT_OF_STOCK" ||
    flag === "SUPPLIER_LOW_STOCK" ||
    flag === "AVAILABILITY_NOT_CONFIRMED";

  return (
    <span
      className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] ${
        isBlocking
          ? "border-rose-300/30 bg-rose-400/12 text-rose-100"
          : "border-amber-300/30 bg-amber-400/12 text-amber-100"
      }`}
    >
      {flag.replaceAll("_", " ")}
    </span>
  );
}

function DetailBlock({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="glass-panel rounded-3xl border border-white/10 p-5">
      <h2 className="mb-4 text-lg font-semibold text-white">{title}</h2>
      {children}
    </section>
  );
}

function KeyValue({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-white/10 bg-black/20 p-3">
      <div className="text-[11px] uppercase tracking-[0.18em] text-white/45">{label}</div>
      <div className="mt-2 text-sm text-white/90">{value}</div>
    </div>
  );
}

function AuditList({ entries }: { entries: AuditEntry[] }) {
  if (!entries.length) {
    return <div className="rounded-2xl border border-white/10 bg-black/20 p-4 text-sm text-white/55">No audit history for this candidate or match yet.</div>;
  }

  return (
    <div className="space-y-3">
      {entries.map((entry) => (
        <div key={entry.id} className="rounded-2xl border border-white/10 bg-black/20 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="text-sm font-semibold text-white">{entry.eventType}</div>
            <div className="text-xs text-white/45">{formatDateTime(entry.eventTs)}</div>
          </div>
          <div className="mt-2 text-xs uppercase tracking-[0.16em] text-white/45">
            {entry.actorType}
            {entry.actorId ? ` / ${entry.actorId}` : ""}
            {` / ${entry.entityType} / ${entry.entityId}`}
          </div>
          <pre className="mt-3 overflow-x-auto rounded-2xl border border-white/10 bg-[#0a1020] p-3 text-xs text-white/75">
            {serializeDetails(entry.details)}
          </pre>
        </div>
      ))}
    </div>
  );
}

function ReviewActions({ candidate }: { candidate: CandidateDetail["candidate"] }) {
  const canPreparePreview = candidate.decisionStatus === "APPROVED";
  const hasPreview = Boolean(candidate.listingId || candidate.listingStatus);
  const prepareButtonLabel = hasPreview ? "Refresh Preview" : "Prepare Preview";

  return (
    <DetailBlock title="Human Decision">
      <form action="/api/admin/review/decision" method="post" className="space-y-4">
        <input type="hidden" name="candidateId" value={candidate.id} />
        <div className="grid gap-4 md:grid-cols-2">
          <KeyValue label="Current Status" value={candidate.decisionStatus} />
          <KeyValue
            label="Listing Eligible"
            value={
              <span className={candidate.listingEligible ? "text-emerald-200" : "text-rose-200"}>
                {candidate.listingEligible ? "YES" : "NO"}
              </span>
            }
          />
          <KeyValue
            label="Duplicate Warning"
            value={
              candidate.duplicateDetected
                ? `YES${candidate.duplicateReason ? ` - ${candidate.duplicateReason}` : ""}`
                : "NO"
            }
          />
        </div>
        <label className="block">
          <div className="mb-2 text-xs uppercase tracking-[0.16em] text-white/45">Reason / Note</div>
          <textarea
            name="reason"
            defaultValue={candidate.reason ?? ""}
            rows={4}
            className="contact-input min-h-[110px] resize-y"
            placeholder="Optional approval note"
          />
        </label>
        <div className="flex flex-wrap gap-3">
          <button
            type="submit"
            name="decisionStatus"
            value="APPROVED"
            className="rounded-2xl border border-emerald-300/30 bg-emerald-400/12 px-4 py-2 text-sm font-semibold text-emerald-100"
          >
            Approve
          </button>
          <button
            type="submit"
            name="decisionStatus"
            value="REJECTED"
            className="rounded-2xl border border-rose-300/30 bg-rose-400/12 px-4 py-2 text-sm font-semibold text-rose-100"
          >
            Reject
          </button>
          <button
            type="submit"
            name="decisionStatus"
            value="RECHECK"
            className="rounded-2xl border border-amber-300/30 bg-amber-400/12 px-4 py-2 text-sm font-semibold text-amber-100"
          >
            Mark for Recheck
          </button>
        </div>
      </form>

      <div className="mt-5 border-t border-white/10 pt-4">
        <div className="mb-2 text-xs uppercase tracking-[0.16em] text-white/45">Listing Preview</div>
        <div className="mb-3 text-sm text-white/75">Current: {formatListingStatus(candidate.listingStatus)}</div>
        {canPreparePreview ? (
          <form action="/api/admin/review/prepare-preview" method="post">
            <input type="hidden" name="candidateId" value={candidate.id} />
            <input type="hidden" name="marketplace" value="ebay" />
            <input type="hidden" name="forceRefresh" value={hasPreview ? "true" : "false"} />
            <button
              type="submit"
              className="rounded-2xl border border-cyan-300/30 bg-cyan-400/12 px-4 py-2 text-sm font-semibold text-cyan-100"
            >
              {prepareButtonLabel}
            </button>
          </form>
        ) : (
          <div className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-white/60">
            Approve candidate first to prepare listing preview.
          </div>
        )}
      </div>

      <div className="mt-5 border-t border-white/10 pt-4">
        <div className="mb-2 text-xs uppercase tracking-[0.16em] text-white/45">Recovery</div>
        <div className="mb-3 text-sm text-white/75">{candidate.recoveryState} - {candidate.recoveryNextAction}</div>
        {candidate.recoveryBlockReasonCode ? (
          <div className="mb-3 text-xs text-white/55">Primary reason: {candidate.recoveryBlockReasonCode}</div>
        ) : null}
        {candidate.listingId ? (
          <form action="/api/admin/listings/re-evaluate" method="post">
            <input type="hidden" name="candidateId" value={candidate.id} />
            <input type="hidden" name="listingId" value={candidate.listingId} />
            <button
              type="submit"
              className="rounded-2xl border border-amber-300/30 bg-amber-400/12 px-4 py-2 text-sm font-semibold text-amber-100"
            >
              Re-evaluate Recovery State
            </button>
          </form>
        ) : (
          <div className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-white/60">
            No listing row yet for recovery re-evaluation.
          </div>
        )}
      </div>
    </DetailBlock>
  );
}



function parseBatchSkipSummary(value: string): Array<{ reason: string; count: number }> {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as Record<string, number>;
    return Object.entries(parsed)
      .filter((entry) => typeof entry[1] === "number" && entry[1] > 0)
      .map(([reason, count]) => ({ reason, count }));
  } catch {
    return [];
  }
}

function EmptyDetailPane() {
  return (
    <div className="glass-panel rounded-3xl border border-white/10 p-8 text-center text-sm text-white/55">
      No candidate selected. Adjust filters or choose a row from the left pane.
    </div>
  );
}

export default async function ReviewPage({
  searchParams,
}: {
  searchParams?: Promise<SearchParams>;
}) {
  const resolvedSearchParams = await searchParams;
  const previewUpdated = String(resolvedSearchParams?.previewUpdated ?? "").trim() === "1";
  const previewError = String(resolvedSearchParams?.previewError ?? "").trim();
  const decisionError = String(resolvedSearchParams?.decisionError ?? "").trim();
  const batchUpdated = String(resolvedSearchParams?.batchUpdated ?? "").trim() === "1";
  const batchAction = String(resolvedSearchParams?.batchAction ?? "").trim().toUpperCase();
  const batchApplied = Number(String(resolvedSearchParams?.batchApplied ?? "0").trim() || "0");
  const batchSkipped = Number(String(resolvedSearchParams?.batchSkipped ?? "0").trim() || "0");
  const batchSkipSummary = parseBatchSkipSummary(String(resolvedSearchParams?.batchSkipSummary ?? "").trim());
  const filters = getReviewFiltersFromSearchParams(resolvedSearchParams);
  const [filterOptions, candidates, controlPlane] = await Promise.all([
    getReviewFilterOptions(),
    getReviewCandidates(filters),
    getControlPlaneOverview(),
  ]);
  const safeCandidateCount = candidates.filter((candidate) => isSafePresetCandidate(candidate)).length;
  const staleMarketplaceCount = candidates.filter((candidate) => hasMarketplaceException(candidate)).length;
  const shippingExceptionCount = candidates.filter((candidate) => hasShippingException(candidate)).length;
  const supplierExceptionCount = candidates.filter((candidate) => hasSupplierException(candidate)).length;
  const approvedAwaitingPreviewCount = candidates.filter(
    (candidate) => candidate.decisionStatus === "APPROVED" && !candidate.listingStatus
  ).length;

  const selectedCandidateId = filters.candidateId || candidates[0]?.id || "";
  const detail = selectedCandidateId ? await getCandidateDetail(selectedCandidateId) : null;
  const supplierImageUrl = getSupplierImageUrl(detail);
  const configured = isReviewConsoleConfigured();
  const host = (await headers()).get("host");

  return (
    <main className="relative min-h-screen bg-app text-white">
      <div className="pointer-events-none absolute inset-0">
        <div className="hero-orb hero-orb-a" />
        <div className="hero-orb hero-orb-b" />
        <div className="hero-orb hero-orb-c" />
        <div className="grid-overlay opacity-[0.08]" />
      </div>

      <div className="relative mx-auto max-w-[1800px] px-4 py-6 sm:px-6 lg:px-8">
        <header className="glass-card rounded-3xl border border-white/10 px-5 py-5 sm:px-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h1 className="m-0 text-3xl font-bold text-white">Profitable Candidate Review Console</h1>
              <p className="mt-2 text-sm text-white/65">
                Internal review UI for approval decisions and listing readiness.
              </p>
              <p className="mt-2 text-xs text-white/45">
                Route: {REVIEW_ROUTE} | Host: {host ?? "-"} | Auth configured: {configured ? "yes" : "no"}
              </p>
            </div>
            <div className="rounded-2xl border border-cyan-300/20 bg-cyan-400/8 px-4 py-3 text-sm text-cyan-100">
              Confidence threshold: {LOW_MATCH_CONFIDENCE_THRESHOLD}
            </div>
          </div>
          {previewUpdated ? (
            <div className="mt-4 rounded-2xl border border-emerald-300/25 bg-emerald-400/10 px-4 py-3 text-sm text-emerald-100">
              Listing preview updated.
            </div>
          ) : null}
          {previewError ? (
            <div className="mt-4 rounded-2xl border border-rose-300/25 bg-rose-400/10 px-4 py-3 text-sm text-rose-100">
              {previewError}
            </div>
          ) : null}
          {decisionError ? (
            <div className="mt-4 rounded-2xl border border-rose-300/25 bg-rose-400/10 px-4 py-3 text-sm text-rose-100">
              {decisionError}
            </div>
          ) : null}
          {batchUpdated ? (
            <div className="mt-4 rounded-2xl border border-cyan-300/25 bg-cyan-400/10 px-4 py-3 text-sm text-cyan-100">
              <div className="font-semibold">
                Batch {batchAction || "decision"}: applied {batchApplied}, skipped {batchSkipped}
              </div>
              {batchSkipSummary.length ? (
                <ul className="mt-2 list-disc pl-5 text-xs text-cyan-50/90">
                  {batchSkipSummary.map((item) => (
                    <li key={item.reason}>
                      {item.reason}: {item.count}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}

          <form action={REVIEW_ROUTE} method="get" className="mt-5 grid gap-3 xl:grid-cols-[repeat(7,minmax(0,1fr))_auto]">
            <select name="supplier" defaultValue={filters.supplier} className="contact-input">
              <option value="">All suppliers</option>
              {filterOptions.suppliers.map((supplier) => (
                <option key={supplier} value={supplier}>
                  {supplier}
                </option>
              ))}
            </select>
            <select name="marketplace" defaultValue={filters.marketplace} className="contact-input">
              <option value="">All marketplaces</option>
              {filterOptions.marketplaces.map((marketplace) => (
                <option key={marketplace} value={marketplace}>
                  {marketplace}
                </option>
              ))}
            </select>
            <select name="decisionStatus" defaultValue={filters.decisionStatus} className="contact-input">
              <option value="">All statuses</option>
              {REVIEW_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {status}
                </option>
              ))}
            </select>
            <input name="minProfit" defaultValue={filters.minProfit} className="contact-input" placeholder="Min profit" />
            <input name="minMargin" defaultValue={filters.minMargin} className="contact-input" placeholder="Min margin %" />
            <input name="minRoi" defaultValue={filters.minRoi} className="contact-input" placeholder="Min ROI %" />
            <select name="sort" defaultValue={filters.sort} className="contact-input">
              <option value="calc_ts_desc">Newest first</option>
              <option value="estimated_profit_desc">Estimated profit desc</option>
              <option value="margin_pct_desc">Margin desc</option>
              <option value="roi_pct_desc">ROI desc</option>
            </select>
            <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-black/20 px-4 py-3">
              <label className="flex items-center gap-2 text-sm text-white/85">
                <input type="checkbox" name="riskOnly" value="1" defaultChecked={filters.riskOnly} />
                Risk only
              </label>
              <button
                type="submit"
                className="rounded-2xl border border-cyan-300/30 bg-cyan-400/12 px-4 py-2 text-sm font-semibold text-cyan-100"
              >
                Apply
              </button>
            </div>
          </form>
        </header>

        <ControlPlaneOverviewPanel data={controlPlane} variant="compact" />

        <section className="mt-5 glass-panel rounded-3xl border border-white/10 p-4">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold text-white">Review Exception Triage</h2>
              <p className="mt-2 text-sm text-white/65">
                Automation should clear stale, refreshable, and publish-safe flow first. This queue is for true exceptions.
              </p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-white/80">
              Safe for batch now: <span className="font-semibold text-emerald-100">{safeCandidateCount}</span>
            </div>
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            <KeyValue label="Visible candidates" value={String(candidates.length)} />
            <KeyValue label="Marketplace refresh needed" value={String(staleMarketplaceCount)} />
            <KeyValue label="Shipping exceptions" value={String(shippingExceptionCount)} />
            <KeyValue label="Supplier evidence exceptions" value={String(supplierExceptionCount)} />
            <KeyValue label="Approved awaiting preview" value={String(approvedAwaitingPreviewCount)} />
          </div>
          <div className="mt-4 grid gap-3 lg:grid-cols-3">
            <div className="rounded-2xl border border-white/10 bg-black/20 p-3 text-sm text-white/75">
              Refresh and recompute blockers should leave this queue through the backbone, not through manual approval.
            </div>
            <div className="rounded-2xl border border-white/10 bg-black/20 p-3 text-sm text-white/75">
              Shipping and supplier-evidence failures stay fail-closed until deterministic data improves.
            </div>
            <div className="rounded-2xl border border-white/10 bg-black/20 p-3 text-sm text-white/75">
              Batch approve is reserved for clearly safe rows only. Everything else needs evidence or automation recovery first.
            </div>
          </div>
        </section>

        <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,760px)_minmax(0,1fr)]">
          <section className="glass-panel rounded-3xl border border-white/10 p-4">
            <form action="/api/admin/review/decision" method="post">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                <h2 className="text-lg font-semibold text-white">Candidate Queue</h2>
                <div className="flex items-center gap-2">
                  <div className="text-xs text-white/45">{candidates.length} row(s)</div>
                  <div className="rounded-2xl border border-white/10 bg-white/[0.04] px-3 py-2 text-xs text-white/85">
                    Selected: <span data-review-selected-total>0</span>
                  </div>
                  <div className="rounded-2xl border border-emerald-300/25 bg-emerald-400/10 px-3 py-2 text-xs text-emerald-100">
                    Safe selected: <span data-review-safe-selected>0</span> / {safeCandidateCount}
                  </div>
                  <button
                    type="button"
                    className="rounded-2xl border border-white/20 bg-white/5 px-3 py-2 text-xs font-semibold uppercase tracking-[0.12em] text-white/85"
                    data-review-select-all-visible
                  >
                    Select All Visible
                  </button>
                  <button
                    type="button"
                    className="rounded-2xl border border-cyan-300/30 bg-cyan-400/12 px-3 py-2 text-xs font-semibold uppercase tracking-[0.12em] text-cyan-100"
                    data-review-select-safe
                  >
                    Select Safe Candidates
                  </button>
                  <button
                    type="submit"
                    name="decisionStatus"
                    value="APPROVED"
                    className="rounded-2xl border border-emerald-300/30 bg-emerald-400/12 px-3 py-2 text-xs font-semibold uppercase tracking-[0.12em] text-emerald-100"
                  >
                    Batch Approve Safe
                  </button>
                  <button
                    type="submit"
                    name="decisionStatus"
                    value="REJECTED"
                    className="rounded-2xl border border-rose-300/30 bg-rose-400/12 px-3 py-2 text-xs font-semibold uppercase tracking-[0.12em] text-rose-100"
                  >
                    Batch Reject
                  </button>
                </div>
              </div>
              <p className="mb-3 text-xs text-white/55">
                Batch approve is intentionally limited to clearly safe candidates. Manual-review/risky edge cases are skipped and must be handled in detail view.
              </p>
              <div className="mb-3 flex flex-wrap gap-2 text-xs">
                <span className="rounded-full border border-emerald-300/30 bg-emerald-400/12 px-2.5 py-1 font-semibold uppercase tracking-[0.14em] text-emerald-100">
                  Safe for batch = no blocking risk flags and no manual review hold
                </span>
                <span className="rounded-full border border-amber-300/30 bg-amber-400/12 px-2.5 py-1 font-semibold uppercase tracking-[0.14em] text-amber-100">
                  Manual required = open detail view before deciding
                </span>
              </div>
              <div className="overflow-hidden rounded-2xl border border-white/10">
                <div className="max-h-[78vh] overflow-auto">
                  <table className="min-w-full border-collapse text-sm text-white/90">
                    <thead className="sticky top-0 z-10 bg-[#111827]">
                      <tr>
                        {["select", "candidate", "supplier", "marketplace", "profit", "margin", "roi", "status", "calc_ts"].map((label) => (
                          <th
                            key={label}
                            className="border-b border-white/10 px-3 py-3 text-left text-[11px] uppercase tracking-[0.16em] text-white/45"
                          >
                            {label}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                    {candidates.length ? (
                      candidates.map((candidate) => {
                        const selected = detail?.candidate.id === candidate.id;
                        return (
                          <tr
                            key={candidate.id}
                            className={selected ? "bg-cyan-300/[0.08]" : "odd:bg-transparent even:bg-white/[0.02]"}
                          >
                            <td className="border-b border-white/5 px-3 py-3 align-top">
                              <input
                                type="checkbox"
                                name="candidateIds"
                                value={candidate.id}
                                aria-label={`Select ${candidate.id}`}
                                data-review-candidate-checkbox
                                data-safe-preset-eligible={isSafePresetCandidate(candidate) ? "1" : "0"}
                              />
                              <div className={`mt-2 text-[10px] uppercase tracking-[0.12em] ${getPrimaryTriageLabel(candidate).tone}`}>
                                {getPrimaryTriageLabel(candidate).label}
                              </div>
                            </td>
                            <td className="border-b border-white/5 px-3 py-3 align-top">
                              <a href={buildReviewHref(filters, candidate.id)} className="block text-cyan-100">
                                <div className="font-semibold">{candidate.id}</div>
                                <div className="mt-1 text-xs text-white/65">
                                  Listing: {formatListingStatus(candidate.listingStatus)}
                                </div>
                                {candidate.duplicateDetected ? (
                                  <div className="mt-1 text-xs text-rose-200">
                                    Duplicate warning: {candidate.duplicateReason ?? "conflict detected"}
                                  </div>
                                ) : null}
                                <div className="mt-2 flex flex-wrap gap-2">
                                  {candidate.riskFlags.slice(0, 2).map((flag) => (
                                    <RiskBadge key={flag} flag={flag} />
                                  ))}
                                  {candidate.listingEligible ? (
                                    <span className="rounded-full border border-emerald-300/30 bg-emerald-400/12 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-emerald-100">
                                      Eligible
                                    </span>
                                  ) : null}
                                </div>
                              </a>
                            </td>
                            <td className="border-b border-white/5 px-3 py-3 align-top">
                              <div className="font-semibold">{candidate.supplierKey}</div>
                              <div className="mt-1 text-xs text-white/55">{candidate.supplierProductId}</div>
                            </td>
                            <td className="border-b border-white/5 px-3 py-3 align-top">
                              <div className="font-semibold">{candidate.marketplaceKey}</div>
                              <div className="mt-1 text-xs text-white/55">{candidate.marketplaceListingId}</div>
                            </td>
                            <td className="border-b border-white/5 px-3 py-3 align-top">{formatMoney(candidate.estimatedProfit)}</td>
                            <td className="border-b border-white/5 px-3 py-3 align-top">{formatPercent(candidate.marginPct)}</td>
                            <td className="border-b border-white/5 px-3 py-3 align-top">{formatPercent(candidate.roiPct)}</td>
                            <td className="border-b border-white/5 px-3 py-3 align-top">{candidate.decisionStatus}</td>
                            <td className="border-b border-white/5 px-3 py-3 align-top text-xs text-white/55">
                              {formatDateTime(candidate.calcTs)}
                            </td>
                          </tr>
                        );
                      })
                    ) : (
                      <tr>
                        <td colSpan={9} className="px-4 py-10 text-center text-sm text-white/55">
                          No profitable candidates match the current filters.
                        </td>
                      </tr>
                    )}
                    </tbody>
                  </table>
                </div>
              </div>
              <input type="hidden" name="reason" value="batch-triage" />
            </form>
            <script
              dangerouslySetInnerHTML={{
                __html: `(() => {
  const root = document.currentScript?.previousElementSibling;
  if (!root || !(root instanceof HTMLFormElement)) return;

  const getVisibleCheckboxes = () => {
    const nodes = root.querySelectorAll('input[data-review-candidate-checkbox]');
    return Array.from(nodes).filter((node) => {
      if (!(node instanceof HTMLInputElement)) return false;
      const row = node.closest('tr');
      if (!row) return true;
      const styles = window.getComputedStyle(row);
      return styles.display !== 'none' && styles.visibility !== 'hidden';
    });
  };

  const selectAllVisibleButton = root.querySelector('[data-review-select-all-visible]');
  const selectSafeButton = root.querySelector('[data-review-select-safe]');
  const selectedTotalNode = root.querySelector('[data-review-selected-total]');
  const safeSelectedNode = root.querySelector('[data-review-safe-selected]');

  const updateSummary = () => {
    const checkboxes = getVisibleCheckboxes();
    const selected = checkboxes.filter((checkbox) => checkbox.checked);
    const safeSelected = selected.filter((checkbox) => checkbox.dataset.safePresetEligible === '1');
    if (selectedTotalNode) selectedTotalNode.textContent = String(selected.length);
    if (safeSelectedNode) safeSelectedNode.textContent = String(safeSelected.length);
  };

  if (selectAllVisibleButton instanceof HTMLButtonElement) {
    selectAllVisibleButton.addEventListener('click', () => {
      for (const checkbox of getVisibleCheckboxes()) {
        checkbox.checked = true;
      }
      updateSummary();
    });
  }

  if (selectSafeButton instanceof HTMLButtonElement) {
    selectSafeButton.addEventListener('click', () => {
      for (const checkbox of getVisibleCheckboxes()) {
        checkbox.checked = checkbox.dataset.safePresetEligible === '1';
      }
      updateSummary();
    });
  }

  root.addEventListener('change', (event) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement)) return;
    if (!target.matches('input[data-review-candidate-checkbox]')) return;
    updateSummary();
  });

  updateSummary();
})();`,
              }}
            />
          </section>

          <div className="grid gap-5">
            {!detail ? (
              <EmptyDetailPane />
            ) : (
              <>
                <DetailBlock title="Candidate Detail">
                  <div className="grid gap-4 lg:grid-cols-[220px_minmax(0,1fr)]">
                    <div className="overflow-hidden rounded-3xl border border-white/10 bg-black/20">
                      {supplierImageUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={supplierImageUrl} alt={detail.supplierSnapshot?.title ?? "Supplier product"} className="h-full min-h-[220px] w-full object-cover" />
                      ) : (
                        <div className="flex min-h-[220px] items-center justify-center text-sm text-white/40">No supplier image</div>
                      )}
                    </div>
                    <div className="grid gap-4 md:grid-cols-2">
                      <KeyValue label="Candidate ID" value={detail.candidate.id} />
                      <KeyValue label="Decision Status" value={detail.candidate.decisionStatus} />
                      <KeyValue label="Supplier" value={`${detail.candidate.supplierKey} / ${detail.candidate.supplierProductId}`} />
                      <KeyValue
                        label="Best Source Policy"
                        value={detail.candidate.selectionSummary ?? detail.candidate.selectionMode ?? "-"}
                      />
                      <KeyValue
                        label="Compared Sources"
                        value={detail.candidate.consideredSources.length ? detail.candidate.consideredSources.join(", ") : detail.candidate.supplierKey}
                      />
                      <KeyValue label="Marketplace" value={`${detail.candidate.marketplaceKey} / ${detail.candidate.marketplaceListingId}`} />
                      <KeyValue label="Estimated Profit" value={formatMoney(detail.candidate.estimatedProfit)} />
                      <KeyValue label="Margin / ROI" value={`${formatPercent(detail.candidate.marginPct)} / ${formatPercent(detail.candidate.roiPct)}`} />
                      <KeyValue label="Match Confidence" value={detail.match?.confidence?.toFixed(4) ?? "-"} />
                      <KeyValue label="Calculated" value={formatDateTime(detail.candidate.calcTs)} />
                      <KeyValue label="Listing Status" value={formatListingStatus(detail.candidate.listingStatus)} />
                      <KeyValue label="Listing ID" value={detail.candidate.listingId ?? "-"} />
                      <KeyValue label="Listing Title" value={detail.candidate.listingTitle ?? "-"} />
                      <KeyValue label="Listing Price" value={formatMoney(detail.candidate.listingPrice)} />
                      <KeyValue label="Listing Block Reason" value={detail.candidate.listingBlockReason ?? "-"} />
                      <KeyValue label="Recovery State" value={detail.candidate.recoveryState} />
                      <KeyValue label="Recovery Block Reason Code" value={detail.candidate.recoveryBlockReasonCode ?? "-"} />
                      <KeyValue label="Recovery Reason Codes" value={detail.candidate.recoveryReasonCodes.length ? detail.candidate.recoveryReasonCodes.join(", ") : "-"} />
                      <KeyValue label="Recovery Next Action" value={detail.candidate.recoveryNextAction} />
                      <KeyValue label="supplier_price_drift_pct" value={formatPercent(detail.candidate.supplierPriceDriftPct)} />
                      <KeyValue label="supplier_snapshot_age_hours" value={formatHours(detail.candidate.supplierSnapshotAgeHours)} />
                      <KeyValue label="availability_signal" value={detail.candidate.availabilitySignal} />
                      <KeyValue
                        label="availability_confidence"
                        value={
                          detail.candidate.availabilityConfidence == null
                            ? "-"
                            : `${(detail.candidate.availabilityConfidence * 100).toFixed(0)}%`
                        }
                      />
                    </div>
                  </div>
                </DetailBlock>

                <ReviewActions candidate={detail.candidate} />

                <DetailBlock title="Listing Preview">
                  {detail.candidate.listingId ? (
                    <>
                      <div className="grid gap-4 md:grid-cols-2">
                        <KeyValue label="Listing Status" value={formatListingStatus(detail.candidate.listingStatus)} />
                        <KeyValue label="Marketplace" value={detail.candidate.listingMarketplaceKey ?? "-"} />
                        <KeyValue label="Title" value={detail.candidate.listingTitle ?? "-"} />
                        <KeyValue label="Price" value={formatMoney(detail.candidate.listingPrice)} />
                        <KeyValue label="Quantity" value={detail.candidate.listingQuantity ?? "-"} />
                        <KeyValue label="Idempotency Key" value={detail.candidate.listingIdempotencyKey ?? "-"} />
                        <KeyValue label="Created At" value={formatDateTime(detail.candidate.listingCreatedAt)} />
                        <KeyValue label="Updated At" value={formatDateTime(detail.candidate.listingUpdatedAt)} />
                      </div>
                      <div className="mt-4">
                        <div className="mb-2 text-xs uppercase tracking-[0.16em] text-white/45">Payload Summary</div>
                        {renderListingPayloadSummary(detail.candidate.listingPayload)}
                      </div>
                      {renderListingResponseSummary(detail.candidate.listingResponse)}
                      <div className="mt-4">
                        <OptimizationDiagnostics listingResponse={detail.candidate.listingResponse} />
                      </div>
                      <div className="mt-4">
                        <AiListingDiagnostics listingResponse={detail.candidate.listingResponse} />
                      </div>
                    </>
                  ) : (
                    <div className="rounded-2xl border border-white/10 bg-black/20 p-4 text-sm text-white/55">
                      No listing preview has been prepared for this candidate yet.
                    </div>
                  )}
                </DetailBlock>

                <DetailBlock title="Listing Readiness">
                  <div className="grid gap-4 md:grid-cols-2">
                    <KeyValue
                      label="Listing Eligible"
                      value={
                        <span className={detail.candidate.listingEligible ? "text-emerald-200" : "text-rose-200"}>
                          {detail.candidate.listingEligible ? "YES" : "NO"}
                        </span>
                      }
                    />
                    <KeyValue
                      label="Blocking Risk Flags"
                      value={detail.candidate.blockingRiskFlags.length ? detail.candidate.blockingRiskFlags.join(", ") : "None"}
                    />
                  </div>
                  <div className="mt-4 rounded-2xl border border-white/10 bg-black/20 p-4 text-sm text-white/85">
                    {detail.candidate.listingEligibilityReasons.length ? (
                      <ul className="space-y-2">
                        {detail.candidate.listingEligibilityReasons.map((reason) => (
                          <li key={reason}>- {reason}</li>
                        ))}
                      </ul>
                    ) : (
                      "All listing-eligibility checks passed."
                    )}
                  </div>
                </DetailBlock>

                <DetailBlock title="Supporting Evidence">
                  <div className="grid gap-4 md:grid-cols-2">
                    <KeyValue label="Supplier Title" value={detail.supplierSnapshot?.title ?? "-"} />
                    <KeyValue label="Marketplace Title" value={detail.marketplaceSnapshot?.matchedTitle ?? "-"} />
                    <KeyValue
                      label="Supplier Price"
                      value={formatMoney(
                        detail.supplierSnapshot?.priceMin ?? detail.supplierSnapshot?.priceMax ?? null,
                        detail.supplierSnapshot?.currency ?? "USD"
                      )}
                    />
                    <KeyValue
                      label="Marketplace Price"
                      value={formatMoney(detail.marketplaceSnapshot?.price ?? null, detail.marketplaceSnapshot?.currency ?? "USD")}
                    />
                    <KeyValue
                      label="Supplier Source URL"
                      value={
                        detail.supplierSnapshot?.sourceUrl ? (
                          <a href={detail.supplierSnapshot.sourceUrl} className="text-cyan-100 underline" target="_blank" rel="noreferrer">
                            Open supplier source
                          </a>
                        ) : (
                          "-"
                        )
                      }
                    />
                    <KeyValue
                      label="Marketplace Listing URL"
                      value={
                        detail.marketplaceSnapshot?.productPageUrl ? (
                          <a href={detail.marketplaceSnapshot.productPageUrl} className="text-cyan-100 underline" target="_blank" rel="noreferrer">
                            Open marketplace listing
                          </a>
                        ) : (
                          "-"
                        )
                      }
                    />
                    <KeyValue label="Snapshot Quality" value={detail.supplierSnapshot?.snapshotQuality ?? "-"} />
                    <KeyValue
                      label="Telemetry Signals"
                      value={
                        detail.supplierSnapshot?.telemetrySignals?.length
                          ? detail.supplierSnapshot.telemetrySignals.join(", ")
                          : "-"
                      }
                    />
                    <KeyValue label="Listing Validity" value={detail.supplierSnapshot?.listingValidity ?? "-"} />
                    <KeyValue label="Price Signal" value={detail.supplierSnapshot?.priceSignal ?? "-"} />
                    <KeyValue label="Shipping Signal" value={detail.supplierSnapshot?.shippingSignal ?? "-"} />
                    <KeyValue label="Fee Breakdown" value={<pre className="overflow-x-auto text-xs text-white/75">{serializeDetails(detail.candidate.estimatedFees)}</pre>} />
                    <KeyValue label="Risk Flags" value={<div className="flex flex-wrap gap-2">{detail.candidate.riskFlags.length ? detail.candidate.riskFlags.map((flag) => <RiskBadge key={flag} flag={flag} />) : "None"}</div>} />
                  </div>
                </DetailBlock>

                <DetailBlock title="Match Evidence">
                  <div className="grid gap-4 md:grid-cols-3">
                    <KeyValue label="Match Type" value={detail.match?.matchType ?? "-"} />
                    <KeyValue label="Match Status" value={detail.match?.status ?? "-"} />
                    <KeyValue label="First / Last Seen" value={`${formatDateTime(detail.match?.firstSeenTs)} / ${formatDateTime(detail.match?.lastSeenTs)}`} />
                  </div>
                  <pre className="mt-4 overflow-x-auto rounded-2xl border border-white/10 bg-[#0a1020] p-4 text-xs text-white/75">
                    {serializeDetails(detail.match?.evidence)}
                  </pre>
                </DetailBlock>

                <DetailBlock title="Audit History">
                  <AuditList entries={detail.auditHistory} />
                </DetailBlock>
              </>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}
