import RefreshButton from "../_components/RefreshButton";
import { getDashboardData } from "@/lib/dashboard/getDashboardData";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type Tone = "default" | "ok" | "error";

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
  let data: Awaited<ReturnType<typeof getDashboardData>> | null = null;
  let loadError: string | null = null;

  try {
    data = await getDashboardData();
  } catch (error) {
    loadError = error instanceof Error ? error.message : String(error);
  }

  if (!data) {
    return (
      <main className="relative min-h-screen bg-app text-white">
        <div className="relative mx-auto grid max-w-[900px] gap-5 px-4 py-6 sm:px-6 lg:px-8">
          <header className="glass-card rounded-3xl border border-rose-300/30 bg-rose-400/10 px-5 py-4 sm:px-6">
            <h1 className="m-0 text-2xl font-bold text-rose-100">Dashboard temporarily unavailable</h1>
            <p className="mt-2 text-sm text-rose-100/90">
              We couldn&apos;t load dashboard data right now. Please retry in a minute.
            </p>
            {loadError ? <p className="mt-2 text-xs text-rose-100/70">Error: {loadError}</p> : null}
            <div className="mt-4">
              <RefreshButton />
            </div>
          </header>
        </div>
      </main>
    );
  }

  const totalPipelineRows = data.pipelineCounts.reduce((sum, item) => sum + (item.count ?? 0), 0) ?? 0;
  const profitableCount = data.pipelineCounts.find((x) => x.table === "profitable_candidates")?.count ?? 0;
  const avgConfidence = data.quality.averageMatchConfidence;

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
                Business and analytics visibility for pipeline output quality and opportunity coverage.
              </p>
              <p className="mt-2 text-xs text-white/45">Generated at: {data.generatedAt}</p>
            </div>
            <RefreshButton />
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard label="Pipeline rows tracked" value={totalPipelineRows} />
            <StatCard label="Profitable candidates" value={profitableCount} />
            <StatCard
              label="Average match confidence"
              value={avgConfidence == null ? "-" : avgConfidence}
            />
            <StatCard label="Top opportunities listed" value={data.quality.topProfitableOpportunities.length} tone="ok" />
          </div>
        </header>

        <div className="grid gap-5 xl:grid-cols-[340px_minmax(0,1fr)]">
          <div className="grid gap-5">
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

            <Section title="Admin Surfaces" description="Use dedicated admin consoles for operations and decisions.">
              <div className="grid gap-3">
                <a
                  href="/admin/control"
                  className="rounded-2xl border border-cyan-300/30 bg-cyan-500/10 px-4 py-3 text-sm font-semibold text-cyan-100"
                >
                  Open Operational Control Panel
                </a>
                <a
                  href="/admin/listings"
                  className="rounded-2xl border border-amber-300/30 bg-amber-500/10 px-4 py-3 text-sm font-semibold text-amber-100"
                >
                  Open Listings Console
                </a>
                <a
                  href="/admin/review"
                  className="rounded-2xl border border-emerald-300/30 bg-emerald-500/10 px-4 py-3 text-sm font-semibold text-emerald-100"
                >
                  Open Review Console
                </a>
                <a
                  href="/admin/orders"
                  className="rounded-2xl border border-violet-300/30 bg-violet-500/10 px-4 py-3 text-sm font-semibold text-violet-100"
                >
                  Open Orders Console
                </a>
              </div>
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
