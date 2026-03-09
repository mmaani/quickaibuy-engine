import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { getControlPanelData } from "@/lib/server/controlPanelData";
import { isAuthorizedReviewAuthorizationHeader, isReviewConsoleConfigured } from "@/lib/review/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

async function requireAdmin() {
  const auth = (await headers()).get("authorization");
  if (!isReviewConsoleConfigured() || !isAuthorizedReviewAuthorizationHeader(auth)) {
    notFound();
  }
}

function StatusBadge({ ok }: { ok: boolean }) {
  return (
    <span
      style={{
        display: "inline-block",
        padding: "4px 10px",
        borderRadius: 999,
        fontSize: 12,
        fontWeight: 600,
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
  body,
}: {
  title: string;
  ok: boolean;
  status: number | null;
  error: string | null;
  body: React.ReactNode;
}) {
  return (
    <section
      style={{
        border: "1px solid #E5E7EB",
        borderRadius: 16,
        padding: 20,
        background: "#FFFFFF",
        boxShadow: "0 1px 2px rgba(0,0,0,0.04)",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <h2 style={{ margin: 0, fontSize: 18 }}>{title}</h2>
        <StatusBadge ok={ok} />
      </div>

      <div style={{ fontSize: 14, color: "#4B5563", marginBottom: 10 }}>
        HTTP: {status ?? "n/a"}
      </div>

      {error ? (
        <div style={{ marginBottom: 10, color: "#B91C1C", fontSize: 14 }}>
          Error: {error}
        </div>
      ) : null}

      <div>{body}</div>
    </section>
  );
}

export default async function AdminControlPage() {
  await requireAdmin();

  const data = await getControlPanelData();

  const healthData = (data.health.data ?? {}) as Record<string, unknown>;
  const queueData = (data.queues.data ?? {}) as Record<string, unknown>;
  const workerRunsData = (data.workerRuns.data ?? {}) as Record<string, unknown>;

  return (
    <main
      style={{
        fontFamily: "var(--font-inter, Arial, sans-serif)",
        background: "#F9FAFB",
        minHeight: "100vh",
        padding: 24,
      }}
    >
      <div style={{ maxWidth: 1200, margin: "0 auto" }}>
        <header style={{ marginBottom: 24 }}>
          <h1 style={{ margin: 0, fontSize: 32 }}>Admin Control Panel</h1>
          <p style={{ marginTop: 8, color: "#6B7280" }}>
            Infrastructure status, queue visibility, and worker activity.
          </p>
          <p style={{ marginTop: 8, color: "#9CA3AF", fontSize: 13 }}>
            Generated at: {data.generatedAt}
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
            ok={data.health.ok}
            status={data.health.status}
            error={data.health.error}
            body={
              <pre style={{ whiteSpace: "pre-wrap", wordBreak: "break-word", margin: 0, fontSize: 13 }}>
                {JSON.stringify(healthData, null, 2)}
              </pre>
            }
          />

          <Card
            title="Queue Status"
            ok={data.queues.ok}
            status={data.queues.status}
            error={data.queues.error}
            body={
              <pre style={{ whiteSpace: "pre-wrap", wordBreak: "break-word", margin: 0, fontSize: 13 }}>
                {JSON.stringify(queueData, null, 2)}
              </pre>
            }
          />

          <Card
            title="Worker Runs"
            ok={data.workerRuns.ok}
            status={data.workerRuns.status}
            error={data.workerRuns.error}
            body={
              <pre style={{ whiteSpace: "pre-wrap", wordBreak: "break-word", margin: 0, fontSize: 13 }}>
                {JSON.stringify(workerRunsData, null, 2)}
              </pre>
            }
          />
        </div>
      </div>
    </main>
  );
}
