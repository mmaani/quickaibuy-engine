import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { sql } from "drizzle-orm";
import RefreshButton from "@/app/_components/RefreshButton";
import { writeAuditLog } from "@/lib/audit/writeAuditLog";
import { getControlPanelData } from "@/lib/control/getControlPanelData";
import { db } from "@/lib/db";
import { handleMarketplaceScanJob } from "@/lib/jobs/marketplaceScan";
import { handleMatchProductsJob } from "@/lib/jobs/matchProducts";
import { runSupplierDiscover } from "@/lib/jobs/supplierDiscover";
import { getListingExecutionCandidates } from "@/lib/listings/getListingExecutionCandidates";
import { markListingReadyToPublish } from "@/lib/listings/markListingReadyToPublish";
import { prepareListingPreviews } from "@/lib/listings/prepareListingPreviews";
import { runProfitEngine } from "@/lib/profit/profitEngine";
import { isAuthorizedReviewAuthorizationHeader, isReviewConsoleConfigured } from "@/lib/review/auth";

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

async function requireAdmin() {
  const auth = (await headers()).get("authorization");
  if (!isReviewConsoleConfigured() || !isAuthorizedReviewAuthorizationHeader(auth)) {
    redirect("/admin/review");
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

async function runAction(action: string) {
  "use server";

  await requireAdmin();
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
        actorId: "control-panel",
      });
      if (out.ok) promoted++;
      else blocked++;
    }

    message = `Promoted ${promoted} previews; blocked ${blocked} by review/eligibility safeguards.`;
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
      actorId: "control-panel",
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
    actorId: "control-panel",
    entityType: "PIPELINE",
    entityId: "admin-control",
    eventType: "CONTROL_PANEL_ACTION_TRIGGERED",
    details: { action, message },
  });

  redirect(`/admin/control?actionMessage=${encodeURIComponent(message)}`);
}

export default async function ControlPage({ searchParams }: { searchParams?: Promise<SearchParams> }) {
  await requireAdmin();
  const resolvedSearchParams = await searchParams;
  const data = await getControlPanelData();
  const message = one(resolvedSearchParams?.actionMessage);

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

          {message ? (
            <div className="mt-3 rounded-xl border border-cyan-300/30 bg-cyan-500/10 p-3 text-sm">{message}</div>
          ) : null}
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
            <Link href="/admin/review" className="inline-block rounded-xl border border-cyan-300/30 bg-cyan-500/10 px-3 py-2 text-sm">
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
            <StatCard label="rate limit allowed" value={data.listingLifecycle.publishRateLimit.allowed ? "yes" : "no"} />
            <StatCard label="rate limit blocking window" value={data.listingLifecycle.publishRateLimit.blockingWindow} />
            <StatCard
              label="attempts 15m / 1h / 1d"
              value={`${data.listingLifecycle.publishRateLimit.counts.attempts15m} / ${data.listingLifecycle.publishRateLimit.counts.attempts1h} / ${data.listingLifecycle.publishRateLimit.counts.attempts1d}`}
            />
            <StatCard
              label="limits 15m / 1h / 1d"
              value={`${data.listingLifecycle.publishRateLimit.limits.limit15m} / ${data.listingLifecycle.publishRateLimit.limits.limit1h} / ${data.listingLifecycle.publishRateLimit.limits.limit1d}`}
            />
          </div>
          {data.listingLifecycle.publishRateLimit.retryHint ? (
            <div className="mt-3 rounded-xl border border-amber-300/30 bg-amber-500/10 p-3 text-xs text-amber-100">
              Rate-limit hint: {data.listingLifecycle.publishRateLimit.retryHint}
            </div>
          ) : null}
          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <DataTable rows={data.listingLifecycle.statusCounts} empty="No listing lifecycle rows." />
            <DataTable rows={data.listingLifecycle.publishFailures} empty="No PUBLISH_FAILED rows." />
          </div>
        </Section>

        <Section title="Worker / Queue Health">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard label="DB reachable" value={data.health.db.status} />
            <StatCard label="Queue reachable" value={data.health.queue.status} />
            <StatCard label="recent worker activity" value={data.workerQueueHealth.recentWorkerActivityTs ?? "none"} />
            <StatCard label="recent job failures" value={data.workerQueueHealth.recentJobFailures.length} />
          </div>
          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <DataTable rows={data.workerQueueHealth.recentWorkerRuns} empty="worker_runs unavailable or empty." />
            <DataTable rows={data.workerQueueHealth.recentJobs} empty="jobs unavailable or empty." />
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
            Listing execution-related actions are eBay-only and preserve review gate constraints.
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <form action={runAction.bind(null, "supplier")}><button className="w-full rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-left text-sm">Run supplier discover</button></form>
            <form action={runAction.bind(null, "match")}><button className="w-full rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-left text-sm">Run matching</button></form>
            <form action={runAction.bind(null, "scan")}><button className="w-full rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-left text-sm">Run marketplace scan</button></form>
            <form action={runAction.bind(null, "profit")}><button className="w-full rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-left text-sm">Run profit engine</button></form>
            <form action={runAction.bind(null, "prepare")}><button className="w-full rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-left text-sm">Prepare listing previews</button></form>
            <form action={runAction.bind(null, "promote")}><button className="w-full rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-left text-sm">Promote listing previews ready</button></form>
            <form action={runAction.bind(null, "dry-run")}><button className="w-full rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-left text-sm">Run listing execution dry-run</button></form>
            <form action={runAction.bind(null, "monitor")}><button className="w-full rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-left text-sm">Run listing monitor</button></form>
          </div>
          <div className="mt-3">
            <Link href="/admin/review" className="inline-block rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-sm">
              Open /admin/review
            </Link>
          </div>
        </Section>
      </div>
    </main>
  );
}
