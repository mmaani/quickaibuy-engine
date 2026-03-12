import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import RefreshButton from "@/app/_components/RefreshButton";
import { getControlPanelData } from "@/lib/control/getControlPanelData";
import { getManualOverrideSnapshot, setManualOverride, type ManualOverrideKey } from "@/lib/control/manualOverrides";
import {
  getReviewActorIdFromAuthorizationHeader,
  isAuthorizedReviewAuthorizationHeader,
  isReviewConsoleConfigured,
} from "@/lib/review/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata: Metadata = {
  title: "Operational Control Panel",
  robots: { index: false, follow: false },
};

type SearchParams = Record<string, string | string[] | undefined>;

function one(value: string | string[] | undefined): string | null {
  return Array.isArray(value) ? (value[0] ?? null) : (value ?? null);
}

async function requireAdmin(): Promise<string> {
  const auth = (await headers()).get("authorization");
  if (!isReviewConsoleConfigured() || !isAuthorizedReviewAuthorizationHeader(auth)) {
    redirect("/admin/review");
  }
  return getReviewActorIdFromAuthorizationHeader(auth) ?? "admin";
}

function asCell(value: unknown): string {
  if (value == null) return "-";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function DataTable({ rows, empty }: { rows: Array<Record<string, unknown>>; empty: string }) {
  if (!rows.length) {
    return <div className="rounded-xl border border-white/10 bg-black/15 p-3 text-sm text-white/55">{empty}</div>;
  }

  const cols = Array.from(
    rows.reduce((set, row) => {
      Object.keys(row).forEach((k) => set.add(k));
      return set;
    }, new Set<string>())
  );

  return (
    <div className="w-full overflow-x-auto rounded-2xl border border-white/10 bg-black/15">
      <table className="min-w-max w-full border-collapse text-sm text-white/90">
        <thead>
          <tr>
            {cols.map((col) => (
              <th key={col} className="border-b border-white/10 bg-[#121824] px-3 py-2 text-left text-xs uppercase tracking-[0.14em] text-white/60">
                {col}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, idx) => (
            <tr key={idx} className="odd:bg-transparent even:bg-white/[0.02]">
              {cols.map((col) => (
                <td key={col} className="max-w-[340px] break-words border-b border-white/5 px-3 py-2 align-top">
                  {asCell(row[col])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
      <div className="text-[11px] uppercase tracking-[0.2em] text-white/55">{label}</div>
      <div className="mt-2 text-2xl font-bold">{value}</div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="glass-panel rounded-3xl border border-white/10 p-5">
      <h2 className="mb-3 text-lg font-semibold">{title}</h2>
      {children}
    </section>
  );
}

function metricOrUnknown(value: number | null, wired: boolean): React.ReactNode {
  if (!wired) return "not wired yet";
  return value ?? "-";
}

function percentOrUnknown(value: number | null, wired: boolean): React.ReactNode {
  if (!wired) return "not wired yet";
  if (value == null) return "unknown";
  return `${value.toFixed(2)}%`;
}

function blockedReason(action: string, snapshot: Awaited<ReturnType<typeof getManualOverrideSnapshot>>): string | null {
  if (!snapshot.available) return "Manual override store unavailable. Actions blocked for safety.";
  if (snapshot.entries.EMERGENCY_READ_ONLY.enabled) return "Emergency read-only mode is active.";
  if (
    snapshot.entries.PAUSE_PUBLISHING.enabled &&
    (action === "promote" || action === "dry-run" || action === "monitor" || action === "prepare")
  ) {
    return "Publishing is paused.";
  }
  if (snapshot.entries.PAUSE_MARKETPLACE_SCAN.enabled && action === "scan") {
    return "Marketplace scan is paused.";
  }
  if (snapshot.entries.PAUSE_ORDER_SYNC.enabled && action === "order-sync") {
    return "Order sync is paused.";
  }
  return null;
}

function getQuickActionState(
  action: string,
  snapshot: Awaited<ReturnType<typeof getManualOverrideSnapshot>>,
  data: Awaited<ReturnType<typeof getControlPanelData>>
): { blockedReason: string | null; caution: string | null } {
  const overrideBlocked = blockedReason(action, snapshot);
  if (overrideBlocked) {
    return { blockedReason: overrideBlocked, caution: null };
  }

  const hasSafetyBlocks =
    (data.recoveryStates.staleMarketplaceBlocks ?? 0) > 0 ||
    (data.recoveryStates.supplierDriftBlocks ?? 0) > 0 ||
    (data.recoveryStates.combinedBlocks ?? 0) > 0;
  const hasRecheckNeeded = (data.recoveryStates.reEvaluationNeeded ?? 0) > 0;
  const hasPublishFailures = (data.listingThroughput.publishFailed ?? 0) > 0;
  const dailyCapExhausted =
    data.listingLifecycle.dailyCap.exists &&
    data.listingLifecycle.dailyCap.exhausted;
  const publishRateBlocked = !data.listingLifecycle.publishRateLimit.allowed;

  if (action === "promote") {
    if (dailyCapExhausted) {
      return { blockedReason: "Daily publish cap is exhausted. Wait for cap reset before promoting.", caution: null };
    }
    if (publishRateBlocked) {
      return {
        blockedReason: `Publish rate limiter is active (${data.listingLifecycle.publishRateLimit.blockingWindow}).`,
        caution: null,
      };
    }
    if (hasSafetyBlocks || hasRecheckNeeded) {
      return {
        blockedReason: "Safety blocks are active. Re-check and recover affected listings in /admin/listings first.",
        caution: null,
      };
    }
    if (hasPublishFailures) {
      return {
        blockedReason: "Recent publish failures need review before promoting more listings.",
        caution: null,
      };
    }
  }

  if ((action === "prepare" || action === "dry-run") && (hasSafetyBlocks || hasRecheckNeeded)) {
    return {
      blockedReason: null,
      caution: "Safety blocks exist. Use this action for diagnostics, then recover rows in /admin/listings.",
    };
  }

  if (action === "monitor" && hasPublishFailures) {
    return {
      blockedReason: null,
      caution: "Publish failures exist. Review failure reasons after running monitor.",
    };
  }

  return { blockedReason: null, caution: null };
}

async function runOverrideAction(formData: FormData) {
  "use server";

  const actorId = await requireAdmin();
  const key = String(formData.get("controlKey") ?? "").trim() as ManualOverrideKey;
  const enabled = String(formData.get("enabled") ?? "false") === "true";
  const note = String(formData.get("note") ?? "").trim();

  try {
    await setManualOverride({ key, enabled, note: note || null, actorId });
    redirect(`/admin/control?actionMessage=${encodeURIComponent(`${key} set to ${enabled ? "ON" : "OFF"}.`)}`);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    redirect(`/admin/control?actionError=${encodeURIComponent(msg)}`);
  }
}

export default async function ControlPage({ searchParams }: { searchParams?: Promise<SearchParams> }) {
  await requireAdmin();
  const resolvedSearchParams = await searchParams;
  const data = await getControlPanelData();
  const message = one(resolvedSearchParams?.actionMessage);
  const actionError = one(resolvedSearchParams?.actionError);
  const hasCriticalRecoveryBlock =
    (data.recoveryStates.staleMarketplaceBlocks ?? 0) > 0 ||
    (data.recoveryStates.supplierDriftBlocks ?? 0) > 0 ||
    (data.recoveryStates.supplierAvailabilityManualReview ?? 0) > 0 ||
    (data.recoveryStates.supplierAvailabilityBlocks ?? 0) > 0 ||
    (data.recoveryStates.combinedBlocks ?? 0) > 0 ||
    (data.recoveryStates.reEvaluationNeeded ?? 0) > 0;
  const hasCriticalPurchaseSafety =
    (data.purchaseSafety.notCheckedYet ?? 0) > 0 ||
    (data.purchaseSafety.checkedManualReview ?? 0) > 0 ||
    (data.purchaseSafety.blockedStaleSupplierData ?? 0) > 0 ||
    (data.purchaseSafety.blockedSupplierDrift ?? 0) > 0 ||
    (data.purchaseSafety.blockedEconomics ?? 0) > 0;

  const quickActions: Array<{ key: string; label: string }> = [
    { key: "supplier", label: "Run supplier discover" },
    { key: "match", label: "Run matching" },
    { key: "scan", label: "Run marketplace scan" },
    { key: "profit", label: "Run profit engine" },
    { key: "prepare", label: "Prepare listing previews" },
    { key: "promote", label: "Promote listing previews ready" },
    { key: "dry-run", label: "Run listing execution dry-run" },
    { key: "monitor", label: "Run listing monitor" },
  ];

  const nextSteps: string[] = [];
  if ((data.publishPerformance.blockedListings ?? 0) > 0) {
    nextSteps.push(`${data.publishPerformance.blockedListings} listings are blocked. Review in /admin/listings.`);
  }
  if ((data.recoveryStates.supplierDriftBlocks ?? 0) > 0) {
    nextSteps.push("Supplier data changed. Re-check listings before publishing.");
  }
  if ((data.listingThroughput.recentPublishFailures24h ?? 0) > 0) {
    nextSteps.push(`${data.listingThroughput.recentPublishFailures24h} publish failures in 24h. Review /admin/review.`);
  }
  if ((data.orderOperations.purchaseSafetyPending ?? 0) > 0) {
    nextSteps.push("Orders need purchase checks in /admin/orders.");
  }

  return (
    <main className="relative min-h-screen bg-app text-white">
      <div className="relative mx-auto grid max-w-[1600px] gap-5 px-4 py-6 sm:px-6 lg:px-8">
        <header className="glass-card rounded-3xl border border-white/10 px-5 py-4 sm:px-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h1 className="m-0 text-3xl font-bold">Operational Control Panel</h1>
              <p className="mt-2 text-sm text-white/65">
                Official v1 operations console. Use this for health, alerts, and safe operational actions; use <code>/admin/review</code> for approval decisions.
              </p>
              <p className="mt-2 text-xs text-white/45">Generated at: {data.generatedAt}</p>
            </div>
            <RefreshButton />
          </div>

          {message ? (
            <div className="mt-3 rounded-xl border border-cyan-300/30 bg-cyan-500/10 p-3 text-sm">{message}</div>
          ) : null}
          {actionError ? (
            <div className="mt-3 rounded-xl border border-rose-300/30 bg-rose-500/10 p-3 text-sm text-rose-100">{actionError}</div>
          ) : null}
        </header>

        <Section title="What To Do Next">
          {nextSteps.length ? (
            <div className="space-y-2 rounded-xl border border-amber-300/30 bg-amber-500/10 p-3 text-sm text-amber-100">
              {nextSteps.slice(0, 4).map((step) => (
                <div key={step}>- {step}</div>
              ))}
            </div>
          ) : (
            <div className="rounded-xl border border-white/10 bg-white/[0.04] p-3 text-sm text-white/75">
              No urgent operator actions right now.
            </div>
          )}
          <div className="mt-3 flex flex-wrap gap-2">
            <Link href="/admin/listings" className="inline-block rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-sm">Open /admin/listings</Link>
            <Link href="/admin/review" className="inline-block rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-sm">Open /admin/review</Link>
            <Link href="/admin/orders" className="inline-block rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-sm">Open /admin/orders</Link>
          </div>
        </Section>

        <Section title="Manual Override / Safety Controls">
          {!data.manualOverrides.available ? (
            <div className="mb-3 rounded-xl border border-rose-300/35 bg-rose-500/10 p-3 text-sm text-rose-100">
              Manual override store is unavailable. State-changing actions are blocked for safety.
            </div>
          ) : null}
          {data.manualOverrides.activeCount > 0 ? (
            <div className="mb-3 rounded-xl border border-amber-300/35 bg-amber-500/10 p-3 text-sm text-amber-100">
              Active overrides: {data.manualOverrides.activeCount}. Emergency mode is read-only by design.
            </div>
          ) : null}
          <div className="grid gap-3 md:grid-cols-2">
            {data.manualOverrides.entries.map((entry) => (
              <form key={entry.key} action={runOverrideAction} className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
                <input type="hidden" name="controlKey" value={entry.key} />
                <div className="text-sm font-semibold">{entry.key}</div>
                <div className="mt-2 text-xs text-white/60">State: {entry.enabled ? "ON" : "OFF"}</div>
                <div className="text-xs text-white/60">Last changed: {entry.changedAt ?? "-"}</div>
                <div className="text-xs text-white/60">Last changed by: {entry.changedBy ?? "-"}</div>
                <textarea name="note" className="contact-input mt-3 min-h-[72px]" placeholder="Optional incident note" defaultValue={entry.note ?? ""} />
                <div className="mt-3 flex gap-2">
                  <button name="enabled" value="true" className="rounded-xl border border-amber-300/30 bg-amber-500/10 px-3 py-2 text-xs font-semibold text-amber-100">
                    Turn ON
                  </button>
                  <button name="enabled" value="false" className="rounded-xl border border-emerald-300/30 bg-emerald-500/10 px-3 py-2 text-xs font-semibold text-emerald-100">
                    Turn OFF
                  </button>
                </div>
              </form>
            ))}
          </div>
          <div className="mt-3 space-y-1 text-xs text-white/55">
            {data.manualOverrides.limitations.map((line) => (
              <div key={line}>- {line}</div>
            ))}
          </div>
        </Section>

        <Section title="Publishing Safety (Priority)">
          <div className="rounded-xl border border-rose-300/35 bg-rose-500/10 p-3 text-xs text-rose-100">
            Publishing safety alerts are prioritized above general pipeline metrics.
          </div>
          <div className="mt-3 rounded-xl border border-white/10 bg-white/[0.03] p-3 text-xs text-white/75">
            <div>
              Marketplace snapshot threshold: {data.publishingSafety.marketplaceSnapshotHealth.thresholdHours}h
            </div>
            <div>
              Latest eBay snapshot: {data.publishingSafety.marketplaceSnapshotHealth.latestSnapshotTs ?? "n/a"}
            </div>
            {data.publishingSafety.marketplaceSnapshotHealth.hasPartialData ? (
              <div className="mt-1 text-amber-200">
                Snapshot age visibility is partial (missing marketplace snapshot backing data).
              </div>
            ) : null}
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard label="price guard candidates" value={data.publishingSafety.priceGuardSummary.totalCandidates ?? "-"} />
            <StatCard label="stale candidates" value={data.publishingSafety.staleCandidateCount ?? "-"} />
            <StatCard label="blocked count" value={data.publishingSafety.blockedCount ?? "-"} />
            <StatCard label="manual review count" value={data.publishingSafety.manualReviewCount ?? "-"} />
            <StatCard label="fresh snapshots" value={data.publishingSafety.marketplaceSnapshotHealth.freshSnapshots ?? "-"} />
            <StatCard label="stale snapshots" value={data.publishingSafety.marketplaceSnapshotHealth.staleSnapshots ?? "-"} />
            <StatCard label="rate-limit allowed" value={data.publishingSafety.publishRateLimit.allowed ? "yes" : "no"} />
            <StatCard label="rate-limit window" value={data.publishingSafety.publishRateLimit.blockingWindow} />
            <StatCard
              label="attempts 15m / 1h / 1d"
              value={`${data.publishingSafety.publishRateLimit.counts.attempts15m} / ${data.publishingSafety.publishRateLimit.counts.attempts1h} / ${data.publishingSafety.publishRateLimit.counts.attempts1d}`}
            />
            <StatCard
              label="limits 15m / 1h / 1d"
              value={`${data.publishingSafety.publishRateLimit.limits.limit15m} / ${data.publishingSafety.publishRateLimit.limits.limit1h} / ${data.publishingSafety.publishRateLimit.limits.limit1d}`}
            />
          </div>
        </Section>

        {hasCriticalRecoveryBlock ? (
          <Section title="Recovery / Safety Summary">
            <div className="rounded-xl border border-rose-300/35 bg-rose-500/10 p-3 text-xs text-rose-100">
              Publishability is currently blocked for one or more listings.
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <StatCard
                label="Market data too old (STALE_MARKETPLACE_BLOCK)"
                value={metricOrUnknown(
                  data.recoveryStates.staleMarketplaceBlocks,
                  data.recoveryStates.sourceWired.staleMarketplaceBlocks
                )}
              />
              <StatCard
                label="Supplier product changed (SUPPLIER_DRIFT_BLOCK)"
                value={metricOrUnknown(
                  data.recoveryStates.supplierDriftBlocks,
                  data.recoveryStates.sourceWired.supplierDriftBlocks
                )}
              />
              <StatCard
                label="Supplier availability review"
                value={metricOrUnknown(
                  data.recoveryStates.supplierAvailabilityManualReview,
                  data.recoveryStates.sourceWired.supplierAvailabilityManualReview
                )}
              />
              <StatCard
                label="Supplier availability blocked"
                value={metricOrUnknown(
                  data.recoveryStates.supplierAvailabilityBlocks,
                  data.recoveryStates.sourceWired.supplierAvailabilityBlocks
                )}
              />
              <StatCard
                label="Blocked for safety (COMBINED_BLOCKS)"
                value={metricOrUnknown(
                  data.recoveryStates.combinedBlocks,
                  data.recoveryStates.sourceWired.combinedBlocks
                )}
              />
              <StatCard
                label="Needs re-check (RE_EVALUATION_NEEDED)"
                value={metricOrUnknown(
                  data.recoveryStates.reEvaluationNeeded,
                  data.recoveryStates.sourceWired.reEvaluationNeeded
                )}
              />
              <StatCard
                label="Ready for re-promotion (REPROMOTION_READY)"
                value={metricOrUnknown(
                  data.recoveryStates.rePromotionReady,
                  data.recoveryStates.sourceWired.rePromotionReady
                )}
              />
            </div>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <StatCard
                label="Waiting for refresh: market (MARKETPLACE_REFRESH_PENDING)"
                value={metricOrUnknown(
                  data.recoveryStates.marketplaceRefreshPending,
                  data.recoveryStates.sourceWired.marketplaceRefreshPending
                )}
              />
              <StatCard
                label="Waiting for refresh: supplier (SUPPLIER_REFRESH_PENDING)"
                value={metricOrUnknown(
                  data.recoveryStates.supplierRefreshPending,
                  data.recoveryStates.sourceWired.supplierRefreshPending
                )}
              />
            </div>
            <div className="mt-4 grid gap-3 lg:grid-cols-2">
              {data.recoveryStates.actionHints.length ? (
                data.recoveryStates.actionHints.map((hint) => (
                  <div
                    key={hint.id}
                    className={`rounded-xl border p-3 text-sm ${
                      hint.severity === "critical"
                        ? "border-amber-300/35 bg-amber-500/10 text-amber-100"
                        : "border-white/10 bg-white/[0.04] text-white/85"
                    }`}
                  >
                    <div className="font-semibold">{hint.label}</div>
                    <div className="text-[11px] uppercase tracking-[0.14em] text-white/55">{hint.technicalLabel}</div>
                    <div className="mt-1">{hint.hint}</div>
                  </div>
                ))
              ) : (
                <div className="rounded-xl border border-white/10 bg-white/[0.04] p-3 text-sm text-white/75">
                  No stale/drift recovery actions are currently pending.
                </div>
              )}
            </div>
            <div className="mt-3">
              <Link href="/admin/listings" className="inline-block rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-sm">
                Open /admin/listings for recovery actions
              </Link>
              <Link href="/admin/review" className="ml-2 inline-block rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-sm">
                Open /admin/review for supplier safety review
              </Link>
            </div>
          </Section>
        ) : null}

        <Section title="Publish Operations">
          <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3 text-xs text-white/75">
            Compact publish KPI view from listing lifecycle truth.
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard
              label="Active listings"
              value={metricOrUnknown(data.publishPerformance.activeListings, data.publishPerformance.sourceWired.listings)}
            />
            <StatCard
              label="Published today"
              value={metricOrUnknown(data.publishPerformance.publishedToday, data.publishPerformance.sourceWired.listings)}
            />
            <StatCard
              label="Success rate"
              value={percentOrUnknown(data.publishPerformance.publishSuccessRatePct, data.publishPerformance.sourceWired.successRate)}
            />
            <StatCard
              label="Blocked listings"
              value={metricOrUnknown(data.publishPerformance.blockedListings, data.publishPerformance.sourceWired.blockedListings)}
            />
          </div>
          <div className="mt-3 text-xs text-white/65">
            Some listings are blocked? Review them in <Link href="/admin/listings" className="underline">/admin/listings</Link>.
          </div>
          <div className="mt-4">
            <DataTable
              rows={data.publishPerformance.publishFailureReasons.map((row) => ({
                reason: row.reason,
                count: row.count,
                technical_detail: row.technicalDetail ?? "-",
              }))}
              empty="No publish failures by reason."
            />
          </div>
        </Section>

        {hasCriticalPurchaseSafety ? (
          <Section title="Order Operations (Compact)">
            <div className="rounded-xl border border-rose-300/35 bg-rose-500/10 p-3 text-xs text-rose-100">
              Some orders are blocked or waiting for purchase safety checks.
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <StatCard
                label="Orders total"
                value={metricOrUnknown(data.orderOperations.totalOrders, data.orderOperations.sourceWired.orders)}
              />
              <StatCard
                label="Purchase safety pending"
                value={metricOrUnknown(data.orderOperations.purchaseSafetyPending, data.orderOperations.sourceWired.purchaseSafety)}
              />
              <StatCard
                label="Tracking waiting"
                value={metricOrUnknown(data.orderOperations.trackingPending, data.orderOperations.sourceWired.tracking)}
              />
              <StatCard
                label="Tracking synced"
                value={metricOrUnknown(data.orderOperations.trackingSynced, data.orderOperations.sourceWired.tracking)}
              />
            </div>
            <div className="mt-4 grid gap-3 lg:grid-cols-2">
              {data.purchaseSafety.actionHints.length ? (
                data.purchaseSafety.actionHints.map((hint) => (
                  <div
                    key={hint.id}
                    className={`rounded-xl border p-3 text-sm ${
                      hint.severity === "critical"
                        ? "border-amber-300/35 bg-amber-500/10 text-amber-100"
                        : "border-white/10 bg-white/[0.04] text-white/85"
                    }`}
                  >
                    <div className="font-semibold">{hint.label}</div>
                    <div className="text-[11px] uppercase tracking-[0.14em] text-white/55">{hint.technicalLabel}</div>
                    <div className="mt-1">{hint.hint}</div>
                  </div>
                ))
              ) : (
                <div className="rounded-xl border border-white/10 bg-white/[0.04] p-3 text-sm text-white/75">
                  No purchase safety alerts right now.
                </div>
              )}
            </div>
            <div className="mt-3">
              <Link href="/admin/orders" className="inline-block rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-sm">
                Open /admin/orders for purchase actions
              </Link>
            </div>
          </Section>
        ) : null}

        <Section title="Listing Throughput">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard label="previews" value={data.listingThroughput.previews ?? "-"} />
            <StatCard label="ready_to_publish" value={data.listingThroughput.readyToPublish ?? "-"} />
            <StatCard label="active" value={data.listingThroughput.active ?? "-"} />
            <StatCard label="publish failures (all time)" value={data.listingThroughput.publishFailed ?? "-"} />
            <StatCard label="publish attempts (24h)" value={data.listingThroughput.recentPublishAttempts24h ?? "unknown"} />
            <StatCard label="publish successes (24h)" value={data.listingThroughput.recentPublishSuccesses24h ?? "unknown"} />
            <StatCard label="publish failures (24h)" value={data.listingThroughput.recentPublishFailures24h ?? "unknown"} />
          </div>
        </Section>

        <Section title="Worker Health">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard label="worker successes (24h)" value={data.workerQueueHealth.recentSuccessCount24h ?? "n/a"} />
            <StatCard label="worker failures (24h)" value={data.workerQueueHealth.recentFailureCount24h ?? "n/a"} />
            <StatCard label="recent activity ts" value={data.workerQueueHealth.recentWorkerActivityTs ?? "none"} />
            <StatCard label="recent job failures" value={data.workerQueueHealth.recentJobFailures.length} />
          </div>
          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <DataTable rows={data.workerQueueHealth.recentWorkerFailures} empty="No recent worker failures." />
            <DataTable rows={data.workerQueueHealth.recentJobFailures} empty="No recent job failures." />
          </div>
        </Section>

        {!hasCriticalRecoveryBlock ? (
          <Section title="Recovery / Safety Summary">
            <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3 text-xs text-white/75">
              Recovery metrics are currently informational and are shown below critical worker failures.
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <StatCard
                label="Market data too old (STALE_MARKETPLACE_BLOCK)"
                value={metricOrUnknown(
                  data.recoveryStates.staleMarketplaceBlocks,
                  data.recoveryStates.sourceWired.staleMarketplaceBlocks
                )}
              />
              <StatCard
                label="Supplier product changed (SUPPLIER_DRIFT_BLOCK)"
                value={metricOrUnknown(
                  data.recoveryStates.supplierDriftBlocks,
                  data.recoveryStates.sourceWired.supplierDriftBlocks
                )}
              />
              <StatCard
                label="Supplier availability review"
                value={metricOrUnknown(
                  data.recoveryStates.supplierAvailabilityManualReview,
                  data.recoveryStates.sourceWired.supplierAvailabilityManualReview
                )}
              />
              <StatCard
                label="Supplier availability blocked"
                value={metricOrUnknown(
                  data.recoveryStates.supplierAvailabilityBlocks,
                  data.recoveryStates.sourceWired.supplierAvailabilityBlocks
                )}
              />
              <StatCard
                label="Blocked for safety (COMBINED_BLOCKS)"
                value={metricOrUnknown(
                  data.recoveryStates.combinedBlocks,
                  data.recoveryStates.sourceWired.combinedBlocks
                )}
              />
              <StatCard
                label="Needs re-check (RE_EVALUATION_NEEDED)"
                value={metricOrUnknown(
                  data.recoveryStates.reEvaluationNeeded,
                  data.recoveryStates.sourceWired.reEvaluationNeeded
                )}
              />
              <StatCard
                label="Ready for re-promotion (REPROMOTION_READY)"
                value={metricOrUnknown(
                  data.recoveryStates.rePromotionReady,
                  data.recoveryStates.sourceWired.rePromotionReady
                )}
              />
            </div>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <StatCard
                label="Waiting for refresh: market (MARKETPLACE_REFRESH_PENDING)"
                value={metricOrUnknown(
                  data.recoveryStates.marketplaceRefreshPending,
                  data.recoveryStates.sourceWired.marketplaceRefreshPending
                )}
              />
              <StatCard
                label="Waiting for refresh: supplier (SUPPLIER_REFRESH_PENDING)"
                value={metricOrUnknown(
                  data.recoveryStates.supplierRefreshPending,
                  data.recoveryStates.sourceWired.supplierRefreshPending
                )}
              />
            </div>
            <div className="mt-4 grid gap-3 lg:grid-cols-2">
              {data.recoveryStates.actionHints.length ? (
                data.recoveryStates.actionHints.map((hint) => (
                  <div
                    key={hint.id}
                    className={`rounded-xl border p-3 text-sm ${
                      hint.severity === "critical"
                        ? "border-amber-300/35 bg-amber-500/10 text-amber-100"
                        : "border-white/10 bg-white/[0.04] text-white/85"
                    }`}
                  >
                    <div className="font-semibold">{hint.label}</div>
                    <div className="text-[11px] uppercase tracking-[0.14em] text-white/55">{hint.technicalLabel}</div>
                    <div className="mt-1">{hint.hint}</div>
                  </div>
                ))
              ) : (
                <div className="rounded-xl border border-white/10 bg-white/[0.04] p-3 text-sm text-white/75">
                  No stale/drift recovery actions are currently pending.
                </div>
              )}
            </div>
            <div className="mt-3">
              <Link href="/admin/listings" className="inline-block rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-sm">
                Open /admin/listings for recovery actions
              </Link>
              <Link href="/admin/review" className="ml-2 inline-block rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-sm">
                Open /admin/review for supplier safety review
              </Link>
            </div>
          </Section>
        ) : null}

        {!hasCriticalPurchaseSafety ? (
          <Section title="Order Operations (Compact)">
            <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3 text-xs text-white/75">
              Purchase safety summary stays compact here; detailed actions remain in /admin/orders.
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <StatCard
                label="Orders total"
                value={metricOrUnknown(data.orderOperations.totalOrders, data.orderOperations.sourceWired.orders)}
              />
              <StatCard
                label="Purchase safety pending"
                value={metricOrUnknown(data.orderOperations.purchaseSafetyPending, data.orderOperations.sourceWired.purchaseSafety)}
              />
              <StatCard
                label="Tracking waiting"
                value={metricOrUnknown(data.orderOperations.trackingPending, data.orderOperations.sourceWired.tracking)}
              />
              <StatCard
                label="Tracking synced"
                value={metricOrUnknown(data.orderOperations.trackingSynced, data.orderOperations.sourceWired.tracking)}
              />
            </div>
            <div className="mt-3">
              <Link href="/admin/orders" className="inline-block rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-sm">
                Open /admin/orders for purchase actions
              </Link>
            </div>
          </Section>
        ) : null}

        <Section title="Alerts">
          <div className="grid gap-4 lg:grid-cols-3">
            <DataTable rows={data.prioritizedAlerts.publishingSafety} empty="No publishing safety alerts." />
            <DataTable rows={data.prioritizedAlerts.operationalFreshness} empty="No operational freshness alerts." />
            <DataTable rows={data.prioritizedAlerts.futureOrders} empty="No future-order alerts." />
          </div>
        </Section>

        <Section title="Future Automation Readiness (Placeholder)">
          <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3 text-xs text-white/75">
            This block is forward-looking only. Use Order Operations (Compact) above for current day-to-day actions.
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard label="total orders" value={data.futureOrders.totalOrders ?? "-"} />
            <StatCard label="purchase review pending" value={data.futureOrders.purchaseReviewPending ?? "-"} />
            <StatCard label="tracking pending" value={data.futureOrders.trackingPending ?? "-"} />
            <StatCard label="tracking synced" value={data.futureOrders.trackingSynced ?? "-"} />
          </div>
          {!data.futureOrders.supported ? (
            <div className="mt-3 rounded-xl border border-amber-300/35 bg-amber-500/10 p-3 text-xs text-amber-100">
              Partial state: {data.futureOrders.partialReason}
            </div>
          ) : null}
        </Section>

        <Section title="Quick Actions">
          <div className="rounded-xl border border-amber-300/30 bg-amber-400/10 p-3 text-xs text-amber-100">
            Listing execution-related actions are eBay-only and preserve review gate constraints.
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {quickActions.map((item) => {
              const snapshot = {
                available: data.manualOverrides.available,
                activeCount: data.manualOverrides.activeCount,
                emergencyReadOnly: data.manualOverrides.emergencyReadOnly,
                limitations: data.manualOverrides.limitations,
                entries: data.manualOverrides.entries.reduce((acc, entry) => {
                  acc[entry.key as ManualOverrideKey] = {
                    key: entry.key as ManualOverrideKey,
                    enabled: entry.enabled,
                    note: entry.note,
                    changedBy: entry.changedBy,
                    changedAt: entry.changedAt,
                  };
                  return acc;
                }, {} as Awaited<ReturnType<typeof getManualOverrideSnapshot>>["entries"]),
              };
              const state = getQuickActionState(item.key, snapshot, data);
              return (
                <form key={item.key} method="post" action="/api/admin/control/run-action">
                  <input type="hidden" name="actionKey" value={item.key} />
                  <button disabled={Boolean(state.blockedReason)} className="w-full rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-left text-sm disabled:cursor-not-allowed disabled:opacity-50">
                    {item.label}
                    {state.blockedReason ? <div className="mt-1 text-[11px] text-amber-200">{state.blockedReason}</div> : null}
                    {!state.blockedReason && state.caution ? (
                      <div className="mt-1 text-[11px] text-sky-200">{state.caution}</div>
                    ) : null}
                  </button>
                </form>
              );
            })}
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <Link href="/admin/review" className="inline-block rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-sm">Open /admin/review</Link>
            <Link href="/admin/listings" className="inline-block rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-sm">Open /admin/listings</Link>
            <Link href="/admin/orders" className="inline-block rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-sm">Open /admin/orders</Link>
          </div>
        </Section>
      </div>
    </main>
  );
}
