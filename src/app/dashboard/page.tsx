import RefreshButton from "../_components/RefreshButton";
import { getDashboardData, type StageStatus } from "@/lib/dashboard/getDashboardData";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type Tone = "default" | "ok" | "warning" | "error";
type Row = Record<string, unknown>;

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="glass-panel rounded-3xl border border-white/10 p-5 sm:p-6">
      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-white sm:text-xl">{title}</h2>
          {description ? <p className="mt-1 text-xs text-white/55 sm:text-sm">{description}</p> : null}
        </div>
      </div>
      {children}
    </section>
  );
}

function toneClass(tone: Tone): string {
  if (tone === "ok") return "border-emerald-300/30 bg-emerald-400/10 text-emerald-100";
  if (tone === "warning") return "border-amber-300/30 bg-amber-400/10 text-amber-100";
  if (tone === "error") return "border-rose-300/30 bg-rose-400/10 text-rose-100";
  return "border-white/10 bg-white/[0.04] text-white";
}

function stageTone(stage: StageStatus): Tone {
  if (stage.state === "fresh") return "ok";
  if (stage.state === "warning") return "warning";
  if (stage.state === "stale") return "error";
  return "default";
}

function alertToneToCard(tone: "info" | "warning" | "error"): Tone {
  if (tone === "error") return "error";
  if (tone === "warning") return "warning";
  return "default";
}

function StatCard({
  label,
  value,
  tone = "default",
  detail,
}: {
  label: string;
  value: React.ReactNode;
  tone?: Tone;
  detail?: React.ReactNode;
}) {
  return (
    <div className={`rounded-2xl border p-4 ${toneClass(tone)}`}>
      <div className="mb-2 text-[11px] uppercase tracking-[0.2em] text-white/55">{label}</div>
      <div className="text-2xl font-bold leading-tight text-balance">{value}</div>
      {detail ? <div className="mt-2 text-xs text-white/70">{detail}</div> : null}
    </div>
  );
}

function formatCell(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function formatDateTime(value: string | null): string {
  if (!value) return "unknown";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "unknown";
  return date.toLocaleString("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  });
}

function formatPercent(value: number | null): string {
  if (value == null) return "-";
  return `${value.toFixed(2)}%`;
}

function DataTable({
  rows,
  empty = "No data",
}: {
  rows: Row[];
  empty?: string;
}) {
  if (!rows.length) {
    return <div className="rounded-xl border border-white/10 bg-black/15 p-3 text-sm text-white/55">{empty}</div>;
  }

  const columns = Array.from(
    rows.reduce((set, row) => {
      Object.keys(row).forEach((key) => set.add(key));
      return set;
    }, new Set<string>())
  );

  return (
    <div className="w-full overflow-x-auto rounded-2xl border border-white/10 bg-black/15">
      <table className="min-w-max w-full border-collapse text-sm text-white/90">
        <thead className="sticky top-0 z-10">
          <tr>
            {columns.map((col) => (
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
          {rows.map((row, i) => (
            <tr key={i} className="odd:bg-transparent even:bg-white/[0.02] hover:bg-cyan-300/[0.06]">
              {columns.map((col) => (
                <td
                  key={col}
                  className="max-w-[360px] break-words border-b border-white/5 px-3 py-2 align-top"
                  title={formatCell(row[col])}
                >
                  {formatCell(row[col])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default async function DashboardPage() {
  let data: Awaited<ReturnType<typeof getDashboardData>> | null = null;

  try {
    data = await getDashboardData();
  } catch {}

  if (!data) {
    return (
      <main className="relative min-h-screen bg-app text-white">
        <div className="relative mx-auto grid max-w-[900px] gap-5 px-4 py-6 sm:px-6 lg:px-8">
          <header className="glass-card rounded-3xl border border-rose-300/30 bg-rose-400/10 px-5 py-4 sm:px-6">
            <h1 className="m-0 text-2xl font-bold text-rose-100">Dashboard temporarily unavailable</h1>
            <p className="mt-2 text-sm text-rose-100/90">
              We couldn&apos;t load dashboard data right now. Please retry in a minute.
            </p>
            <p className="mt-2 text-xs text-rose-100/70">
              If the issue persists, check runtime diagnostics and server logs.
            </p>
            <div className="mt-4">
              <RefreshButton />
            </div>
          </header>
        </div>
      </main>
    );
  }

  return (
    <main className="relative min-h-screen bg-app text-white">
      <div className="pointer-events-none absolute inset-0">
        <div className="hero-orb hero-orb-a" />
        <div className="hero-orb hero-orb-b" />
        <div className="hero-orb hero-orb-c" />
        <div className="grid-overlay opacity-[0.1]" />
      </div>

      <div className="relative mx-auto grid max-w-[1600px] gap-5 px-4 py-6 sm:px-6 lg:px-8">
        <header className="glass-card rounded-3xl border border-white/10 px-5 py-4 sm:px-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h1 className="m-0 text-3xl font-bold text-white">Monitoring Dashboard</h1>
              <p className="mt-2 text-sm text-white/65">
                Canonical operational truth across trends, ingestion, marketplace scans, matching, profitability, and admin follow-up.
              </p>
              <p className="mt-2 text-xs text-white/45">Rendered at: {data.generatedAt}</p>
              <p className="mt-1 text-xs text-white/45">{data.refreshBehavior.refreshAction}</p>
            </div>
            <RefreshButton />
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            <StatCard
              label="Fresh Actionable Candidates"
              value={data.headline.actionableFreshCandidates}
              tone={data.headline.actionableFreshCandidates > 0 ? "ok" : "warning"}
            />
            <StatCard
              label="Approved And Fresh"
              value={data.headline.approvedFreshCandidates}
              tone={data.headline.approvedFreshCandidates > 0 ? "ok" : "warning"}
            />
            <StatCard
              label="Manual Review Due To Stale"
              value={data.headline.manualReviewDueToStale}
              tone={data.headline.manualReviewDueToStale > 0 ? "warning" : "ok"}
            />
            <StatCard
              label="Stale eBay Snapshots"
              value={data.headline.staleMarketplaceSnapshots}
              tone={data.headline.staleMarketplaceSnapshots > 0 ? "error" : "ok"}
            />
            <StatCard
              label="Critical Issues"
              value={data.headline.criticalIssues}
              tone={data.headline.criticalIssues > 0 ? "error" : "ok"}
            />
          </div>
        </header>

        {data.alerts.length ? (
          <Section title="Operational Alerts" description="Warnings are driven directly from canonical freshness and status checks.">
            <div className="grid gap-3 lg:grid-cols-2">
              {data.alerts.map((alert) => (
                <div key={alert.id} className={`rounded-2xl border p-4 ${toneClass(alertToneToCard(alert.tone))}`}>
                  <div className="text-sm font-semibold">{alert.title}</div>
                  <div className="mt-1 text-sm text-white/80">{alert.detail}</div>
                </div>
              ))}
            </div>
          </Section>
        ) : null}

        <Section
          title="Operational Status"
          description="Each stage shows latest canonical data timestamp, latest successful job ledger timestamp, and freshness against the current policy window."
        >
          <div className="grid gap-4 xl:grid-cols-3">
            {data.stages.map((stage) => (
              <div key={stage.key} className={`rounded-2xl border p-4 ${toneClass(stageTone(stage))}`}>
                <div className="flex items-center justify-between gap-3">
                  <div className="text-sm font-semibold">{stage.label}</div>
                  <div className="text-[11px] uppercase tracking-[0.18em] text-white/65">{stage.state}</div>
                </div>
                <div className="mt-3 grid gap-1 text-sm text-white/80">
                  <div>Last data: {formatDateTime(stage.lastDataTs)}</div>
                  <div>Last successful run: {formatDateTime(stage.lastSuccessfulRunTs)}</div>
                  <div>
                    Fresh/total/stale: {stage.freshRows ?? "-"} / {stage.totalRows ?? "-"} / {stage.staleRows ?? "-"}
                  </div>
                  <div>Freshness window: {stage.thresholdHours}h</div>
                </div>
                <div className="mt-3 text-sm text-white/80">{stage.detail}</div>
              </div>
            ))}
          </div>
        </Section>

        <Section
          title="Pipeline Truth"
          description="Headline metrics are separated from all-time totals so historical/sample rows do not masquerade as current operational coverage."
        >
          <DataTable
            rows={data.pipelineMetrics.map((metric) => ({
              stage: metric.label,
              total_rows: metric.totalRows,
              fresh_rows: metric.freshRows,
              stale_rows: metric.staleRows,
              freshness_window: metric.freshnessWindow,
              scope: metric.scope,
            }))}
            empty="No pipeline metrics available"
          />
        </Section>

        <div className="grid gap-5 xl:grid-cols-2">
          <Section
            title="Trend Coverage"
            description="Recent trend activity is ordered by captured_ts/created_ts, not by row id."
          >
            <div className="grid gap-3 sm:grid-cols-2">
              <StatCard label="Trend Signals" value={data.trend.totalSignals} />
              <StatCard label="Signals In Last 24h" value={data.trend.recentSignals24h} tone={data.trend.recentSignals24h > 0 ? "ok" : "warning"} />
              <StatCard label="Manual Seed Signals" value={data.trend.manualSeedSignals} tone={data.trend.manualSeedSignals === data.trend.totalSignals && data.trend.totalSignals > 0 ? "warning" : "default"} />
              <StatCard label="Last Trend Signal" value={formatDateTime(data.trend.latestSignalTs)} />
            </div>
            <div className="mt-5 grid gap-5">
              <div>
                <h3 className="mb-3 text-lg font-semibold text-white">Recent trend signals</h3>
                <DataTable rows={data.trend.recentSignals} empty="No trend signals found" />
              </div>
              <div>
                <h3 className="mb-3 text-lg font-semibold text-white">Recent trend candidates</h3>
                <DataTable rows={data.trend.recentCandidates} empty="No trend candidates found" />
              </div>
            </div>
          </Section>

          <Section
            title="Supplier Ingestion"
            description="Supplier freshness is measured from canonical products_raw snapshots. All-time totals may include historical/sample supplier rows."
          >
            <div className="grid gap-3 sm:grid-cols-2">
              <StatCard label="Supplier Rows" value={data.supplier.totalRows} />
              <StatCard label="Fresh Supplier Rows" value={data.supplier.freshRows} tone={data.supplier.freshRows > 0 ? "ok" : "warning"} />
              <StatCard label="Stale Supplier Rows" value={data.supplier.staleRows} tone={data.supplier.staleRows > 0 ? "warning" : "ok"} />
              <StatCard label="Last Supplier Snapshot" value={formatDateTime(data.supplier.latestSnapshotTs)} />
            </div>
            <div className="mt-5">
              <h3 className="mb-3 text-lg font-semibold text-white">Freshness by supplier</h3>
              <DataTable rows={data.supplier.bySupplier} empty="No supplier snapshots found" />
            </div>
          </Section>
        </div>

        <div className="grid gap-5 xl:grid-cols-2">
          <Section
            title="Marketplace Scan"
            description="eBay is the canonical live marketplace source for v1. Opportunity counts are not treated as current if eBay snapshots are stale."
          >
            <div className="grid gap-3 sm:grid-cols-2">
              <StatCard label="eBay Snapshot Rows" value={data.marketplace.totalEbayRows} />
              <StatCard label="Fresh eBay Snapshots" value={data.marketplace.freshEbayRows} tone={data.marketplace.freshEbayRows > 0 ? "ok" : "error"} />
              <StatCard label="Stale eBay Snapshots" value={data.marketplace.staleEbayRows} tone={data.marketplace.staleEbayRows > 0 ? "error" : "ok"} />
              <StatCard label="Last Successful Scan" value={formatDateTime(data.marketplace.latestSuccessfulRunTs ?? data.marketplace.latestSnapshotTs)} />
            </div>
          </Section>

          <Section
            title="Matching Quality"
            description="Average confidence and recent activity are computed from active eBay matches only."
          >
            <div className="grid gap-3 sm:grid-cols-2">
              <StatCard label="Active Matches" value={data.matching.totalMatches} />
              <StatCard label="Fresh Matches 24h" value={data.matching.freshMatches24h} tone={data.matching.freshMatches24h > 0 ? "ok" : "warning"} />
              <StatCard label="Avg Match Confidence" value={formatPercent(data.matching.averageConfidence == null ? null : data.matching.averageConfidence * 100)} />
              <StatCard label="Low Confidence Matches" value={data.matching.lowConfidenceCount} tone={data.matching.lowConfidenceCount > 0 ? "warning" : "ok"} />
            </div>
            <div className="mt-5">
              <h3 className="mb-3 text-lg font-semibold text-white">Recent active matches</h3>
              <DataTable rows={data.matching.recentMatches} empty="No active eBay matches found" />
            </div>
          </Section>
        </div>

        <Section
          title="Profitability Truth"
          description="Fresh actionable opportunities are separated from stale/manual-review rows so the dashboard does not overstate listing quality."
        >
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard label="Total Candidates" value={data.profitability.totalCandidates} />
            <StatCard label="Approved" value={data.profitability.approved} tone={data.profitability.approved > 0 ? "ok" : "default"} />
            <StatCard label="Manual Review" value={data.profitability.manualReview} tone={data.profitability.manualReview > 0 ? "warning" : "default"} />
            <StatCard label="Pending Or Recheck" value={data.profitability.pending} />
            <StatCard label="Fresh Actionable" value={data.profitability.actionableFresh} tone={data.profitability.actionableFresh > 0 ? "ok" : "warning"} />
            <StatCard label="Manual Review Due To Stale" value={data.profitability.manualReviewDueToStale} tone={data.profitability.manualReviewDueToStale > 0 ? "warning" : "ok"} />
            <StatCard label="Blocked By Stale Snapshot" value={data.profitability.blockedByStaleSnapshot} tone={data.profitability.blockedByStaleSnapshot > 0 ? "error" : "ok"} />
            <StatCard label="Blocked By Availability" value={data.profitability.blockedByAvailability} tone={data.profitability.blockedByAvailability > 0 ? "warning" : "ok"} />
          </div>

          <div className="mt-5 grid gap-5 2xl:grid-cols-2">
            <div>
              <h3 className="mb-3 text-lg font-semibold text-white">Decision status breakdown</h3>
              <DataTable rows={data.profitability.statusBreakdown} empty="No profitable candidates" />
            </div>
            <div>
              <h3 className="mb-3 text-lg font-semibold text-white">Primary blocker breakdown</h3>
              <DataTable rows={data.profitability.blockBreakdown} empty="No blocker breakdown available" />
            </div>
          </div>

          <div className="mt-5">
            <h3 className="mb-3 text-lg font-semibold text-white">Top profitable opportunities</h3>
            <DataTable
              rows={data.profitability.topOpportunities}
              empty="No profitable opportunities yet"
            />
          </div>
        </Section>

        <div className="grid gap-5 xl:grid-cols-[340px_minmax(0,1fr)]">
          <Section title="Admin Surfaces" description="Operational follow-up stays in the existing admin consoles.">
            <div className="grid gap-3">
              {data.adminLinks.map((link) => (
                <a
                  key={link.href}
                  href={link.href}
                  className="rounded-2xl border border-cyan-300/30 bg-cyan-500/10 px-4 py-3 text-sm font-semibold text-cyan-100"
                >
                  <div>{link.label}</div>
                  <div className="mt-1 text-xs font-normal text-cyan-100/75">{link.note}</div>
                </a>
              ))}
            </div>

            <div className="mt-5 grid gap-3">
              <StatCard label="Ready To Publish" value={data.listingReadiness.readyToPublish} tone={data.listingReadiness.readyToPublish > 0 ? "ok" : "default"} />
              <StatCard label="Preview" value={data.listingReadiness.preview} />
              <StatCard label="Active Listings" value={data.listingReadiness.active} tone={data.listingReadiness.active > 0 ? "ok" : "default"} />
              <StatCard label="Publish Failed" value={data.listingReadiness.publishFailed} tone={data.listingReadiness.publishFailed > 0 ? "error" : "ok"} />
            </div>
          </Section>

          <div className="grid gap-5">
            <Section title="Diagnostics" description={data.refreshBehavior.dataSource}>
              <div className="grid gap-5">
                <div>
                  <h3 className="mb-3 text-lg font-semibold text-white">Recent jobs</h3>
                  <DataTable rows={data.diagnostics.recentJobs} empty="No jobs recorded" />
                </div>
                <div>
                  <h3 className="mb-3 text-lg font-semibold text-white">Recent worker runs</h3>
                  <DataTable rows={data.diagnostics.recentWorkerRuns} empty="No worker runs recorded" />
                </div>
                <div>
                  <h3 className="mb-3 text-lg font-semibold text-white">Recent audit events</h3>
                  <DataTable rows={data.diagnostics.recentAuditEvents} empty="No audit events recorded" />
                </div>
              </div>
            </Section>
          </div>
        </div>
      </div>
    </main>
  );
}
