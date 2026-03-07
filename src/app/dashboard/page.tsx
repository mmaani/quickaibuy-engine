import RefreshButton from "../_components/RefreshButton";
import { getDashboardData } from "@/lib/dashboard/getDashboardData";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type Tone = "default" | "ok" | "error" | "unknown";

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
  if (tone === "error") return "border-rose-300/30 bg-rose-400/10 text-rose-100";
  if (tone === "unknown") return "border-amber-300/30 bg-amber-400/10 text-amber-100";
  return "border-white/10 bg-white/[0.04] text-white";
}

function StatCard({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: React.ReactNode;
  tone?: Tone;
}) {
  return (
    <div className={`rounded-2xl border p-4 ${toneClass(tone)}`}>
      <div className="mb-2 text-[11px] uppercase tracking-[0.2em] text-white/55">{label}</div>
      <div className="text-2xl font-bold leading-tight text-balance">{value}</div>
    </div>
  );
}

function StatusPill({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: Tone;
}) {
  return (
    <div className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs ${toneClass(tone)}`}>
      <span className="text-white/70">{label}</span>
      <span className="font-semibold uppercase tracking-wide">{value}</span>
    </div>
  );
}

function formatCell(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function DataTable({
  rows,
  empty = "No data",
}: {
  rows: Array<Record<string, unknown>>;
  empty?: string;
}) {
  if (!rows.length) {
    return <div className="rounded-xl border border-white/10 bg-black/15 p-3 text-sm text-white/55">{empty}</div>;
  }

  const columns = Array.from(
    rows.reduce((set, row) => {
      Object.keys(row).forEach((k) => set.add(k));
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
  const data = await getDashboardData();

  const totalPipelineRows = data.pipelineCounts.reduce((sum, item) => sum + (item.count ?? 0), 0);
  const activeFailures = data.jobs.counts.failed ?? 0;

  const dbTone: Tone =
    data.infrastructure.db.status === "ok"
      ? "ok"
      : data.infrastructure.db.status === "error"
        ? "error"
        : "unknown";

  const redisTone: Tone =
    data.infrastructure.redis.status === "ok"
      ? "ok"
      : data.infrastructure.redis.status === "error"
        ? "error"
        : "unknown";

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
                Clear visibility into infrastructure, ingestion health, and execution outcomes.
              </p>
              <p className="mt-2 text-xs text-white/45">Generated at: {data.generatedAt}</p>
            </div>
            <RefreshButton />
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            <StatusPill label="DB" value={data.infrastructure.db.status} tone={dbTone} />
            <StatusPill label="Redis" value={data.infrastructure.redis.status} tone={redisTone} />
            <StatusPill label="Queue" value={data.jobs.queueName} tone="default" />
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard label="Pipeline rows tracked" value={totalPipelineRows} />
            <StatCard label="Failed jobs" value={activeFailures} tone={activeFailures > 0 ? "error" : "ok"} />
            <StatCard label="Recent failed jobs" value={data.jobs.recentFailed.length} tone={data.jobs.recentFailed.length ? "error" : "ok"} />
            <StatCard label="Recent succeeded jobs" value={data.jobs.recentSucceeded.length} tone="ok" />
          </div>
        </header>

        <div className="grid gap-5 xl:grid-cols-[340px_minmax(0,1fr)]">
          <div className="grid gap-5">
            <Section title="Infrastructure" description="Runtime and connectivity checks for core dependencies.">
              <div className="grid grid-cols-1 gap-4">
                <StatCard label="DB health" value={data.infrastructure.db.status} tone={dbTone} />
                <StatCard label="Redis health" value={data.infrastructure.redis.status} tone={redisTone} />
                <StatCard label="NODE_ENV" value={data.infrastructure.environment.nodeEnv} />
                <StatCard label="VERCEL_ENV" value={data.infrastructure.environment.vercelEnv} />
              </div>
              <div className="mt-4 space-y-1 text-sm text-white/60">
                <div>DB detail: {data.infrastructure.db.detail ?? "-"}</div>
                <div>Redis detail: {data.infrastructure.redis.detail ?? "-"}</div>
              </div>
            </Section>

            <Section title="Pipeline Counts" description="Row counts from key pipeline tables to spot ingestion gaps quickly.">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-1">
                {data.pipelineCounts.map((item) => (
                  <StatCard
                    key={item.table}
                    label={item.table}
                    value={item.exists ? item.count ?? "null" : "missing"}
                    tone={item.exists ? "default" : "error"}
                  />
                ))}
              </div>
            </Section>

            <Section title="Quality Snapshot" description="High-level signal quality indicators.">
              <StatCard
                label="Average match confidence"
                value={
                  data.quality.averageMatchConfidence == null
                    ? "-"
                    : data.quality.averageMatchConfidence
                }
              />
            </Section>
          </div>

          <div className="grid gap-5">
            <Section title="Fresh Activity" description="Most recent rows pulled from active tables for quick review.">
              <div className="grid gap-5">
                {data.latestActivity.map((block) => (
                  <div key={block.table} className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                    <div className="mb-3 text-sm">
                      <strong>{block.table}</strong>{" "}
                      <span className="text-white/55">
                        {block.exists
                          ? block.orderBy
                            ? `(ordered by ${block.orderBy})`
                            : `(no common timestamp column detected)`
                          : `(table missing)`}
                      </span>
                    </div>

                    {block.error ? <div className="mb-2 text-sm text-rose-300">{block.error}</div> : null}

                    <DataTable rows={block.rows} empty="No recent rows found" />
                  </div>
                ))}
              </div>
            </Section>

            <Section title="Job Visibility" description="Queue metrics and most recent failed/succeeded job payloads.">
              {data.jobs.error ? (
                <div className="mb-4 rounded-xl border border-rose-300/35 bg-rose-400/10 p-3 text-sm text-rose-100">
                  {data.jobs.error}
                </div>
              ) : null}

              <div className="mb-5 grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-4">
                {Object.entries(data.jobs.counts).map(([key, value]) => (
                  <StatCard key={key} label={key} value={value} />
                ))}
              </div>

              <div className="grid grid-cols-1 gap-5 2xl:grid-cols-2">
                <div>
                  <h3 className="mb-3 text-lg font-semibold text-white">Recent failed jobs</h3>
                  <DataTable rows={data.jobs.recentFailed} empty="No failed jobs found" />
                </div>

                <div>
                  <h3 className="mb-3 text-lg font-semibold text-white">Recent succeeded jobs</h3>
                  <DataTable rows={data.jobs.recentSucceeded} empty="No completed jobs found" />
                </div>
              </div>
            </Section>

            <Section title="Quality Details" description="Breakdown of opportunity quality and profitability coverage.">
              <div className="grid grid-cols-1 gap-5 2xl:grid-cols-2">
                <div>
                  <h3 className="mb-3 text-lg font-semibold text-white">Candidates by marketplace</h3>
                  <DataTable
                    rows={data.quality.candidatesByMarketplace}
                    empty="No marketplace candidate data"
                  />
                </div>

                <div>
                  <h3 className="mb-3 text-lg font-semibold text-white">Candidates by supplier</h3>
                  <DataTable rows={data.quality.candidatesBySupplier} empty="No supplier candidate data" />
                </div>
              </div>

              <div className="mt-5">
                <h3 className="mb-3 text-lg font-semibold text-white">Top profitable opportunities</h3>
                <DataTable
                  rows={data.quality.topProfitableOpportunities}
                  empty="No profitable opportunities yet"
                />
              </div>
            </Section>
          </div>
        </div>
      </div>
    </main>
  );
}
