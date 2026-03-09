import { headers } from "next/headers";
import { getControlPanelData } from "@/lib/server/controlPanelData";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

function Badge({ ok }: { ok: boolean }) {
  return (
    <span
      className={`inline-flex rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.08em] ${
        ok ? "bg-emerald-400/20 text-emerald-100" : "bg-rose-400/20 text-rose-100"
      }`}
    >
      {ok ? "OK" : "DEGRADED"}
    </span>
  );
}

function Card({
  title,
  ok,
  status,
  error,
  children,
}: {
  title: string;
  ok: boolean;
  status: number | null;
  error: string | null;
  children: React.ReactNode;
}) {
  return (
    <section className="glass-panel rounded-3xl border border-white/10 p-5">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="m-0 text-lg font-semibold text-white">{title}</h2>
        <Badge ok={ok} />
      </div>

      <div className="mb-3 text-xs text-white/60">
        HTTP: {status ?? "n/a"}
      </div>

      {error ? (
        <div className="mb-3 rounded-xl border border-rose-300/35 bg-rose-500/10 p-2 text-xs text-rose-100">
          Error: {error}
        </div>
      ) : null}

      {children}
    </section>
  );
}

export default async function AdminControlPage() {
  const authHeader = (await headers()).get("authorization");
  const panel = await getControlPanelData(authHeader);

  return (
    <main className="relative min-h-screen bg-app text-white">
      <div className="relative mx-auto grid max-w-[1600px] gap-5 px-4 py-6 sm:px-6 lg:px-8">
        <header className="glass-card rounded-3xl border border-white/10 px-5 py-4 sm:px-6">
          <h1 className="m-0 text-3xl font-bold">Operational Control Panel</h1>
          <p className="mt-2 text-sm text-white/65">
            Official v1 operations console. Use this for health, alerts, and live runtime visibility.
          </p>
          <p className="mt-2 text-xs text-white/45">
            Generated at: {panel.generatedAt}
          </p>
        </header>

        <div className="grid gap-4 lg:grid-cols-2">
          <Card
            title="System Health"
            ok={panel.health.ok}
            status={panel.health.status}
            error={panel.health.error}
          >
            <pre className="max-h-[420px] overflow-auto whitespace-pre-wrap break-words rounded-2xl border border-white/10 bg-black/20 p-3 text-xs text-white/85">
              {JSON.stringify(panel.health.data, null, 2)}
            </pre>
          </Card>

          <Card
            title="Queue Status"
            ok={panel.queues.ok}
            status={panel.queues.status}
            error={panel.queues.error}
          >
            <pre className="max-h-[420px] overflow-auto whitespace-pre-wrap break-words rounded-2xl border border-white/10 bg-black/20 p-3 text-xs text-white/85">
              {JSON.stringify(panel.queues.data, null, 2)}
            </pre>
          </Card>

          <Card
            title="Worker Runs"
            ok={panel.workerRuns.ok}
            status={panel.workerRuns.status}
            error={panel.workerRuns.error}
          >
            <pre className="max-h-[420px] overflow-auto whitespace-pre-wrap break-words rounded-2xl border border-white/10 bg-black/20 p-3 text-xs text-white/85">
              {JSON.stringify(panel.workerRuns.data, null, 2)}
            </pre>
          </Card>

          <Card
            title="Recent Errors / Audit"
            ok={panel.errors.ok}
            status={panel.errors.status}
            error={panel.errors.error}
          >
            <pre className="max-h-[420px] overflow-auto whitespace-pre-wrap break-words rounded-2xl border border-white/10 bg-black/20 p-3 text-xs text-white/85">
              {JSON.stringify(panel.errors.data, null, 2)}
            </pre>
          </Card>
        </div>
      </div>
    </main>
  );
}
