import RefreshButton from "@/app/_components/RefreshButton";
import { getDashboardData, type StageStatus } from "@/lib/dashboard/getDashboardData";
import { getControlPlaneOverview } from "@/lib/controlPlane/getControlPlaneOverview";
import { ControlPlaneOverviewPanel } from "@/components/admin/ControlPlaneOverviewPanel";
import { JORDAN_TIME_ZONE } from "@/lib/time/jordan";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type Tone = "default" | "ok" | "warning" | "error";
type Row = Record<string, unknown>;

function Section({
  title,
  description,
  eyebrow,
  children,
}: {
  title: string;
  description?: string;
  eyebrow?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="glass-panel relative overflow-hidden rounded-[2rem] border border-white/10 p-5 sm:p-6">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/30 to-transparent" />
      <div className="mb-5 flex items-start justify-between gap-4">
        <div>
          {eyebrow ? (
            <div className="mb-2 text-[10px] uppercase tracking-[0.28em] text-cyan-200/70">{eyebrow}</div>
          ) : null}
          <h2 className="text-xl font-semibold text-white sm:text-2xl">{title}</h2>
          {description ? <p className="mt-2 max-w-3xl text-sm leading-6 text-white/60">{description}</p> : null}
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
  if (stage.renderState === "HEALTHY") return "ok";
  if (stage.renderState === "DEGRADED" || stage.renderState === "UNKNOWN" || stage.renderState === "ZERO") return "warning";
  if (stage.renderState === "STALE" || stage.renderState === "PARTIAL_FAILURE" || stage.renderState === "QUERY_FAILED") return "error";
  return "default";
}

function alertToneToCard(tone: "info" | "warning" | "error"): Tone {
  if (tone === "error") return "error";
  if (tone === "warning") return "warning";
  return "default";
}

function progressBarClass(tone: Tone): string {
  if (tone === "ok") return "from-emerald-300 via-emerald-400 to-cyan-300";
  if (tone === "warning") return "from-amber-200 via-amber-300 to-orange-300";
  if (tone === "error") return "from-rose-300 via-rose-400 to-orange-300";
  return "from-cyan-200 via-sky-300 to-white/80";
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
    timeZone: JORDAN_TIME_ZONE,
  });
}

function formatPercent(value: number | null): string {
  if (value == null) return "-";
  return `${value.toFixed(2)}%`;
}

function formatCompactDateTime(value: string | null): string {
  if (!value) return "unknown";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "unknown";
  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: JORDAN_TIME_ZONE,
  });
}

function toneLabel(tone: Tone): string {
  if (tone === "ok") return "healthy";
  if (tone === "warning") return "warning";
  if (tone === "error") return "critical";
  return "watch";
}

function StageMeter({
  tone,
  fresh,
  total,
}: {
  tone: Tone;
  fresh: number | null;
  total: number | null;
}) {
  const numerator = fresh ?? 0;
  const denominator = total ?? 0;
  const pct = denominator > 0 ? Math.max(0, Math.min(100, (numerator / denominator) * 100)) : 0;

  return (
    <div>
      <div className="mb-2 flex items-center justify-between text-[11px] uppercase tracking-[0.18em] text-white/50">
        <span>Freshness coverage</span>
        <span>{denominator > 0 ? `${pct.toFixed(0)}%` : total == null || fresh == null ? "unknown" : "0%"}</span>
      </div>
      <div className="h-2.5 overflow-hidden rounded-full bg-white/8">
        <div
          className={`h-full rounded-full bg-gradient-to-r ${progressBarClass(tone)} shadow-[0_0_18px_rgba(255,255,255,0.15)]`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

function StageCard({ stage }: { stage: StageStatus }) {
  const tone = stageTone(stage);

  return (
    <a href={stage.actionableHref} className="group relative block overflow-hidden rounded-[1.6rem] border border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.07),rgba(255,255,255,0.02))] p-5 shadow-[0_24px_70px_rgba(0,0,0,0.34)]">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(255,255,255,0.12),transparent_36%)] opacity-70" />
      <div className="relative">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-sm font-semibold text-white">{stage.label}</div>
            <div className="mt-1 text-xs uppercase tracking-[0.22em] text-white/40">{toneLabel(tone)}</div>
          </div>
          <div className={`rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] ${toneClass(tone)}`}>
            {stage.renderState.replaceAll("_", " ")}
          </div>
        </div>

        <div className="mt-5">
          <StageMeter tone={tone} fresh={stage.freshRows} total={stage.totalRows} />
        </div>

        <div className="mt-5 grid grid-cols-3 gap-2">
          <div className="rounded-2xl border border-white/8 bg-black/20 p-3">
            <div className="text-[10px] uppercase tracking-[0.18em] text-white/45">Fresh</div>
            <div className="mt-1 text-xl font-semibold text-white">{stage.freshRows ?? "-"}</div>
          </div>
          <div className="rounded-2xl border border-white/8 bg-black/20 p-3">
            <div className="text-[10px] uppercase tracking-[0.18em] text-white/45">Total</div>
            <div className="mt-1 text-xl font-semibold text-white">{stage.totalRows ?? "-"}</div>
          </div>
          <div className="rounded-2xl border border-white/8 bg-black/20 p-3">
            <div className="text-[10px] uppercase tracking-[0.18em] text-white/45">Stale</div>
            <div className="mt-1 text-xl font-semibold text-white">{stage.staleRows ?? "-"}</div>
          </div>
        </div>

        <div className="mt-5 grid gap-2 text-sm text-white/65">
          <div className="flex items-center justify-between gap-4 border-b border-white/6 pb-2">
            <span>Last data</span>
            <span className="text-right text-white/85">{formatCompactDateTime(stage.lastDataTs)}</span>
          </div>
          <div className="flex items-center justify-between gap-4 border-b border-white/6 pb-2">
            <span>Last successful run</span>
            <span className="text-right text-white/85">{formatCompactDateTime(stage.lastSuccessfulRunTs)}</span>
          </div>
          {stage.scheduleActive != null ? (
            <div className="flex items-center justify-between gap-4 border-b border-white/6 pb-2">
              <span>Schedule</span>
              <span className="text-right text-white/85">{stage.scheduleActive ? "active" : "missing"}</span>
            </div>
          ) : null}
          {stage.latestFailedRunTs ? (
            <div className="flex items-center justify-between gap-4 border-b border-white/6 pb-2">
              <span>Last failed run</span>
              <span className="text-right text-white/85">{formatCompactDateTime(stage.latestFailedRunTs)}</span>
            </div>
          ) : null}
          <div className="flex items-center justify-between gap-4">
            <span>Window</span>
            <span className="text-right text-white/85">{stage.thresholdHours}h policy</span>
          </div>
        </div>

        <div className="mt-4 rounded-2xl border border-white/8 bg-white/[0.03] p-3 text-sm leading-6 text-white/72">
          {stage.detail}
        </div>
      </div>
    </a>
  );
}

function HeroMetric({
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
    <div className="relative overflow-hidden rounded-[1.75rem] border border-white/10 bg-[linear-gradient(160deg,rgba(255,255,255,0.10),rgba(255,255,255,0.03))] p-5 shadow-[0_24px_70px_rgba(0,0,0,0.30)]">
      <div className={`pointer-events-none absolute inset-x-0 top-0 h-1 bg-gradient-to-r ${progressBarClass(tone)}`} />
      <div className="text-[11px] uppercase tracking-[0.24em] text-white/45">{label}</div>
      <div className="mt-3 text-4xl font-semibold leading-none text-white">{value}</div>
      {detail ? <div className="mt-3 text-sm leading-6 text-white/62">{detail}</div> : null}
    </div>
  );
}

function CompactStat({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: React.ReactNode;
  tone?: Tone;
}) {
  return (
    <div className={`rounded-2xl border px-4 py-3 ${toneClass(tone)}`}>
      <div className="text-[10px] uppercase tracking-[0.22em] text-white/45">{label}</div>
      <div className="mt-2 text-2xl font-semibold text-white">{value}</div>
    </div>
  );
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
    <div className={`rounded-[1.4rem] border p-4 ${toneClass(tone)}`}>
      <div className="mb-2 text-[11px] uppercase tracking-[0.2em] text-white/55">{label}</div>
      <div className="text-2xl font-bold leading-tight text-balance">{value}</div>
      {detail ? <div className="mt-2 text-xs leading-5 text-white/70">{detail}</div> : null}
    </div>
  );
}

function AlertCard({
  title,
  detail,
  tone,
  href,
}: {
  title: string;
  detail: string;
  tone: Tone;
  href: string;
}) {
  return (
    <a href={href} className={`relative block overflow-hidden rounded-[1.6rem] border p-4 ${toneClass(tone)}`}>
      <div className={`pointer-events-none absolute inset-y-0 left-0 w-1 bg-gradient-to-b ${progressBarClass(tone)}`} />
      <div className="pl-3">
        <div className="text-sm font-semibold">{title}</div>
        <div className="mt-2 text-sm leading-6 text-white/80">{detail}</div>
      </div>
    </a>
  );
}

function DataTable({
  rows,
  empty = "No data",
}: {
  rows: Row[];
  empty?: string;
}) {
  if (!rows.length) {
    return <div className="rounded-2xl border border-white/10 bg-black/15 p-4 text-sm text-white/55">{empty}</div>;
  }

  const columns = Array.from(
    rows.reduce((set, row) => {
      Object.keys(row).forEach((key) => set.add(key));
      return set;
    }, new Set<string>())
  );

  return (
    <div className="overflow-hidden rounded-[1.6rem] border border-white/10 bg-black/20 shadow-[0_24px_60px_rgba(0,0,0,0.24)]">
      <div className="w-full overflow-x-auto">
        <table className="min-w-max w-full border-collapse text-sm text-white/90">
          <thead className="sticky top-0 z-10">
            <tr>
              {columns.map((col) => (
                <th
                  key={col}
                  className="border-b border-white/10 bg-[#101720] px-4 py-3 text-left text-[10px] uppercase tracking-[0.18em] text-cyan-100/55"
                >
                  {col.replaceAll("_", " ")}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={i} className="odd:bg-transparent even:bg-white/[0.02] hover:bg-cyan-300/[0.05]">
                {columns.map((col) => (
                  <td
                    key={col}
                    className="max-w-[360px] break-words border-b border-white/5 px-4 py-3 align-top leading-6"
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
    </div>
  );
}

function RadarRow({
  label,
  fresh,
  total,
  tone,
}: {
  label: string;
  fresh: number | null;
  total: number | null;
  tone: Tone;
}) {
  const numerator = fresh ?? 0;
  const denominator = total ?? 0;
  const pct = denominator > 0 ? Math.round((numerator / denominator) * 100) : 0;

  return (
    <div className="grid gap-2 rounded-2xl border border-white/8 bg-black/15 p-3">
      <div className="flex items-center justify-between gap-4">
        <div className="text-sm font-medium text-white/85">{label}</div>
        <div className={`rounded-full border px-2.5 py-1 text-[10px] uppercase tracking-[0.18em] ${toneClass(tone)}`}>
          {pct}%
        </div>
      </div>
      <StageMeter tone={tone} fresh={fresh} total={total} />
    </div>
  );
}

export default async function DashboardPage() {
  let data: Awaited<ReturnType<typeof getDashboardData>> | null = null;
  let controlPlane: Awaited<ReturnType<typeof getControlPlaneOverview>> | null = null;

  try {
    data = await getDashboardData();
  } catch {}

  try {
    controlPlane = await getControlPlaneOverview();
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

  const stageByKey = new Map(data.stages.map((stage) => [stage.key, stage] as const));
  const trendStage = stageByKey.get("trend");
  const supplierStage = stageByKey.get("supplier");
  const marketplaceStage = stageByKey.get("marketplace");
  const matchingStage = stageByKey.get("matching");
  const profitabilityStage = stageByKey.get("profitability");
  const listingReadinessStage = stageByKey.get("listing_readiness");

  const overallHealthTone: Tone = data.stages.some((stage) => stage.renderState === "QUERY_FAILED" || stage.renderState === "PARTIAL_FAILURE" || stage.renderState === "STALE")
    ? "error"
    : data.stages.some((stage) => stage.renderState === "DEGRADED" || stage.renderState === "UNKNOWN" || stage.renderState === "ZERO")
      ? "warning"
      : "ok";
  const profitabilityTone = profitabilityStage ? stageTone(profitabilityStage) : "default";
  const marketplaceTone = marketplaceStage ? stageTone(marketplaceStage) : "default";
  const trendTone = trendStage ? stageTone(trendStage) : "default";
  const supplierTone = supplierStage ? stageTone(supplierStage) : "default";
  const matchingTone = matchingStage ? stageTone(matchingStage) : "default";
  const listingReadinessTone = listingReadinessStage ? stageTone(listingReadinessStage) : "default";
  const alertsTone: Tone = data.alerts.some((alert) => alert.tone === "error")
    ? "error"
    : data.alerts.some((alert) => alert.tone === "warning")
      ? "warning"
      : "ok";

  return (
    <main className="relative min-h-screen overflow-hidden bg-app text-white">
      <div className="pointer-events-none absolute inset-0">
        <div className="hero-orb hero-orb-a" />
        <div className="hero-orb hero-orb-b" />
        <div className="hero-orb hero-orb-c" />
        <div className="grid-overlay opacity-[0.12]" />
        <div className="absolute inset-x-[12%] top-28 h-40 rounded-full bg-cyan-300/10 blur-[120px]" />
        <div className="absolute right-[-6rem] top-[18rem] h-60 w-60 rounded-full bg-amber-300/10 blur-[140px]" />
      </div>

      <div className="relative mx-auto grid max-w-[1680px] gap-6 px-4 py-6 sm:px-6 lg:px-8">
        <header className="glass-card relative overflow-hidden rounded-[2.25rem] border border-white/10 px-5 py-5 sm:px-6 sm:py-6">
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(109,231,214,0.16),transparent_32%),radial-gradient(circle_at_80%_20%,rgba(242,194,103,0.14),transparent_28%)]" />
          <div className="relative grid gap-6 xl:grid-cols-[1.5fr_0.95fr]">
            <div>
              <div className="mb-4 inline-flex items-center gap-3 rounded-full border border-white/10 bg-white/[0.05] px-4 py-2 text-[11px] uppercase tracking-[0.24em] text-cyan-100/72">
                <span>Operational Control Surface</span>
                <span className={`rounded-full border px-2 py-1 ${toneClass(overallHealthTone)}`}>{toneLabel(overallHealthTone)}</span>
              </div>
              <h1 className="max-w-4xl text-4xl font-semibold tracking-[-0.04em] text-white sm:text-5xl">
                Monitoring Dashboard
              </h1>
              <p className="mt-4 max-w-3xl text-sm leading-7 text-white/68 sm:text-base">
                Canonical operational truth across trends, supplier ingestion, eBay marketplace scans,
                matching, profitability, and admin follow-up. This view now emphasizes freshness,
                actionability, and blockers instead of historical row volume.
              </p>

              <div className="mt-6 flex flex-wrap items-center gap-3 text-xs text-white/55">
                <div className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-2">
                  Rendered {formatDateTime(data.generatedAt)}
                </div>
                <div className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-2">
                  {data.refreshBehavior.refreshAction}
                </div>
                <div className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-2">
                  {data.refreshBehavior.dataSource}
                </div>
              </div>

              <div className="mt-7 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                <HeroMetric
                  label="Fresh Actionable"
                  value={data.headline.actionableFreshCandidates}
                  tone={profitabilityTone}
                  detail="Candidates that are fresh, approved, and listing-eligible."
                />
                <HeroMetric
                  label="Approved And Fresh"
                  value={data.headline.approvedFreshCandidates}
                  tone={profitabilityTone}
                  detail="Approved candidates that still sit within current freshness policy."
                />
                <HeroMetric
                  label="Stale Snapshot Reviews"
                  value={data.headline.manualReviewDueToStale}
                  tone={profitabilityTone}
                  detail="Manual review rows attributable to stale supplier or marketplace snapshots."
                />
                <HeroMetric
                  label="Critical Issues"
                  value={data.headline.criticalIssues}
                  tone={overallHealthTone}
                  detail="Current error-level operational issues surfaced from canonical truth."
                />
              </div>
            </div>

            <div className="grid gap-4">
              <div className="rounded-[2rem] border border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.10),rgba(255,255,255,0.03))] p-5 shadow-[0_30px_80px_rgba(0,0,0,0.32)]">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div className="text-[11px] uppercase tracking-[0.24em] text-white/45">Live Control Strip</div>
                    <div className="mt-2 text-2xl font-semibold text-white">Refresh And Triage</div>
                  </div>
                  <RefreshButton />
                </div>

                <div className="mt-5 grid gap-3 sm:grid-cols-2">
                  <CompactStat label="DB" value={data.infrastructure.db.status.toUpperCase()} tone={data.infrastructure.db.status === "ok" ? "ok" : "error"} />
                  <CompactStat label="Redis" value={data.infrastructure.redis.status.toUpperCase()} tone={data.infrastructure.redis.status === "ok" ? "ok" : "warning"} />
                  <CompactStat label="Stale eBay Snapshots" value={data.headline.staleMarketplaceSnapshots} tone={marketplaceTone} />
                  <CompactStat label="Open Alerts" value={data.alerts.length} tone={alertsTone} />
                </div>
              </div>

              <div className="rounded-[2rem] border border-white/10 bg-black/20 p-5">
                <div className="text-[11px] uppercase tracking-[0.24em] text-white/45">Freshness Radar</div>
                <div className="mt-4 grid gap-3">
                  {data.stages.map((stage) => (
                    <RadarRow
                      key={stage.key}
                      label={stage.label}
                      fresh={stage.freshRows}
                      total={stage.totalRows}
                      tone={stageTone(stage)}
                    />
                  ))}
                </div>
              </div>
            </div>
          </div>
        </header>

        {controlPlane ? <ControlPlaneOverviewPanel data={controlPlane} /> : null}

        {data.alerts.length ? (
          <Section
            eyebrow="Immediate Attention"
            title="Operational Alerts"
            description="These warnings are generated directly from canonical freshness, status, and blocker checks."
          >
            <div className="grid gap-3 lg:grid-cols-2 xl:grid-cols-3">
              {data.alerts.map((alert) => (
                <AlertCard
                  key={alert.id}
                  title={alert.title}
                  detail={alert.detail}
                  tone={alertToneToCard(alert.tone)}
                  href={alert.href}
                />
              ))}
            </div>
          </Section>
        ) : null}

        <Section
          eyebrow="Stage By Stage"
          title="Operational Status"
          description="Each card shows current freshness coverage, latest data timestamp, latest successful job-ledger run, and the dominant operational issue."
        >
          <div className="grid gap-4 xl:grid-cols-3">
            {data.stages.map((stage) => (
              <StageCard key={stage.key} stage={stage} />
            ))}
          </div>
        </Section>

        <div className="grid gap-6 xl:grid-cols-[1.08fr_0.92fr]">
          <Section
            eyebrow="Canonical Metrics"
            title="Pipeline Truth"
            description="All-time totals are separated from fresh coverage so legacy or sample rows do not distort the operational picture."
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

          <Section
            eyebrow="Runbook Surfaces"
            title="Operator Shortcuts"
            description="Existing admin consoles remain the execution surface. This dashboard is the triage layer."
          >
            <div className="grid gap-3">
              {data.adminLinks.map((link, index) => (
                <a
                  key={link.href}
                  href={link.href}
                  className="group rounded-[1.5rem] border border-white/10 bg-white/[0.04] px-4 py-4 transition hover:border-cyan-300/30 hover:bg-cyan-300/[0.08]"
                >
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <div className="text-[10px] uppercase tracking-[0.22em] text-white/40">Surface {index + 1}</div>
                      <div className="mt-2 text-lg font-semibold text-white">{link.label}</div>
                      <div className="mt-1 text-sm leading-6 text-white/60">{link.note}</div>
                    </div>
                    <div className="text-xl text-white/35 transition group-hover:text-cyan-100">↗</div>
                  </div>
                </a>
              ))}
            </div>

            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              <StatCard
                label="Ready To Publish"
                value={data.listingReadiness.readyToPublish}
                tone={listingReadinessTone}
              />
              <StatCard label="Preview" value={data.listingReadiness.preview} />
              <StatCard
                label="Active Listings"
                value={data.listingReadiness.active}
                tone={listingReadinessTone}
              />
              <StatCard
                label="Publish Failed"
                value={data.listingReadiness.publishFailed}
                tone={listingReadinessTone}
              />
            </div>
          </Section>
        </div>

        <Section
          eyebrow="Inbound Pipeline"
          title="Lead Status"
          description="Public-site inquiries now land in the database first so operator follow-up can be tracked alongside the rest of the workflow."
        >
          <div className="grid gap-4 xl:grid-cols-[0.8fr_1.2fr]">
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-1">
              <div className="rounded-[1.7rem] border border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.08),rgba(255,255,255,0.03))] p-5">
                <div className="text-[10px] uppercase tracking-[0.22em] text-white/40">Lead Queue</div>
                <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-2">
                  <StatCard label="Total Leads" value={data.leadPipeline.total} />
                  <StatCard label="New" value={data.leadPipeline.newLeads} tone={data.leadPipeline.newLeads > 0 ? "warning" : "ok"} />
                  <StatCard label="Contacted" value={data.leadPipeline.contacted} tone={data.leadPipeline.contacted > 0 ? "ok" : "default"} />
                  <StatCard label="Qualified" value={data.leadPipeline.qualified} tone={data.leadPipeline.qualified > 0 ? "ok" : "default"} />
                </div>
                <div className="mt-4 rounded-2xl border border-white/8 bg-white/[0.03] p-3 text-sm text-white/68">
                  Latest lead: {formatCompactDateTime(data.leadPipeline.latestLeadTs)}
                </div>
              </div>
            </div>

            <div className="rounded-[1.7rem] border border-white/10 bg-black/20 p-5">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <div className="text-[10px] uppercase tracking-[0.22em] text-white/40">Recent Inquiries</div>
                  <div className="mt-2 text-2xl font-semibold text-white">Stored For Follow-up</div>
                </div>
                <div className={`rounded-full border px-3 py-1 text-[11px] uppercase tracking-[0.18em] ${toneClass(data.leadPipeline.newLeads > 0 ? "warning" : "ok")}`}>
                  {data.leadPipeline.newLeads > 0 ? "new follow-up needed" : "queue clear"}
                </div>
              </div>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-white/60">
                Notification delivery stays visible beside each lead so operators can distinguish inbound demand from routing failures.
              </p>
              <div className="mt-5">
                <DataTable rows={data.leadPipeline.recentLeads} empty="No lead submissions stored yet" />
              </div>
            </div>
          </div>
        </Section>

        <div className="grid gap-6 xl:grid-cols-2">
          <Section
            eyebrow="Trend + Supplier"
            title="Intake Coverage"
            description="Trend and supplier intake are shown together to make it obvious when discovery breadth is only historical or seed-driven."
          >
            <div className="grid gap-4 md:grid-cols-2">
              <div className="rounded-[1.6rem] border border-white/10 bg-white/[0.04] p-4">
                <div className="mb-4 flex items-start justify-between gap-3">
                  <div>
                    <div className="text-[10px] uppercase tracking-[0.22em] text-white/40">Trend Coverage</div>
                    <div className="mt-2 text-xl font-semibold text-white">Signals By Recency</div>
                  </div>
                  <div className={`rounded-full border px-3 py-1 text-[11px] uppercase tracking-[0.18em] ${toneClass(data.trend.recentSignals24h > 0 ? "ok" : "warning")}`}>
                    {data.trend.recentSignals24h > 0 ? "current" : "stale"}
                  </div>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <StatCard label="Trend Signals" value={data.trend.totalSignals} />
                  <StatCard label="Signals In 24h" value={data.trend.recentSignals24h} tone={trendTone} />
                  <StatCard
                    label="Manual Seed Signals"
                    value={data.trend.manualSeedSignals}
                    tone={data.trend.manualSeedSignals === data.trend.totalSignals && data.trend.totalSignals > 0 ? "warning" : "default"}
                  />
                  <StatCard label="Last Trend Signal" value={formatCompactDateTime(data.trend.latestSignalTs)} />
                </div>
                <div className="mt-5">
                  <DataTable rows={data.trend.recentSignals} empty="No trend signals found" />
                </div>
              </div>

              <div className="rounded-[1.6rem] border border-white/10 bg-white/[0.04] p-4">
                <div className="mb-4 flex items-start justify-between gap-3">
                  <div>
                    <div className="text-[10px] uppercase tracking-[0.22em] text-white/40">Supplier Ingestion</div>
                    <div className="mt-2 text-xl font-semibold text-white">Snapshot Freshness</div>
                  </div>
                  <div className={`rounded-full border px-3 py-1 text-[11px] uppercase tracking-[0.18em] ${toneClass(data.supplier.freshRows > 0 ? "ok" : "warning")}`}>
                    {data.supplier.freshRows > 0 ? "current" : "stale"}
                  </div>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <StatCard label="Supplier Rows" value={data.supplier.totalRows} />
                  <StatCard label="Fresh Rows" value={data.supplier.freshRows} tone={supplierTone} />
                  <StatCard label="Stale Rows" value={data.supplier.staleRows} tone={supplierTone === "ok" ? "ok" : supplierTone} />
                  <StatCard label="Last Snapshot" value={formatCompactDateTime(data.supplier.latestSnapshotTs)} />
                </div>
                <div className="mt-5">
                  <DataTable rows={data.supplier.bySupplier} empty="No supplier snapshots found" />
                </div>
              </div>
            </div>

            <div className="mt-5">
              <h3 className="mb-3 text-lg font-semibold text-white">Recent trend candidates</h3>
              <DataTable rows={data.trend.recentCandidates} empty="No trend candidates found" />
            </div>
          </Section>

          <Section
            eyebrow="Marketplace + Matching"
            title="Live Commercial Signal"
            description="The marketplace and matching layers show whether the eBay-only v1 pipeline is actually current enough to support decisions."
          >
            <div className="grid gap-4 md:grid-cols-2">
              <div className="rounded-[1.6rem] border border-white/10 bg-white/[0.04] p-4">
                <div className="text-[10px] uppercase tracking-[0.22em] text-white/40">Marketplace Scan</div>
                <div className="mt-2 text-xl font-semibold text-white">eBay Snapshot Health</div>
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <StatCard label="Total eBay Rows" value={data.marketplace.totalEbayRows} />
                  <StatCard label="Fresh eBay Rows" value={data.marketplace.freshEbayRows} tone={marketplaceTone} />
                  <StatCard label="Stale eBay Rows" value={data.marketplace.staleEbayRows} tone={marketplaceTone} />
                  <StatCard label="Last Scan" value={formatCompactDateTime(data.marketplace.latestSuccessfulRunTs ?? data.marketplace.latestSnapshotTs)} />
                </div>
              </div>

              <div className="rounded-[1.6rem] border border-white/10 bg-white/[0.04] p-4">
                <div className="text-[10px] uppercase tracking-[0.22em] text-white/40">Matching Quality</div>
                <div className="mt-2 text-xl font-semibold text-white">Active eBay Matches</div>
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <StatCard label="Active Matches" value={data.matching.totalMatches} />
                  <StatCard label="Fresh In 24h" value={data.matching.freshMatches24h} tone={matchingTone} />
                  <StatCard label="Avg Confidence" value={formatPercent(data.matching.averageConfidence == null ? null : data.matching.averageConfidence * 100)} />
                  <StatCard label="Low Confidence" value={data.matching.lowConfidenceCount} tone={matchingTone === "error" ? "error" : matchingTone === "warning" ? "warning" : "ok"} />
                </div>
              </div>
            </div>

            <div className="mt-5">
              <h3 className="mb-3 text-lg font-semibold text-white">Recent active matches</h3>
              <DataTable rows={data.matching.recentMatches} empty="No active eBay matches found" />
            </div>
          </Section>
        </div>

        <Section
          eyebrow="Actionability"
          title="Profitability Truth"
          description="Top opportunities are framed by actual freshness, decision state, and blocker reason so stale rows cannot present as listing-ready wins."
        >
          <div className="grid gap-4 xl:grid-cols-[0.95fr_1.05fr]">
            <div className="grid gap-4">
              <div className="rounded-[1.7rem] border border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.08),rgba(255,255,255,0.03))] p-5">
                <div className="text-[10px] uppercase tracking-[0.22em] text-white/40">Outcome Stack</div>
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <StatCard label="Total Candidates" value={data.profitability.totalCandidates} />
                  <StatCard label="Approved" value={data.profitability.approved} tone={data.profitability.approved > 0 ? "ok" : "default"} />
                  <StatCard label="Manual Review" value={data.profitability.manualReview} tone={data.profitability.manualReview > 0 ? "warning" : "default"} />
                  <StatCard label="Pending Or Recheck" value={data.profitability.pending} />
                  <StatCard label="Fresh Actionable" value={data.profitability.actionableFresh} tone={data.profitability.actionableFresh > 0 ? "ok" : "warning"} />
                  <StatCard label="Approved And Fresh" value={data.profitability.approvedFresh} tone={data.profitability.approvedFresh > 0 ? "ok" : "warning"} />
                  <StatCard label="Blocked By Stale" value={data.profitability.blockedByStaleSnapshot} tone={data.profitability.blockedByStaleSnapshot > 0 ? "error" : "ok"} />
                  <StatCard label="Blocked By Availability" value={data.profitability.blockedByAvailability} tone={data.profitability.blockedByAvailability > 0 ? "warning" : "ok"} />
                </div>
              </div>

              <div className="rounded-[1.7rem] border border-white/10 bg-white/[0.04] p-5">
                <div className="text-[10px] uppercase tracking-[0.22em] text-white/40">Decision Breakdown</div>
                <div className="mt-4">
                  <DataTable rows={data.profitability.statusBreakdown} empty="No profitable candidates" />
                </div>
              </div>

              <div className="rounded-[1.7rem] border border-white/10 bg-white/[0.04] p-5">
                <div className="text-[10px] uppercase tracking-[0.22em] text-white/40">Primary Blockers</div>
                <div className="mt-4">
                  <DataTable rows={data.profitability.blockBreakdown} empty="No blocker breakdown available" />
                </div>
              </div>
            </div>

            <div className="rounded-[1.7rem] border border-white/10 bg-black/20 p-5">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <div className="text-[10px] uppercase tracking-[0.22em] text-white/40">Top Opportunity Board</div>
                  <div className="mt-2 text-2xl font-semibold text-white">Ranked With Truthfulness Guards</div>
                </div>
                <div className={`rounded-full border px-3 py-1 text-[11px] uppercase tracking-[0.18em] ${toneClass(data.profitability.actionableFresh > 0 ? "ok" : "warning")}`}>
                  {data.profitability.actionableFresh > 0 ? "actionable rows exist" : "no fresh actionables"}
                </div>
              </div>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-white/60">
                Rows are ranked by actionability first, then profit. Freshness status, snapshot ages, and blocking reason stay visible so stale manual-review rows cannot masquerade as live opportunities.
              </p>
              <div className="mt-5">
                <DataTable rows={data.profitability.topOpportunities} empty="No profitable opportunities yet" />
              </div>
            </div>
          </div>
        </Section>

        <Section
          eyebrow="Lineage"
          title="Field Lineage"
          description="Each dashboard metric documents its canonical source, the query family behind it, the business rule, and the fail-closed behavior when that source is unavailable."
        >
          <DataTable rows={data.fieldLineage} empty="No dashboard lineage metadata available" />
        </Section>

        {data.queryFailures.length ? (
          <Section
            eyebrow="Failures"
            title="Query Failures"
            description="These groups failed to load from canonical sources. The dashboard does not treat those failures as zero-state data."
          >
            <DataTable rows={data.queryFailures} empty="No query failures detected" />
          </Section>
        ) : null}

        <Section
          eyebrow="Evidence"
          title="Diagnostics"
          description="Canonical jobs, worker runs, and audit events remain visible so operators can trace freshness gaps back to execution reality."
        >
          <div className="grid gap-5 xl:grid-cols-3">
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
    </main>
  );
}
