import { headers } from "next/headers";
import { getControlPanelData } from "@/lib/server/controlPanelData";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

function Badge({ ok }: { ok: boolean }) {
  return (
    <span
      style={{
        display: "inline-block",
        padding: "4px 10px",
        borderRadius: 999,
        fontSize: 12,
        fontWeight: 700,
        background: ok ? "#DCFCE7" : "#FEE2E2",
        color: ok ? "#166534" : "#991B1B",
      }}
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
    <section
      style={{
        border: "1px solid #E5E7EB",
        borderRadius: 16,
        padding: 20,
        background: "#fff",
        boxShadow: "0 1px 2px rgba(0,0,0,0.04)",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <h2 style={{ margin: 0, fontSize: 18 }}>{title}</h2>
        <Badge ok={ok} />
      </div>

      <div style={{ fontSize: 13, color: "#6B7280", marginBottom: 10 }}>
        HTTP: {status ?? "n/a"}
      </div>

      {error ? (
        <div style={{ color: "#B91C1C", marginBottom: 10, fontSize: 13 }}>
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
    <main
      style={{
        padding: 24,
        background: "#F9FAFB",
        minHeight: "100vh",
        fontFamily: "Arial, sans-serif",
      }}
    >
      <div style={{ maxWidth: 1400, margin: "0 auto" }}>
        <header style={{ marginBottom: 24 }}>
          <h1 style={{ margin: 0, fontSize: 30 }}>QuickAIBuy Control Panel</h1>
          <p style={{ marginTop: 8, color: "#6B7280" }}>
            Live infrastructure and worker visibility.
          </p>
          <p style={{ marginTop: 8, color: "#9CA3AF", fontSize: 12 }}>
            Generated at: {panel.generatedAt}
          </p>
        </header>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
            gap: 16,
          }}
        >
          <Card
            title="System Health"
            ok={panel.health.ok}
            status={panel.health.status}
            error={panel.health.error}
          >
            <pre style={{ margin: 0, whiteSpace: "pre-wrap", fontSize: 12 }}>
              {JSON.stringify(panel.health.data, null, 2)}
            </pre>
          </Card>

          <Card
            title="Queue Status"
            ok={panel.queues.ok}
            status={panel.queues.status}
            error={panel.queues.error}
          >
            <pre style={{ margin: 0, whiteSpace: "pre-wrap", fontSize: 12 }}>
              {JSON.stringify(panel.queues.data, null, 2)}
            </pre>
          </Card>

          <Card
            title="Worker Runs"
            ok={panel.workerRuns.ok}
            status={panel.workerRuns.status}
            error={panel.workerRuns.error}
          >
            <pre style={{ margin: 0, whiteSpace: "pre-wrap", fontSize: 12 }}>
              {JSON.stringify(panel.workerRuns.data, null, 2)}
            </pre>
          </Card>

          <Card
            title="Recent Errors / Audit"
            ok={panel.errors.ok}
            status={panel.errors.status}
            error={panel.errors.error}
          >
            <pre style={{ margin: 0, whiteSpace: "pre-wrap", fontSize: 12 }}>
              {JSON.stringify(panel.errors.data, null, 2)}
            </pre>
          </Card>
        </div>
      </div>
    </main>
  );
}
