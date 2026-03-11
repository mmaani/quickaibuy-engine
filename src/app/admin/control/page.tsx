import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { sql } from "drizzle-orm";
import RefreshButton from "@/app/_components/RefreshButton";
import { writeAuditLog } from "@/lib/audit/writeAuditLog";
import { getControlPanelData } from "@/lib/control/getControlPanelData";
import { getManualOverrideSnapshot, setManualOverride, type ManualOverrideKey } from "@/lib/control/manualOverrides";
import { db } from "@/lib/db";
import { handleMarketplaceScanJob } from "@/lib/jobs/marketplaceScan";
import { handleMatchProductsJob } from "@/lib/jobs/matchProducts";
import { runSupplierDiscover } from "@/lib/jobs/supplierDiscover";
import { getListingExecutionCandidates } from "@/lib/listings/getListingExecutionCandidates";
import { markListingReadyToPublish } from "@/lib/listings/markListingReadyToPublish";
import { prepareListingPreviews } from "@/lib/listings/prepareListingPreviews";
import { runProfitEngine } from "@/lib/profit/profitEngine";
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

async function runAction(action: string) {
  "use server";

  const actorId = await requireAdmin();
  const overrideSnapshot = await getManualOverrideSnapshot();
  const reason = blockedReason(action, overrideSnapshot);
  if (reason) {
    redirect(`/admin/control?actionError=${encodeURIComponent(reason)}`);
  }

  let message = "Action completed.";

  if (action === "supplier") {
    const result = await runSupplierDiscover(10);
    message = `Supplier discover inserted ${result.insertedCount} rows.`;
  } else if (action === "match") {
    const result = await handleMatchProductsJob({ limit: 25 });
    message = `Matching scanned ${result.scanned}; inserted ${result.inserted}, updated ${result.updated} (total upserts ${result.inserted + result.updated}).`;
  } else if (action === "scan") {
    const result = await handleMarketplaceScanJob({ limit: 25, platform: "ebay" });
    message = `Marketplace scan (eBay) scanned ${result.scanned} rows.`;
  } else if (action === "profit") {
    const result = await runProfitEngine({ limit: 50 });
    message = `Profit engine scanned ${result.scanned}; upserted ${result.insertedOrUpdated}; skipped ${result.skipped}; stale deleted ${result.staleDeleted}.`;
  } else if (action === "prepare") {
    const result = await prepareListingPreviews({ limit: 25, marketplace: "ebay" });
    message = `Previews created ${result.created}, updated ${result.updated}, skipped ${result.skipped}.`;
  } else if (action === "promote") {
    const rows = await db.execute(sql`
      select id
      from listings
      where marketplace_key = 'ebay' and status = 'PREVIEW'
      order by updated_at asc
      limit 25
    `);

    let promoted = 0;
    let blocked = 0;
    for (const row of (rows.rows ?? []) as Array<{ id: string }>) {
      const out = await markListingReadyToPublish({
        listingId: row.id,
        actorType: "ADMIN",
        actorId,
      });
      if (out.ok) promoted++;
      else blocked++;
    }

    message = `Promoted ${promoted} previews; blocked ${blocked} by review/eligibility safeguards.`;
  } else if (action === "dry-run") {
    const candidates = await getListingExecutionCandidates({ limit: 20, marketplace: "ebay" });
    await writeAuditLog({
      actorType: "ADMIN",
      actorId,
      entityType: "PIPELINE",
      entityId: "listing-execution-dry-run",
      eventType: "LISTING_EXECUTION_DRY_RUN_OK",
      details: { count: candidates.length },
    });
    message = `Listing execution dry-run found ${candidates.length} READY_TO_PUBLISH candidates.`;
  } else if (action === "monitor") {
    const statusCounts = await db.execute(sql`
      select status, count(*)::int as count
      from listings
      where marketplace_key = 'ebay'
      group by status
      order by count desc
    `);
    await writeAuditLog({
      actorType: "ADMIN",
      actorId,
      entityType: "PIPELINE",
      entityId: "listing-monitor",
      eventType: "LISTING_MONITOR_RUN",
      details: { rows: statusCounts.rows ?? [] },
    });
    message = "Listing monitor snapshot recorded.";
  } else {
    throw new Error(`Unsupported control panel action: ${action}`);
  }

  await writeAuditLog({
    actorType: "ADMIN",
    actorId,
    entityType: "PIPELINE",
    entityId: "admin-control",
    eventType: "CONTROL_PANEL_ACTION_TRIGGERED",
    details: { action, message },
  });

  redirect(`/admin/control?actionMessage=${encodeURIComponent(message)}`);
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
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard label="price guard candidates" value={data.publishingSafety.priceGuardSummary.totalCandidates ?? "-"} />
            <StatCard label="stale candidates" value={data.publishingSafety.staleCandidateCount ?? "-"} />
            <StatCard label="blocked count" value={data.publishingSafety.blockedCount ?? "-"} />
            <StatCard label="manual review count" value={data.publishingSafety.manualReviewCount ?? "-"} />
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

        <Section title="Listing Throughput">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard label="previews" value={data.listingThroughput.previews ?? "-"} />
            <StatCard label="ready_to_publish" value={data.listingThroughput.readyToPublish ?? "-"} />
            <StatCard label="active" value={data.listingThroughput.active ?? "-"} />
            <StatCard label="publish_failed" value={data.listingThroughput.publishFailed ?? "-"} />
            <StatCard label="recent attempts (24h)" value={data.listingThroughput.recentPublishAttempts24h ?? "n/a"} />
            <StatCard label="recent successes (24h)" value={data.listingThroughput.recentPublishSuccesses24h ?? "n/a"} />
            <StatCard label="recent failures (24h)" value={data.listingThroughput.recentPublishFailures24h ?? "n/a"} />
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

        <Section title="Alerts">
          <div className="grid gap-4 lg:grid-cols-3">
            <DataTable rows={data.prioritizedAlerts.publishingSafety} empty="No publishing safety alerts." />
            <DataTable rows={data.prioritizedAlerts.operationalFreshness} empty="No operational freshness alerts." />
            <DataTable rows={data.prioritizedAlerts.futureOrders} empty="No future-order alerts." />
          </div>
        </Section>

        <Section title="Future Orders Placeholder">
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
              const reason = blockedReason(item.key, {
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
              });
              return (
                <form key={item.key} action={runAction.bind(null, item.key)}>
                  <button disabled={Boolean(reason)} className="w-full rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-left text-sm disabled:cursor-not-allowed disabled:opacity-50">
                    {item.label}
                    {reason ? <div className="mt-1 text-[11px] text-amber-200">{reason}</div> : null}
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
