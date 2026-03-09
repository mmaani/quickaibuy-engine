import { headers } from "next/headers";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import type { Metadata } from "next";
import RefreshButton from "@/app/_components/RefreshButton";
import { writeAuditLog } from "@/lib/audit/writeAuditLog";
import { getControlPanelData } from "@/lib/control/getControlPanelData";
import { enqueueProductMatch } from "@/lib/jobs/enqueueProductMatch";
import { enqueueMarketplacePriceScan } from "@/lib/jobs/enqueueMarketplacePriceScan";
import { getListingExecutionCandidates } from "@/lib/listings/getListingExecutionCandidates";
import { isAuthorizedReviewAuthorizationHeader, isReviewConsoleConfigured } from "@/lib/review/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata: Metadata = {
  title: "Operational Control Panel",
  robots: { index: false, follow: false },
};

type SearchParams = Record<string, string | string[] | undefined>;

type QuickActionKey = "match" | "scan" | "dry-run";

const QUICK_ACTIONS: Array<{ key: string; label: string; enabled: boolean; reason?: string }> = [
  { key: "supplier", label: "Run supplier discover", enabled: false, reason: "Not wired yet (safe enqueue path missing)." },
  { key: "match", label: "Enqueue matching job", enabled: true },
  { key: "scan", label: "Enqueue marketplace scan (eBay)", enabled: true },
  { key: "profit", label: "Run profit engine", enabled: false, reason: "Not wired yet (safe enqueue path missing)." },
  { key: "prepare", label: "Prepare listing previews", enabled: false, reason: "Not wired yet (safe enqueue path missing)." },
  { key: "promote", label: "Promote previews to READY_TO_PUBLISH", enabled: false, reason: "Not wired yet (manual execution path disabled)." },
  { key: "dry-run", label: "Run listing execution dry-run", enabled: true },
  { key: "monitor", label: "Run listing monitor", enabled: false, reason: "Not wired yet (no dedicated monitor job path)." },
];

const LIFECYCLE_STATUSES = [
  "PREVIEW",
  "READY_TO_PUBLISH",
  "PUBLISH_IN_PROGRESS",
  "ACTIVE",
  "PUBLISH_FAILED",
  "PAUSED",
  "ENDED",
] as const;

function one(value: string | string[] | undefined): string | null {
  return Array.isArray(value) ? (value[0] ?? null) : (value ?? null);
}

async function requireAdmin() {
  const auth = (await headers()).get("authorization");
  if (!isReviewConsoleConfigured() || !isAuthorizedReviewAuthorizationHeader(auth)) {
    notFound();
  }
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
              <th
                key={col}
                className="border-b border-white/10 bg-[#121824] px-3 py-2 text-left text-xs uppercase tracking-[0.14em] text-white/60"
              >
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

function normalizeLifecycleRows(rows: Array<Record<string, unknown>>) {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const status = String(row.status ?? "").toUpperCase();
    const count = Number(row.count ?? 0);
    if (status) counts.set(status, Number.isFinite(count) ? count : 0);
  }
  return LIFECYCLE_STATUSES.map((status) => ({ status, count: counts.get(status) ?? 0 }));
}

async function runAction(action: QuickActionKey) {
  "use server";

  await requireAdmin();
  let message = "Action completed.";

  if (action === "match") {
    const job = await enqueueProductMatch({ supplierLimit: 250, marketplaceLimit: 1000, minConfidence: 0.75 });
    message = `Enqueued MATCH_PRODUCT job (${String(job.id)}).`;
  } else if (action === "scan") {
    const job = await enqueueMarketplacePriceScan({ limit: 100, platform: "ebay" });
    message = `Enqueued SCAN_MARKETPLACE_PRICE job (${String(job.id)}) for eBay.`;
  } else if (action === "dry-run") {
    const candidates = await getListingExecutionCandidates({ limit: 20, marketplace: "ebay" });
    await writeAuditLog({
      actorType: "ADMIN",
      actorId: "control-panel",
      entityType: "PIPELINE",
      entityId: "listing-execution-dry-run",
      eventType: "LISTING_EXECUTION_DRY_RUN_OK",
      details: { count: candidates.length },
    });
    message = `Listing execution dry-run found ${candidates.length} READY_TO_PUBLISH candidates.`;
  }

  await writeAuditLog({
    actorType: "ADMIN",
    actorId: "control-panel",
    entityType: "PIPELINE",
    entityId: "admin-control",
    eventType: "CONTROL_PANEL_ACTION_TRIGGERED",
    details: { action, message },
  });

  redirect(`/admin/control?actionMessage=${encodeURIComponent(message)}`);
}

export default async function ControlPage({ searchParams }: { searchParams?: SearchParams }) {
  await requireAdmin();
  const data = await getControlPanelData();
  const message = one(searchParams?.actionMessage);
  const lifecycleRows = normalizeLifecycleRows(data.listingLifecycle.statusCounts);

  return (
    <main className="relative min-h-screen bg-app text-white">
      <div className="relative mx-auto grid max-w-[1600px] gap-5 px-4 py-6 sm:px-6 lg:px-8">
        <header className="glass-card rounded-3xl border border-white/10 px-5 py-4 sm:px-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h1 className="m-0 text-3xl font-bold">Operational Control Panel</h1>
              <p className="mt-2 text-sm text-white/65">
                Official v1 operations console. Use this for health, alerts, and safe operational actions;
                use <code>/admin/review</code> for approval decisions.
              </p>
              <p className="mt-2 text-xs text-white/45">Generated at: {data.generatedAt}</p>
            </div>
            <RefreshButton />
          </div>

          {message ? <div className="mt-3 rounded-xl border border-cyan-300/30 bg-cyan-500/10 p-3 text-sm">{message}</div> : null}
        </header>

        <Section title="Pipeline Overview">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {data.pipelineOverview.counts.map((item) => (
              <StatCard
                key={item.table}
                label={item.optional ? `${item.table} (optional)` : item.table}
                value={item.exists ? (item.count ?? "null") : "missing"}
              />
            ))}
          </div>
          <div className="mt-4">
            <DataTable rows={data.pipelineOverview.listingStatuses} empty="Listings table missing or empty." />
          </div>
        </Section>

        <Section title="Supplier Discovery Health">
          <div className="grid gap-4 lg:grid-cols-2">
            <DataTable rows={data.supplierDiscoveryHealth.bySupplier} empty="No products_raw supplier counts available." />
            <DataTable
              rows={data.supplierDiscoveryHealth.freshnessBySupplier}
              empty="Supplier freshness unavailable (snapshot_ts missing or table unavailable)."
            />
          </div>
          <p className="mt-3 text-xs text-white/60">v1 supplier focus: Alibaba, AliExpress, Temu.</p>
        </Section>

        <Section title="Match Quality">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard label="total matches" value={data.matchQuality.totalMatches ?? "-"} />
            <StatCard label="active matches" value={data.matchQuality.activeMatches ?? "n/a"} />
            <StatCard label="low-confidence warnings" value={data.matchQuality.lowConfidenceCount ?? "n/a"} />
          </div>
          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <DataTable rows={data.matchQuality.confidenceDistribution} empty="Confidence distribution unavailable." />
            <DataTable rows={data.matchQuality.weakOrDuplicateIndicators} empty="No weak or duplicate-match indicators." />
          </div>
        </Section>

        <Section title="Marketplace Scan Health">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <StatCard label="total eBay prices" value={data.marketplaceScanHealth.totalEbayPrices ?? "-"} />
            <StatCard label="latest eBay scan" value={data.marketplaceScanHealth.latestEbayScanTs ?? "-"} />
            <StatCard label="eBay prices in last 24h" value={data.marketplaceScanHealth.recentEbayPrices24h ?? "-"} />
          </div>
        </Section>

        <Section title="Profit Engine Stats">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard label="total candidates" value={data.profitEngineStats.totalCandidates ?? "-"} />
            <StatCard label="approved" value={data.profitEngineStats.approved ?? "-"} />
            <StatCard label="rejected" value={data.profitEngineStats.rejected ?? "-"} />
            <StatCard label="pending review" value={data.profitEngineStats.pendingReview ?? "-"} />
            <StatCard label="avg estimated_profit" value={data.profitEngineStats.avgEstimatedProfit ?? "-"} />
            <StatCard label="avg margin_pct" value={data.profitEngineStats.avgMarginPct ?? "-"} />
            <StatCard label="avg roi_pct" value={data.profitEngineStats.avgRoiPct ?? "-"} />
          </div>
          <div className="mt-4">
            <DataTable rows={data.profitEngineStats.topCandidates} empty="No profitable candidates available." />
          </div>
        </Section>

        <Section title="Review Queue">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard label="pending review" value={data.reviewQueue.pendingReview ?? "-"} />
            <StatCard label="approved" value={data.reviewQueue.approved ?? "-"} />
            <StatCard label="rejected" value={data.reviewQueue.rejected ?? "-"} />
            <StatCard label="oldest pending calc_ts" value={data.reviewQueue.oldestPendingCalcTs ?? "-"} />
          </div>
          <div className="mt-3">
            <Link href="/admin/review" className="rounded-xl border border-cyan-300/30 bg-cyan-500/10 px-3 py-2 text-sm inline-block">
              Open /admin/review for approval decisions
            </Link>
          </div>
        </Section>

        <Section title="Listing Lifecycle">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard label="ready-to-publish backlog" value={data.listingLifecycle.readyToPublishBacklog ?? "-"} />
            <StatCard label="publish attempts (24h)" value={data.listingLifecycle.publishAttempts24h ?? "n/a"} />
            <StatCard label="daily cap used" value={data.listingLifecycle.dailyCap.capUsed ?? "-"} />
            <StatCard label="daily cap remaining" value={data.listingLifecycle.dailyCap.capRemaining ?? "-"} />
          </div>
          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <DataTable rows={lifecycleRows} empty="No listing lifecycle rows." />
            <DataTable rows={data.listingLifecycle.publishFailures} empty="No PUBLISH_FAILED rows." />
          </div>
          <p className="mt-3 text-xs text-white/60">Only ACTIVE is live. PREVIEW is dry-run only. READY_TO_PUBLISH is the execution entry state.</p>
        </Section>

        <Section title="Worker / Queue Health">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard label="DB reachable" value={data.health.db.status} />
            <StatCard label="Queue reachable" value={data.health.queue.status} />
            <StatCard label="recent worker activity" value={data.workerQueueHealth.recentWorkerActivityTs ?? "none"} />
            <StatCard label="recent worker failures" value={data.workerQueueHealth.recentWorkerFailures.length} />
          </div>
          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <DataTable rows={data.workerQueueHealth.recentWorkerRuns} empty="worker_runs unavailable or empty." />
            <DataTable rows={data.workerQueueHealth.recentWorkerFailures} empty="No recent worker failures." />
            <DataTable rows={data.workerQueueHealth.recentJobFailures} empty="No recent failed jobs." />
            <DataTable rows={data.workerQueueHealth.recentJobs} empty="jobs unavailable or empty." />
            <DataTable rows={data.workerQueueHealth.recentAuditEvents} empty="audit_log unavailable or empty." />
          </div>
        </Section>

        <Section title="Alerts / Failures">
          {data.alerts.length ? (
            <div className="grid gap-3 md:grid-cols-2">
              {data.alerts.map((alert) => (
                <div
                  key={alert.id}
                  className={`rounded-2xl border p-3 ${
                    alert.tone === "error" ? "border-rose-300/35 bg-rose-400/10" : "border-amber-300/35 bg-amber-400/10"
                  }`}
                >
                  <div className="font-semibold">{alert.title}</div>
                  <div className="text-xs text-white/70">{alert.detail}</div>
                </div>
              ))}
            </div>
          ) : (
            <div className="rounded-xl border border-emerald-300/30 bg-emerald-400/10 p-3 text-sm">No active alerts.</div>
          )}
        </Section>

        <Section title="Quick Actions">
          <div className="rounded-xl border border-amber-300/30 bg-amber-400/10 p-3 text-xs text-amber-100">
            Operator-safe mode: actions only enqueue supported jobs or run non-destructive dry-runs; unwired actions are disabled.
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {QUICK_ACTIONS.map((action) => (
              <div key={action.key} className="rounded-xl border border-white/10 bg-white/[0.04] p-3">
                {action.enabled ? (
                  <form action={runAction.bind(null, action.key as QuickActionKey)}>
                    <button className="w-full text-left text-sm">{action.label}</button>
                  </form>
                ) : (
                  <button className="w-full cursor-not-allowed text-left text-sm text-white/40" disabled>
                    {action.label}
                  </button>
                )}
                {!action.enabled ? <div className="mt-2 text-xs text-white/50">{action.reason}</div> : null}
              </div>
            ))}
          </div>
          <div className="mt-3">
            <Link href="/admin/review" className="rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-sm inline-block">
              Open /admin/review
            </Link>
          </div>
        </Section>
      </div>
    </main>
  );
}
