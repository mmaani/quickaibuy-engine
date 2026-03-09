import { headers } from "next/headers";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { sql } from "drizzle-orm";
import RefreshButton from "@/app/_components/RefreshButton";
import { db } from "@/lib/db";
import { writeAuditLog } from "@/lib/audit/writeAuditLog";
import { getControlPanelData } from "@/lib/dashboard/getControlPanelData";
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

function one(v: string | string[] | undefined): string | null {
  return Array.isArray(v) ? (v[0] ?? null) : (v ?? null);
}

function requireAdmin() {
  const auth = headers().get("authorization");
  if (!isReviewConsoleConfigured() || !isAuthorizedReviewAuthorizationHeader(auth)) {
    redirect("/admin/review");
  }
  return auth;
}

async function runAction(action: string) {
  "use server";
  requireAdmin();

  let message = "Done";

  if (action === "supplier") {
    const result = await runSupplierDiscover(10);
    message = `Supplier discover inserted ${result.insertedCount} rows.`;
  } else if (action === "matching") {
    const result = await handleMatchProductsJob({ limit: 25 });
    message = `Matching scanned ${result.scanned}; upserted ${result.upserted}.`;
  } else if (action === "scan") {
    const result = await handleMarketplaceScanJob({ limit: 25, platform: "ebay" });
    message = `Marketplace scan checked ${result.scanned} rows.`;
  } else if (action === "profit") {
    const result = await runProfitEngine({ limit: 50 });
    message = `Profit engine processed ${result.processed} matches.`;
  } else if (action === "prepare") {
    const result = await prepareListingPreviews({ limit: 25, marketplace: "ebay" });
    message = `Previews created ${result.created}, updated ${result.updated}, skipped ${result.skipped}.`;
  } else if (action === "promote") {
    const res = await db.execute(sql`
      select id from listings
      where marketplace_key = 'ebay' and status = 'PREVIEW'
      order by updated_at asc
      limit 25
    `);
    const rows = (res.rows ?? []) as Array<{ id: string }>;
    let promoted = 0;
    let blocked = 0;
    for (const row of rows) {
      const out = await markListingReadyToPublish({ listingId: row.id, actorType: "ADMIN", actorId: "control-panel" });
      if (out.ok) promoted++;
      else blocked++;
    }
    message = `Promoted ${promoted}; blocked ${blocked} by review/eligibility gates.`;
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
    message = `Dry-run found ${candidates.length} READY_TO_PUBLISH candidates.`;
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

function DataTable({ rows }: { rows: Array<Record<string, unknown>> }) {
  if (!rows.length) return <div className="rounded-xl border border-white/10 bg-black/15 p-3 text-sm text-white/55">No data.</div>;
  const columns = Array.from(rows.reduce((set, row) => (Object.keys(row).forEach((k) => set.add(k)), set), new Set<string>()));
  return <div className="w-full overflow-x-auto rounded-2xl border border-white/10 bg-black/15"><table className="min-w-max w-full border-collapse text-sm text-white/90"><thead><tr>{columns.map((c) => <th key={c} className="border-b border-white/10 bg-[#121824] px-3 py-2 text-left text-xs uppercase tracking-[0.14em] text-white/60">{c}</th>)}</tr></thead><tbody>{rows.map((row, i) => <tr key={i} className="odd:bg-transparent even:bg-white/[0.02]">{columns.map((c) => <td key={c} className="max-w-[360px] break-words border-b border-white/5 px-3 py-2 align-top">{String(row[c] ?? "-")}</td>)}</tr>)}</tbody></table></div>;
}

function Card({ label, value }: { label: string; value: React.ReactNode }) {
  return <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4"><div className="text-[11px] uppercase tracking-[0.2em] text-white/55">{label}</div><div className="mt-2 text-2xl font-bold">{value}</div></div>;
}

export default async function Page({ searchParams }: { searchParams?: SearchParams }) {
  requireAdmin();
  const data = await getControlPanelData();
  const msg = one(searchParams?.actionMessage);

  return <main className="relative min-h-screen bg-app text-white"><div className="relative mx-auto grid max-w-[1600px] gap-5 px-4 py-6 sm:px-6 lg:px-8"><header className="glass-card rounded-3xl border border-white/10 px-5 py-4 sm:px-6"><div className="flex items-start justify-between"><div><h1 className="text-3xl font-bold">Operational Control Panel</h1><p className="text-sm text-white/65">Pipeline health, quality, profitability, listings, and worker status.</p><p className="text-xs text-white/45">Generated at: {data.generatedAt}</p></div><RefreshButton /></div>{msg ? <div className="mt-3 rounded-xl border border-cyan-300/30 bg-cyan-500/10 p-3 text-sm">{msg}</div> : null}</header>

<section className="glass-panel rounded-3xl border border-white/10 p-5"><h2 className="mb-3 text-lg font-semibold">Alerts / Failures</h2>{data.alerts.length ? <div className="grid gap-3 md:grid-cols-2">{data.alerts.map((a) => <div key={a.id} className={`rounded-2xl border p-3 ${a.tone === "error" ? "border-rose-300/35 bg-rose-400/10" : "border-amber-300/35 bg-amber-400/10"}`}><div className="font-semibold">{a.title}</div><div className="text-xs text-white/70">{a.detail}</div></div>)}</div> : <div className="rounded-xl border border-emerald-300/30 bg-emerald-400/10 p-3 text-sm">No critical alerts.</div>}</section>

<div className="grid gap-5 xl:grid-cols-2"><section className="glass-panel rounded-3xl border border-white/10 p-5"><h2 className="mb-3 text-lg font-semibold">Pipeline Overview</h2><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{data.pipelineOverview.counts.map((c) => <Card key={c.key} label={c.key} value={c.exists ? (c.count ?? "null") : "missing"} />)}<Card label="active_matches" value={data.pipelineOverview.activeMatches ?? "-"} /></div><div className="mt-4"><DataTable rows={data.pipelineOverview.listingsByStatus} /></div></section>

<section className="glass-panel rounded-3xl border border-white/10 p-5"><h2 className="mb-3 text-lg font-semibold">Match Quality</h2><Card label="low-confidence warnings" value={data.matchQuality.lowConfidenceCount ?? "-"} /><div className="mt-4 grid gap-4 lg:grid-cols-2"><DataTable rows={data.matchQuality.confidenceDistribution} /><DataTable rows={data.matchQuality.activeInactive} /></div><div className="mt-4"><DataTable rows={data.matchQuality.duplicateWeakIndicators} /></div></section>

<section className="glass-panel rounded-3xl border border-white/10 p-5"><h2 className="mb-3 text-lg font-semibold">Profit Stats</h2><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3"><Card label="total" value={data.profitStats.totals.totalCandidates ?? "-"} /><Card label="approved" value={data.profitStats.totals.approved ?? "-"} /><Card label="rejected" value={data.profitStats.totals.rejected ?? "-"} /><Card label="pending_review" value={data.profitStats.totals.pendingReview ?? "-"} /><Card label="avg estimated_profit" value={data.profitStats.totals.avgEstimatedProfit ?? "-"} /><Card label="avg margin/roi" value={`${data.profitStats.totals.avgMarginPct ?? "-"} / ${data.profitStats.totals.avgRoiPct ?? "-"}`} /></div><div className="mt-4"><DataTable rows={data.profitStats.topCandidates} /></div></section>

<section className="glass-panel rounded-3xl border border-white/10 p-5"><h2 className="mb-3 text-lg font-semibold">Listing Status</h2><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3"><Card label="duplicate skipped (24h)" value={data.listingStatus.duplicateSkipped ?? "n/a"} /><Card label="dry run ok (24h)" value={data.listingStatus.dryRunOk ?? "n/a"} /><Card label="publish failures" value={data.listingStatus.recentPublishFailures.length} /></div><div className="mt-4 grid gap-4 lg:grid-cols-2"><DataTable rows={data.listingStatus.byStatus} /><DataTable rows={data.listingStatus.recentPublishFailures} /></div></section>

<section className="glass-panel rounded-3xl border border-white/10 p-5"><h2 className="mb-3 text-lg font-semibold">Worker Health</h2><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"><Card label="DB" value={data.infrastructure.db.status} /><Card label="Queue" value={data.infrastructure.queue.status} /><Card label="worker recency" value={data.workerHealth.recentWorkerActivityAt ?? "none in 60m"} /><Card label="worker events (60m)" value={data.workerHealth.recentWorkerActivityCount} /></div><div className="mt-4 grid gap-4 lg:grid-cols-2"><DataTable rows={data.workerHealth.recentFailures} /><DataTable rows={data.workerHealth.recentAuditEvents} /></div></section></div>

<section className="glass-panel rounded-3xl border border-white/10 p-5"><h2 className="mb-3 text-lg font-semibold">Quick Actions</h2><div className="rounded-xl border border-amber-300/30 bg-amber-400/10 p-3 text-xs text-amber-100">Live listing actions are eBay-only. Review gate remains enforced.</div><div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
<form action={runAction.bind(null, "supplier")}><button className="w-full rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-left text-sm">Run supplier discover</button></form>
<form action={runAction.bind(null, "matching")}><button className="w-full rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-left text-sm">Run matching</button></form>
<form action={runAction.bind(null, "scan")}><button className="w-full rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-left text-sm">Run marketplace scan</button></form>
<form action={runAction.bind(null, "profit")}><button className="w-full rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-left text-sm">Run profit engine</button></form>
<form action={runAction.bind(null, "prepare")}><button className="w-full rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-left text-sm">Prepare listing previews</button></form>
<form action={runAction.bind(null, "promote")}><button className="w-full rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-left text-sm">Promote listing previews ready</button></form>
<form action={runAction.bind(null, "dry-run")}><button className="w-full rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-left text-sm">Run listing execution dry-run</button></form>
<form action={runAction.bind(null, "monitor")}><button className="w-full rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-left text-sm">Run listing monitor</button></form>
</div></section>
</div></main>;
}
