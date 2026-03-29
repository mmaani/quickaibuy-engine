import Link from "next/link";
import type { Metadata } from "next";
import {
  LISTINGS_ROUTE,
  getRiskFilterLegend,
  getApprovedQueueItems,
  getListingsQueueDetail,
  getListingsQueueFilterOptions,
  getListingsQueueFiltersFromSearchParams,
  getListingsQueueOverview,
  type QueueListItem,
} from "@/lib/listings/getApprovedListingsQueueData";
import { LISTING_STATUSES } from "@/lib/listings/statuses";
import type { RecoveryState } from "@/lib/listings/recoveryState";
import { isReviewConsoleConfigured } from "@/lib/review/auth";
import { AiListingDiagnostics } from "@/components/admin/AiListingDiagnostics";
import { ControlPlaneOverviewPanel } from "@/components/admin/ControlPlaneOverviewPanel";
import { OptimizationDiagnostics } from "@/components/admin/OptimizationDiagnostics";
import { getControlPlaneOverview } from "@/lib/controlPlane/getControlPlaneOverview";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata: Metadata = {
  title: "Listings Recovery Queue",
  robots: { index: false, follow: false },
};

type SearchParams = Record<string, string | string[] | undefined>;

function formatMoney(value: number | null): string {
  if (value == null) return "-";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(value);
}

function formatPercent(value: number | null): string {
  if (value == null) return "-";
  return `${value.toFixed(2)}%`;
}

function formatDateTime(value: string | null | undefined): string {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" });
}

function OverviewCard({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
      <div className="text-[11px] uppercase tracking-[0.18em] text-white/50">{label}</div>
      <div className="mt-2 text-3xl font-semibold text-white">{value}</div>
    </div>
  );
}

function previewBadge(item: QueueListItem) {
  if (item.previewStatus === "PREPARED") return <span className="text-emerald-200">PREPARED</span>;
  if (item.previewStatus === "INCOMPLETE") return <span className="text-amber-200">INCOMPLETE</span>;
  return <span className="text-white/65">NOT_PREPARED</span>;
}

function getPromoteDisabledReason(item: QueueListItem): string | null {
  if (!item.listingId) return "Preview must exist before promotion.";
  if (item.marketplaceKey !== "ebay") return "Promotion is eBay-only in v1.";
  if (item.decisionStatus !== "APPROVED") return "Candidate must remain APPROVED.";
  if (!item.listingEligible) return "Candidate is not listing eligible.";
  if (item.duplicateDetected) return item.duplicateReason || "Duplicate listing conflict detected.";
  if (item.listingStatus !== LISTING_STATUSES.PREVIEW) return "Only PREVIEW status can be promoted.";
  if (item.previewStatus !== "PREPARED") return "Preview data is incomplete.";
  return null;
}

function KeyValue({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-black/20 p-3">
      <div className="text-[11px] uppercase tracking-[0.18em] text-white/45">{label}</div>
      <div className="mt-2 text-sm text-white/90">{value}</div>
    </div>
  );
}

function recoveryStateLabel(state: RecoveryState): string {
  if (state === "PAUSED_REQUIRES_RESUME") return "PAUSED_REQUIRES_RESUME";
  if (state === "BLOCKED_STALE_MARKETPLACE") return "BLOCKED_STALE_MARKETPLACE";
  if (state === "BLOCKED_SUPPLIER_DRIFT") return "BLOCKED_SUPPLIER_DRIFT";
  if (state === "BLOCKED_STALE_SUPPLIER") return "BLOCKED_STALE_SUPPLIER";
  if (state === "BLOCKED_OTHER_FAIL_CLOSED") return "BLOCKED_OTHER_FAIL_CLOSED";
  if (state === "READY_FOR_REEVALUATION") return "READY_FOR_REEVALUATION";
  if (state === "READY_FOR_REPROMOTION") return "READY_FOR_REPROMOTION";
  return "NONE";
}

function recoveryTone(state: RecoveryState): string {
  if (state === "PAUSED_REQUIRES_RESUME") return "text-amber-100";
  if (
    state === "BLOCKED_STALE_MARKETPLACE" ||
    state === "BLOCKED_SUPPLIER_DRIFT" ||
    state === "BLOCKED_STALE_SUPPLIER" ||
    state === "BLOCKED_OTHER_FAIL_CLOSED"
  ) {
    return "text-rose-100";
  }
  if (state === "READY_FOR_REEVALUATION") return "text-amber-100";
  if (state === "READY_FOR_REPROMOTION") return "text-emerald-100";
  return "text-white/55";
}

function isRecoveryBlocked(state: RecoveryState): boolean {
  return (
    state === "BLOCKED_STALE_MARKETPLACE" ||
    state === "BLOCKED_SUPPLIER_DRIFT" ||
    state === "BLOCKED_STALE_SUPPLIER" ||
    state === "BLOCKED_OTHER_FAIL_CLOSED"
  );
}

function triageLabel(row: QueueListItem): { label: string; tone: string } {
  if (row.rePromotionReady) return { label: "Ready to re-promote", tone: "text-emerald-200" };
  if (row.reEvaluationNeeded) return { label: "Re-evaluate", tone: "text-amber-200" };
  if (row.pausedByInventoryRisk) return { label: "Paused by risk", tone: "text-rose-200" };
  if (isRecoveryBlocked(row.recoveryState)) return { label: "Blocked recovery", tone: "text-rose-200" };
  if (row.previewStatus === "INCOMPLETE") return { label: "Refresh preview", tone: "text-amber-200" };
  if (row.previewStatus === "PREPARED") return { label: "Preview prepared", tone: "text-cyan-200" };
  return { label: "Needs automation", tone: "text-white/70" };
}

export default async function ListingsPage({ searchParams }: { searchParams?: Promise<SearchParams> }) {
  const resolvedSearchParams = await searchParams;
  const filters = getListingsQueueFiltersFromSearchParams(resolvedSearchParams);
  const activeRiskLegend = getRiskFilterLegend(filters.riskFilter);
  const promoteUpdated = String(resolvedSearchParams?.promoteUpdated ?? "").trim() === "1";
  const promoteError = String(resolvedSearchParams?.promoteError ?? "").trim();
  const previewUpdated = String(resolvedSearchParams?.previewUpdated ?? "").trim() === "1";
  const previewError = String(resolvedSearchParams?.previewError ?? "").trim();
  const reevaluateUpdated = String(resolvedSearchParams?.reevaluateUpdated ?? "").trim() === "1";
  const reevaluateBlocked = String(resolvedSearchParams?.reevaluateBlocked ?? "").trim() === "1";
  const reevaluateReason = String(resolvedSearchParams?.reevaluateReason ?? "").trim();
  const reevaluateDecision = String(resolvedSearchParams?.reevaluateDecision ?? "").trim();
  const reevaluateState = String(resolvedSearchParams?.reevaluateState ?? "").trim();
  const reevaluateNextAction = String(resolvedSearchParams?.reevaluateNextAction ?? "").trim();
  const resumeUpdated = String(resolvedSearchParams?.resumeUpdated ?? "").trim() === "1";
  const resumeError = String(resolvedSearchParams?.resumeError ?? "").trim();

  const [overview, filterOptions, rows, controlPlane] = await Promise.all([
    getListingsQueueOverview(),
    getListingsQueueFilterOptions(),
    getApprovedQueueItems(filters),
    getControlPlaneOverview(),
  ]);
  const blockedRecoveryCount = rows.filter((row) => isRecoveryBlocked(row.recoveryState)).length;
  const reevaluationCount = rows.filter((row) => row.reEvaluationNeeded).length;
  const repromotionCount = rows.filter((row) => row.rePromotionReady).length;
  const autoPausedCount = rows.filter((row) => row.pausedByInventoryRisk).length;

  const selectedCandidateId = filters.candidateId || rows[0]?.id || "";
  const detail = selectedCandidateId ? await getListingsQueueDetail(selectedCandidateId) : null;
  const configured = isReviewConsoleConfigured();

  return (
    <main className="relative min-h-screen bg-app text-white">
      <div className="relative mx-auto max-w-[1800px] px-4 py-6 sm:px-6 lg:px-8">
        <header className="glass-card rounded-3xl border border-white/10 px-5 py-5 sm:px-6">
          <h1 className="text-3xl font-bold">Listings Recovery Queue</h1>
          <p className="mt-2 text-sm text-white/65">
            Canonical queue for approved listings, blocked recovery, and publish-readiness exceptions.
            Use this alongside <code>/admin/review</code> for candidate decisions and <code>/admin/control</code> for autonomous recovery.
          </p>
          <p className="mt-2 text-xs text-white/45">Route: {LISTINGS_ROUTE} | Auth configured: {configured ? "yes" : "no"}</p>
          <div className="mt-3 flex flex-wrap gap-3 text-xs">
            <Link className="rounded-xl border border-white/15 px-3 py-1.5 text-white/85" href="/admin/review">
              Open /admin/review
            </Link>
            <Link className="rounded-xl border border-white/15 px-3 py-1.5 text-white/85" href="/admin/control">
              Open /admin/control
            </Link>
          </div>

          {previewUpdated ? <div className="mt-4 rounded-2xl border border-emerald-300/25 bg-emerald-400/10 px-4 py-3 text-sm text-emerald-100">Listing preview prepared/updated.</div> : null}
          {previewError ? <div className="mt-4 rounded-2xl border border-rose-300/25 bg-rose-400/10 px-4 py-3 text-sm text-rose-100">{previewError}</div> : null}
          {reevaluateUpdated ? (
            <div className="mt-4 rounded-2xl border border-cyan-300/25 bg-cyan-400/10 px-4 py-3 text-sm text-cyan-100">
              Re-evaluation completed. Decision: {reevaluateDecision || "READY_FOR_REPROMOTION"}. Promotion remains operator-triggered.
              {reevaluateState ? ` State: ${reevaluateState}.` : ""}
              {reevaluateNextAction ? ` Next action: ${reevaluateNextAction}` : ""}
            </div>
          ) : null}
          {reevaluateBlocked ? (
            <div className="mt-4 rounded-2xl border border-amber-300/25 bg-amber-400/10 px-4 py-3 text-sm text-amber-100">
              Re-evaluation completed: listing remains blocked. {reevaluateReason || "Run refresh and re-check again."}
              {reevaluateState ? ` State: ${reevaluateState}.` : ""}
              {reevaluateNextAction ? ` Next action: ${reevaluateNextAction}` : ""}
            </div>
          ) : null}
          {promoteUpdated ? <div className="mt-4 rounded-2xl border border-emerald-300/25 bg-emerald-400/10 px-4 py-3 text-sm text-emerald-100">Preview promoted to READY_TO_PUBLISH.</div> : null}
          {promoteError ? <div className="mt-4 rounded-2xl border border-rose-300/25 bg-rose-400/10 px-4 py-3 text-sm text-rose-100">{promoteError}</div> : null}
          {resumeUpdated ? <div className="mt-4 rounded-2xl border border-emerald-300/25 bg-emerald-400/10 px-4 py-3 text-sm text-emerald-100">Paused listing resumed to PREVIEW. Promotion remains explicit and operator-triggered.</div> : null}
          {resumeError ? <div className="mt-4 rounded-2xl border border-rose-300/25 bg-rose-400/10 px-4 py-3 text-sm text-rose-100">{resumeError}</div> : null}
        </header>

        <ControlPlaneOverviewPanel data={controlPlane} variant="compact" />

        <section className="mt-5 glass-panel rounded-3xl border border-white/10 p-4">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold text-white">Listings Exception Triage</h2>
              <p className="mt-2 text-sm text-white/65">
                Routine preview preparation and promotion should happen through automation. Use this page for blocked recovery, re-evaluation, and explicit operator checks.
              </p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-white/80">
              Ready to publish now: <span className="font-semibold text-emerald-100">{overview.readyToPublishCount}</span>
            </div>
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            <KeyValue label="Visible rows" value={String(rows.length)} />
            <KeyValue label="Blocked recovery" value={String(blockedRecoveryCount)} />
            <KeyValue label="Needs re-evaluation" value={String(reevaluationCount)} />
            <KeyValue label="Ready for re-promotion" value={String(repromotionCount)} />
            <KeyValue label="Auto-paused by risk" value={String(autoPausedCount)} />
          </div>
          <div className="mt-4 grid gap-3 lg:grid-cols-3">
            <div className="rounded-2xl border border-white/10 bg-black/20 p-3 text-sm text-white/75">
              Re-evaluation and re-promotion rows should clear through guarded listing recovery, not ad hoc operator edits.
            </div>
            <div className="rounded-2xl border border-white/10 bg-black/20 p-3 text-sm text-white/75">
              Risk-paused rows stay fail-closed until supplier truth, shipping, and pricing checks recover.
            </div>
            <div className="rounded-2xl border border-white/10 bg-black/20 p-3 text-sm text-white/75">
              Manual promotion is fallback only. The normal path remains automated PREVIEW to READY_TO_PUBLISH.
            </div>
          </div>
        </section>

        {activeRiskLegend ? (
          <section className="mt-5 rounded-2xl border border-cyan-300/25 bg-cyan-400/10 px-4 py-3 text-sm text-cyan-100">
            <div className="font-semibold">{activeRiskLegend.label}</div>
            <div className="mt-1 text-cyan-50/90">
              {activeRiskLegend.description} <span className="text-cyan-50/70">Filter: {activeRiskLegend.technicalLabel}</span>
            </div>
          </section>
        ) : null}

        <section className="mt-5 grid gap-4 md:grid-cols-5">
          <OverviewCard label="Approved now" value={overview.approvedCandidatesCount} />
          <OverviewCard label="Eligible now" value={overview.listingEligibleCount} />
          <OverviewCard label="Preview rows" value={overview.previewPreparedCount} />
          <OverviewCard label="Ready now" value={overview.readyToPublishCount} />
          <OverviewCard label="Publish failed" value={overview.publishFailedCount} />
        </section>

        <section className="glass-panel mt-5 rounded-3xl border border-white/10 p-4">
          <form action={LISTINGS_ROUTE} method="get" className="grid gap-3 xl:grid-cols-[repeat(8,minmax(0,1fr))_auto]">
            {filters.riskFilter ? <input type="hidden" name="riskFilter" value={filters.riskFilter} /> : null}
            <select name="supplier" defaultValue={filters.supplier} className="contact-input">
              <option value="">All suppliers</option>
              {filterOptions.suppliers.map((supplier) => <option key={supplier} value={supplier}>{supplier}</option>)}
            </select>
            <select name="marketplace" defaultValue={filters.marketplace} className="contact-input">
              <option value="">All marketplaces</option>
              {filterOptions.marketplaces.map((marketplace) => <option key={marketplace} value={marketplace}>{marketplace}</option>)}
            </select>
            <select name="listingEligible" defaultValue={filters.listingEligible} className="contact-input">
              <option value="">Listing eligible: all</option>
              <option value="yes">Listing eligible: yes</option>
              <option value="no">Listing eligible: no</option>
            </select>
            <select name="previewPrepared" defaultValue={filters.previewPrepared} className="contact-input">
              <option value="">Preview prepared: all</option>
              <option value="yes">Preview prepared: yes</option>
              <option value="no">Preview prepared: no</option>
            </select>
            <select name="listingStatus" defaultValue={filters.listingStatus} className="contact-input">
              <option value="">All listing statuses</option>
              {filterOptions.listingStatuses.map((status) => <option key={status} value={status}>{status}</option>)}
            </select>
            <input name="minProfit" defaultValue={filters.minProfit} className="contact-input" placeholder="Min profit" />
            <input name="minMargin" defaultValue={filters.minMargin} className="contact-input" placeholder="Min margin %" />
            <input name="minRoi" defaultValue={filters.minRoi} className="contact-input" placeholder="Min ROI %" />
            <button type="submit" className="rounded-2xl border border-cyan-300/30 bg-cyan-400/12 px-4 py-2 text-sm font-semibold text-cyan-100">Apply</button>
          </form>
        </section>

        <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,860px)_minmax(0,1fr)]">
          <section className="glass-panel rounded-3xl border border-white/10 p-4">
            <div className="mb-3 text-sm text-white/65">Listings Queue Table ({rows.length} rows)</div>
            <div className="overflow-hidden rounded-2xl border border-white/10">
              <div className="max-h-[76vh] overflow-auto">
                <table className="min-w-full border-collapse text-sm text-white/90">
                  <thead className="sticky top-0 bg-[#111827]">
                    <tr>
                      {[
                        "candidate id",
                        "supplier_key",
                        "supplier_product_id",
                        "marketplace_key",
                        "marketplace_listing_id",
                        "estimated_profit",
                        "margin_pct",
                        "roi_pct",
                        "decision_status",
                        "listing eligible",
                        "preview status",
                        "listing status",
                        "commercial state",
                        "recovery",
                        "duplicate",
                        "triage",
                    ].map((h) => <th key={h} className="border-b border-white/10 px-3 py-2 text-left text-[11px] uppercase tracking-[0.16em] text-white/55">{h}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => {
                      const rowSearch = new URLSearchParams();
                      rowSearch.set("candidateId", row.id);
                      if (filters.riskFilter) rowSearch.set("riskFilter", filters.riskFilter);
                      const href = `${LISTINGS_ROUTE}?${rowSearch.toString()}`;
                      return (
                        <tr key={row.id} className={selectedCandidateId === row.id ? "bg-cyan-500/10" : "odd:bg-transparent even:bg-white/[0.02]"}>
                          <td className="border-b border-white/5 px-3 py-3"><Link href={href} className="text-cyan-100 underline">{row.id}</Link></td>
                          <td className="border-b border-white/5 px-3 py-3">{row.supplierKey}</td>
                          <td className="border-b border-white/5 px-3 py-3">{row.supplierProductId}</td>
                          <td className="border-b border-white/5 px-3 py-3">{row.marketplaceKey}</td>
                          <td className="border-b border-white/5 px-3 py-3">{row.marketplaceListingId}</td>
                          <td className="border-b border-white/5 px-3 py-3">{formatMoney(row.estimatedProfit)}</td>
                          <td className="border-b border-white/5 px-3 py-3">{formatPercent(row.marginPct)}</td>
                          <td className="border-b border-white/5 px-3 py-3">{formatPercent(row.roiPct)}</td>
                          <td className="border-b border-white/5 px-3 py-3">{row.decisionStatus}</td>
                          <td className="border-b border-white/5 px-3 py-3">{row.listingEligible ? "YES" : "NO"}</td>
                          <td className="border-b border-white/5 px-3 py-3">{previewBadge(row)}</td>
                          <td className="border-b border-white/5 px-3 py-3">{row.listingStatus ?? "-"}</td>
                          <td className="border-b border-white/5 px-3 py-3">{row.commercialState ?? "-"}</td>
                          <td className="border-b border-white/5 px-3 py-3">
                            {row.recoveryState !== "NONE" ? (
                              <div>
                                <div className={recoveryTone(row.recoveryState)}>{recoveryStateLabel(row.recoveryState)}</div>
                                {row.recoveryBlockReasonCode ? <div className="text-xs text-white/50">{row.recoveryBlockReasonCode}</div> : null}
                              </div>
                            ) : (
                              <span className="text-white/55">-</span>
                            )}
                          </td>
                          <td className="border-b border-white/5 px-3 py-3">
                            {row.duplicateDetected ? (
                              <span className="text-rose-200">{row.duplicateReason ?? "YES"}</span>
                            ) : (
                              <span className="text-emerald-200">NO</span>
                            )}
                          </td>
                          <td className="border-b border-white/5 px-3 py-3">
                            <span className={`text-xs uppercase tracking-[0.12em] ${triageLabel(row).tone}`}>
                              {triageLabel(row).label}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </section>

          <section className="space-y-5">
            {!detail ? (
              <div className="glass-panel rounded-3xl border border-white/10 p-6 text-sm text-white/55">No listing candidate selected.</div>
            ) : (
              <>
                <section className="glass-panel rounded-3xl border border-white/10 p-5">
                  <h2 className="mb-3 text-lg font-semibold">Listing Recovery Detail</h2>
                  <div className="grid gap-3 md:grid-cols-2">
                    <KeyValue label="Candidate ID" value={detail.item.id} />
                    <KeyValue label="Review decision" value={detail.item.decisionStatus} />
                    <KeyValue label="Supplier" value={`${detail.item.supplierKey} / ${detail.item.supplierProductId}`} />
                    <KeyValue
                      label="Best Source Policy"
                      value={detail.item.selectionSummary ?? detail.item.selectionMode ?? "-"}
                    />
                    <KeyValue
                      label="Compared Sources"
                      value={detail.item.consideredSources.length ? detail.item.consideredSources.join(", ") : detail.item.supplierKey}
                    />
                    <KeyValue label="Marketplace" value={`${detail.item.marketplaceKey} / ${detail.item.marketplaceListingId}`} />
                    <KeyValue label="Estimated profit" value={formatMoney(detail.item.estimatedProfit)} />
                    <KeyValue label="Shipping cost component" value={formatMoney(detail.item.shippingCostComponent)} />
                    <KeyValue
                      label="Shipping route"
                      value={`${detail.item.shippingOriginCountry ?? "?"} → ${detail.item.shippingDestinationCountry ?? "?"}`}
                    />
                    <KeyValue
                      label="Shipping quote age"
                      value={detail.item.shippingQuoteAgeHours == null ? "-" : `${detail.item.shippingQuoteAgeHours}h`}
                    />
                    <KeyValue label="Shipping mode" value={detail.item.shippingResolutionMode ?? "-"} />
                    <KeyValue label="Margin / ROI" value={`${formatPercent(detail.item.marginPct)} / ${formatPercent(detail.item.roiPct)}`} />
                    <KeyValue label="Approved at" value={formatDateTime(detail.item.approvedTs)} />
                    <KeyValue label="Approved by" value={detail.item.approvedBy ?? "-"} />
                    <KeyValue label="Listing eligible" value={detail.item.listingEligible ? "YES" : "NO"} />
                    <KeyValue label="Eligibility reasons" value={detail.item.listingEligibilityReasons.length ? detail.item.listingEligibilityReasons.join("; ") : "Passed"} />
                    <KeyValue label="Recovery state" value={recoveryStateLabel(detail.item.recoveryState)} />
                    <KeyValue label="Recovery block reason code" value={detail.item.recoveryBlockReasonCode ?? "-"} />
                    <KeyValue label="Recovery reason codes" value={detail.item.recoveryReasonCodes.length ? detail.item.recoveryReasonCodes.join(", ") : "-"} />
                    <KeyValue label="Re-evaluation needed" value={detail.item.reEvaluationNeeded ? "YES" : "NO"} />
                    <KeyValue label="Re-promotion ready" value={detail.item.rePromotionReady ? "YES" : "NO"} />
                    <KeyValue label="Recovery next action" value={detail.item.recoveryNextAction} />
                    <KeyValue label="Duplicate warning" value={detail.item.duplicateDetected ? (detail.item.duplicateReason ?? "YES") : "NO"} />
                    <KeyValue label="Preview readiness" value={detail.item.previewStatus} />
                    <KeyValue label="Commercial state" value={detail.item.commercialState ?? "-"} />
                    <KeyValue label="First-sale score" value={detail.item.firstSaleScore ?? "-"} />
                    <KeyValue label="First-sale candidate" value={detail.item.firstSaleCandidate ? "YES" : "NO"} />
                    <KeyValue label="Missing fields" value={detail.item.previewMissingFields.length ? detail.item.previewMissingFields.join(", ") : "None"} />
                    <KeyValue label="Latest listing row" value={detail.item.listingId ? `${detail.item.listingId} (${detail.item.listingStatus ?? "-"})` : "None"} />
                    <KeyValue label="Paused by inventory risk" value={detail.item.pausedByInventoryRisk ? "YES" : "NO"} />
                    <KeyValue label="Pause reason" value={detail.item.pauseReason || "-"} />
                    <KeyValue label="Listing updated" value={formatDateTime(detail.item.listingUpdatedAt)} />
                    <KeyValue label="Reprice action" value={detail.item.repriceAction ?? "-"} />
                    <KeyValue label="Reprice reason" value={detail.item.repriceLastReason ?? "-"} />
                    <KeyValue label="Last reprice eval" value={formatDateTime(detail.item.repriceLastEvaluatedTs)} />
                    <KeyValue label="Last reprice applied" value={formatDateTime(detail.item.repriceLastAppliedTs)} />
                    <KeyValue label="Supplier reevaluation" value={detail.item.supplierReevaluationStatus ?? "-"} />
                    <KeyValue
                      label="Best alternate supplier"
                      value={
                        detail.item.supplierReevaluationBestSupplierKey
                          ? `${detail.item.supplierReevaluationBestSupplierKey} / ${detail.item.supplierReevaluationBestSupplierProductId ?? "-"}`
                          : "-"
                      }
                    />
                    <KeyValue
                      label="Current vs best landed"
                      value={`${formatMoney(detail.item.supplierReevaluationCurrentLandedCostUsd)} / ${formatMoney(detail.item.supplierReevaluationBestLandedCostUsd)}`}
                    />
                    <KeyValue
                      label="Supplier reevaluation ts"
                      value={formatDateTime(detail.item.supplierReevaluationEvaluatedTs)}
                    />
                    <KeyValue label="Latest recovery audit" value={detail.latestRecoveryAudit ? `${detail.latestRecoveryAudit.eventType} @ ${formatDateTime(detail.latestRecoveryAudit.eventTs)}` : "No recovery audit event found"} />
                  </div>
                  <div className="mt-4">
                    <OptimizationDiagnostics listingResponse={detail.item.listingResponse} />
                  </div>
                  <div className="mt-4">
                    <AiListingDiagnostics listingResponse={detail.item.listingResponse} />
                  </div>
                </section>

                <section className="glass-panel rounded-3xl border border-white/10 p-5">
                  <h2 className="mb-3 text-lg font-semibold">Actions</h2>
                  <div className="space-y-4">
                    <div>
                      <div className="mb-2 text-xs uppercase tracking-[0.16em] text-white/45">Prepare listing preview</div>
                      <div className="mb-2 text-sm text-white/60">
                        Use preview preparation for approved rows or explicit recovery checks. Routine preview generation should continue to flow through automation.
                      </div>
                      <form action="/api/admin/review/prepare-preview" method="post">
                        <input type="hidden" name="candidateId" value={detail.item.id} />
                        <input type="hidden" name="marketplace" value={detail.item.marketplaceKey} />
                        <input type="hidden" name="forceRefresh" value={detail.item.listingId ? "true" : "false"} />
                        <button type="submit" className="rounded-2xl border border-cyan-300/30 bg-cyan-400/12 px-4 py-2 text-sm font-semibold text-cyan-100">{detail.item.listingId ? "Refresh Preview" : "Prepare Preview"}</button>
                      </form>
                    </div>

                    <div>
                      <div className="mb-2 text-xs uppercase tracking-[0.16em] text-white/45">Re-evaluate recovery</div>
                      <form action="/api/admin/listings/re-evaluate" method="post">
                        <input type="hidden" name="candidateId" value={detail.item.id} />
                        <input type="hidden" name="listingId" value={detail.item.listingId ?? ""} />
                        <button
                          type="submit"
                          disabled={!detail.item.listingId}
                          className="rounded-2xl border border-amber-300/30 bg-amber-400/12 px-4 py-2 text-sm font-semibold text-amber-100 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          Re-evaluate recovery state
                        </button>
                      </form>
                      {!detail.item.listingId ? <div className="mt-2 text-xs text-amber-100">Disabled: listing row required.</div> : null}
                    </div>

                    <div>
                      <div className="mb-2 text-xs uppercase tracking-[0.16em] text-white/45">Resume paused listing</div>
                      <form action="/api/admin/listings/resume" method="post">
                        <input type="hidden" name="candidateId" value={detail.item.id} />
                        <input type="hidden" name="listingId" value={detail.item.listingId ?? ""} />
                        <button
                          type="submit"
                          disabled={detail.item.listingStatus !== LISTING_STATUSES.PAUSED}
                          className="rounded-2xl border border-indigo-300/30 bg-indigo-400/12 px-4 py-2 text-sm font-semibold text-indigo-100 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          Resume to PREVIEW
                        </button>
                      </form>
                      {detail.item.listingStatus !== LISTING_STATUSES.PAUSED ? <div className="mt-2 text-xs text-amber-100">Disabled: listing must be PAUSED.</div> : <div className="mt-2 text-xs text-white/60">Required explicit approval step before any re-promotion.</div>}
                    </div>

                    <div>
                      <div className="mb-2 text-xs uppercase tracking-[0.16em] text-white/45">Promote preview ready</div>
                      {(() => {
                        const disabledReason = getPromoteDisabledReason(detail.item);
                        return (
                          <>
                            <form action="/api/admin/listings/promote-ready" method="post">
                              <input type="hidden" name="candidateId" value={detail.item.id} />
                              <input type="hidden" name="listingId" value={detail.item.listingId ?? ""} />
                              <button
                                type="submit"
                                disabled={Boolean(disabledReason)}
                                className="rounded-2xl border border-emerald-300/30 bg-emerald-400/12 px-4 py-2 text-sm font-semibold text-emerald-100 disabled:cursor-not-allowed disabled:opacity-50"
                              >
                                Promote to READY_TO_PUBLISH
                              </button>
                            </form>
                            {disabledReason ? <div className="mt-2 text-xs text-amber-100">Disabled: {disabledReason}</div> : null}
                          </>
                        );
                      })()}
                    </div>

                    <div className="flex flex-wrap gap-3 pt-2">
                      <Link href={`/admin/review?candidateId=${encodeURIComponent(detail.item.id)}`} className="rounded-xl border border-white/15 px-3 py-1.5 text-sm text-white/90">Open candidate in /admin/review</Link>
                      <Link href="/admin/control" className="rounded-xl border border-white/15 px-3 py-1.5 text-sm text-white/90">Open control panel in /admin/control</Link>
                    </div>
                  </div>
                </section>

                <section className="glass-panel rounded-3xl border border-white/10 p-5">
                  <h2 className="mb-3 text-lg font-semibold">Recent Relevant Audit Events</h2>
                  {detail.recentAuditEvents.length === 0 ? (
                    <div className="text-sm text-white/55">No recent events for candidate/listing.</div>
                  ) : (
                    <div className="space-y-3">
                      {detail.recentAuditEvents.map((entry) => (
                        <div key={entry.id} className="rounded-2xl border border-white/10 bg-black/20 p-3">
                          <div className="flex items-center justify-between gap-3">
                            <div className="text-sm text-white">{entry.eventType}</div>
                            <div className="text-xs text-white/45">{formatDateTime(entry.eventTs)}</div>
                          </div>
                          <div className="mt-1 text-xs text-white/45">{entry.actorType}{entry.actorId ? ` / ${entry.actorId}` : ""} / {entry.entityType} / {entry.entityId}</div>
                        </div>
                      ))}
                    </div>
                  )}
                </section>
              </>
            )}
          </section>
        </div>
      </div>
    </main>
  );
}
