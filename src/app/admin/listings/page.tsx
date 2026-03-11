import Link from "next/link";
import type { Metadata } from "next";
import {
  LISTINGS_ROUTE,
  getApprovedQueueItems,
  getListingsQueueDetail,
  getListingsQueueFilterOptions,
  getListingsQueueFiltersFromSearchParams,
  getListingsQueueOverview,
  type QueueListItem,
} from "@/lib/listings/getApprovedListingsQueueData";
import { LISTING_STATUSES } from "@/lib/listings/statuses";
import { isReviewConsoleConfigured } from "@/lib/review/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata: Metadata = {
  title: "Approved Listings Queue",
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

export default async function ListingsPage({ searchParams }: { searchParams?: Promise<SearchParams> }) {
  const resolvedSearchParams = await searchParams;
  const filters = getListingsQueueFiltersFromSearchParams(resolvedSearchParams);
  const promoteUpdated = String(resolvedSearchParams?.promoteUpdated ?? "").trim() === "1";
  const promoteError = String(resolvedSearchParams?.promoteError ?? "").trim();
  const previewUpdated = String(resolvedSearchParams?.previewUpdated ?? "").trim() === "1";
  const previewError = String(resolvedSearchParams?.previewError ?? "").trim();

  const [overview, filterOptions, rows] = await Promise.all([
    getListingsQueueOverview(),
    getListingsQueueFilterOptions(),
    getApprovedQueueItems(filters),
  ]);

  const selectedCandidateId = filters.candidateId || rows[0]?.id || "";
  const detail = selectedCandidateId ? await getListingsQueueDetail(selectedCandidateId) : null;
  const configured = isReviewConsoleConfigured();

  return (
    <main className="relative min-h-screen bg-app text-white">
      <div className="relative mx-auto max-w-[1800px] px-4 py-6 sm:px-6 lg:px-8">
        <header className="glass-card rounded-3xl border border-white/10 px-5 py-5 sm:px-6">
          <h1 className="text-3xl font-bold">Approved Listings Queue</h1>
          <p className="mt-2 text-sm text-white/65">
            Official queue for approved, listing-eligible candidates and publish readiness.
            Complements <code>/admin/review</code> and <code>/admin/control</code>.
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
          {promoteUpdated ? <div className="mt-4 rounded-2xl border border-emerald-300/25 bg-emerald-400/10 px-4 py-3 text-sm text-emerald-100">Preview promoted to READY_TO_PUBLISH.</div> : null}
          {promoteError ? <div className="mt-4 rounded-2xl border border-rose-300/25 bg-rose-400/10 px-4 py-3 text-sm text-rose-100">{promoteError}</div> : null}
        </header>

        <section className="mt-5 grid gap-4 md:grid-cols-5">
          <OverviewCard label="Approved candidates" value={overview.approvedCandidatesCount} />
          <OverviewCard label="Listing eligible" value={overview.listingEligibleCount} />
          <OverviewCard label="Preview prepared" value={overview.previewPreparedCount} />
          <OverviewCard label="Ready to publish" value={overview.readyToPublishCount} />
          <OverviewCard label="Publish failed" value={overview.publishFailedCount} />
        </section>

        <section className="glass-panel mt-5 rounded-3xl border border-white/10 p-4">
          <form action={LISTINGS_ROUTE} method="get" className="grid gap-3 xl:grid-cols-[repeat(8,minmax(0,1fr))_auto]">
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
            <div className="mb-3 text-sm text-white/65">Approved Candidate Table ({rows.length} rows)</div>
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
                        "duplicate",
                      ].map((h) => <th key={h} className="border-b border-white/10 px-3 py-2 text-left text-[11px] uppercase tracking-[0.16em] text-white/55">{h}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => {
                      const href = `${LISTINGS_ROUTE}?candidateId=${encodeURIComponent(row.id)}`;
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
                          <td className="border-b border-white/5 px-3 py-3">
                            {row.duplicateDetected ? (
                              <span className="text-rose-200">{row.duplicateReason ?? "YES"}</span>
                            ) : (
                              <span className="text-emerald-200">NO</span>
                            )}
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
              <div className="glass-panel rounded-3xl border border-white/10 p-6 text-sm text-white/55">No approved candidate selected.</div>
            ) : (
              <>
                <section className="glass-panel rounded-3xl border border-white/10 p-5">
                  <h2 className="mb-3 text-lg font-semibold">Listing Readiness Detail</h2>
                  <div className="grid gap-3 md:grid-cols-2">
                    <KeyValue label="Candidate ID" value={detail.item.id} />
                    <KeyValue label="Review decision" value={detail.item.decisionStatus} />
                    <KeyValue label="Supplier" value={`${detail.item.supplierKey} / ${detail.item.supplierProductId}`} />
                    <KeyValue label="Marketplace" value={`${detail.item.marketplaceKey} / ${detail.item.marketplaceListingId}`} />
                    <KeyValue label="Estimated profit" value={formatMoney(detail.item.estimatedProfit)} />
                    <KeyValue label="Margin / ROI" value={`${formatPercent(detail.item.marginPct)} / ${formatPercent(detail.item.roiPct)}`} />
                    <KeyValue label="Approved at" value={formatDateTime(detail.item.approvedTs)} />
                    <KeyValue label="Approved by" value={detail.item.approvedBy ?? "-"} />
                    <KeyValue label="Listing eligible" value={detail.item.listingEligible ? "YES" : "NO"} />
                    <KeyValue label="Eligibility reasons" value={detail.item.listingEligibilityReasons.length ? detail.item.listingEligibilityReasons.join("; ") : "Passed"} />
                    <KeyValue label="Duplicate warning" value={detail.item.duplicateDetected ? (detail.item.duplicateReason ?? "YES") : "NO"} />
                    <KeyValue label="Preview readiness" value={detail.item.previewStatus} />
                    <KeyValue label="Missing fields" value={detail.item.previewMissingFields.length ? detail.item.previewMissingFields.join(", ") : "None"} />
                    <KeyValue label="Latest listing row" value={detail.item.listingId ? `${detail.item.listingId} (${detail.item.listingStatus ?? "-"})` : "None"} />
                    <KeyValue label="Listing updated" value={formatDateTime(detail.item.listingUpdatedAt)} />
                  </div>
                </section>

                <section className="glass-panel rounded-3xl border border-white/10 p-5">
                  <h2 className="mb-3 text-lg font-semibold">Actions</h2>
                  <div className="space-y-4">
                    <div>
                      <div className="mb-2 text-xs uppercase tracking-[0.16em] text-white/45">Prepare listing preview</div>
                      <form action="/api/admin/review/prepare-preview" method="post">
                        <input type="hidden" name="candidateId" value={detail.item.id} />
                        <input type="hidden" name="marketplace" value={detail.item.marketplaceKey} />
                        <input type="hidden" name="forceRefresh" value={detail.item.listingId ? "true" : "false"} />
                        <button type="submit" className="rounded-2xl border border-cyan-300/30 bg-cyan-400/12 px-4 py-2 text-sm font-semibold text-cyan-100">{detail.item.listingId ? "Refresh Preview" : "Prepare Preview"}</button>
                      </form>
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
