import RefreshButton from "../_components/RefreshButton";
import { getDashboardData } from "@/lib/dashboard/getDashboardData";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section
      style={{
        border: "1px solid #e5e7eb",
        borderRadius: 16,
        padding: 20,
        background: "#ffffff",
        boxShadow: "0 1px 2px rgba(0,0,0,0.04)",
      }}
    >
      <h2 style={{ margin: "0 0 16px 0", fontSize: 20 }}>{title}</h2>
      {children}
    </section>
  );
}

function StatCard({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: React.ReactNode;
  tone?: "default" | "ok" | "error" | "unknown";
}) {
  const colors = {
    default: { bg: "#f9fafb", border: "#e5e7eb", text: "#111827" },
    ok: { bg: "#ecfdf5", border: "#a7f3d0", text: "#065f46" },
    error: { bg: "#fef2f2", border: "#fecaca", text: "#991b1b" },
    unknown: { bg: "#fffbeb", border: "#fde68a", text: "#92400e" },
  } as const;

  const c = colors[tone];

  return (
    <div
      style={{
        padding: 16,
        borderRadius: 14,
        border: `1px solid ${c.border}`,
        background: c.bg,
      }}
    >
      <div style={{ fontSize: 13, color: "#6b7280", marginBottom: 8 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700, color: c.text }}>{value}</div>
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
    return <div style={{ color: "#6b7280" }}>{empty}</div>;
  }

  const columns = Array.from(
    rows.reduce((set, row) => {
      Object.keys(row).forEach((k) => set.add(k));
      return set;
    }, new Set<string>())
  );

  return (
    <div style={{ overflowX: "auto" }}>
      <table
        style={{
          width: "100%",
          borderCollapse: "collapse",
          fontSize: 14,
        }}
      >
        <thead>
          <tr>
            {columns.map((col) => (
              <th
                key={col}
                style={{
                  textAlign: "left",
                  borderBottom: "1px solid #e5e7eb",
                  padding: "10px 8px",
                  background: "#f9fafb",
                }}
              >
                {col}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i}>
              {columns.map((col) => (
                <td
                  key={col}
                  style={{
                    borderBottom: "1px solid #f1f5f9",
                    padding: "10px 8px",
                    verticalAlign: "top",
                    whiteSpace: "nowrap",
                    maxWidth: 260,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
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

  const dbTone =
    data.infrastructure.db.status === "ok"
      ? "ok"
      : data.infrastructure.db.status === "error"
      ? "error"
      : "unknown";

  const redisTone =
    data.infrastructure.redis.status === "ok"
      ? "ok"
      : data.infrastructure.redis.status === "error"
      ? "error"
      : "unknown";

  return (
    <main
      style={{
        padding: 24,
        background: "#f5f7fb",
        minHeight: "100vh",
      }}
    >
      <div
        style={{
          maxWidth: 1500,
          margin: "0 auto",
          display: "grid",
          gap: 20,
        }}
      >
        <header
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
            gap: 16,
            flexWrap: "wrap",
          }}
        >
          <div>
            <h1 style={{ margin: 0, fontSize: 32 }}>Monitoring Dashboard</h1>
            <p style={{ margin: "8px 0 0 0", color: "#6b7280" }}>
              AI Arbitrage Engine v1 — Milestone 1 pipeline visibility
            </p>
            <p style={{ margin: "8px 0 0 0", color: "#6b7280", fontSize: 13 }}>
              Generated at: {data.generatedAt}
            </p>
          </div>

          <RefreshButton />
        </header>

        <Section title="1) Infrastructure health">
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
              gap: 16,
            }}
          >
            <StatCard label="DB health" value={data.infrastructure.db.status} tone={dbTone} />
            <StatCard label="Redis health" value={data.infrastructure.redis.status} tone={redisTone} />
            <StatCard label="NODE_ENV" value={data.infrastructure.environment.nodeEnv} />
            <StatCard label="VERCEL_ENV" value={data.infrastructure.environment.vercelEnv} />
          </div>

          <div style={{ marginTop: 16, color: "#6b7280", fontSize: 14 }}>
            <div>DB detail: {data.infrastructure.db.detail ?? "-"}</div>
            <div>Redis detail: {data.infrastructure.redis.detail ?? "-"}</div>
          </div>
        </Section>

        <Section title="2) Pipeline counts">
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
              gap: 16,
            }}
          >
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

        <Section title="3) Fresh activity">
          <div style={{ display: "grid", gap: 20 }}>
            {data.latestActivity.map((block) => (
              <div
                key={block.table}
                style={{
                  border: "1px solid #e5e7eb",
                  borderRadius: 12,
                  padding: 16,
                  background: "#fafafa",
                }}
              >
                <div style={{ marginBottom: 12 }}>
                  <strong>{block.table}</strong>{" "}
                  <span style={{ color: "#6b7280" }}>
                    {block.exists
                      ? block.orderBy
                        ? `(ordered by ${block.orderBy})`
                        : `(no common timestamp column detected)`
                      : `(table missing)`}
                  </span>
                </div>

                {block.error ? (
                  <div style={{ color: "#991b1b", marginBottom: 8 }}>{block.error}</div>
                ) : null}

                <DataTable rows={block.rows} empty="No recent rows found" />
              </div>
            ))}
          </div>
        </Section>

        <Section title="4) Quality metrics">
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
              gap: 16,
              marginBottom: 20,
            }}
          >
            <StatCard
              label="Average match confidence"
              value={
                data.quality.averageMatchConfidence == null
                  ? "-"
                  : data.quality.averageMatchConfidence
              }
            />
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: 20,
            }}
          >
            <div>
              <h3 style={{ marginTop: 0 }}>Candidates by marketplace</h3>
              <DataTable
                rows={data.quality.candidatesByMarketplace}
                empty="No marketplace candidate data"
              />
            </div>

            <div>
              <h3 style={{ marginTop: 0 }}>Candidates by supplier</h3>
              <DataTable
                rows={data.quality.candidatesBySupplier}
                empty="No supplier candidate data"
              />
            </div>
          </div>

          <div style={{ marginTop: 20 }}>
            <h3 style={{ marginTop: 0 }}>Top profitable opportunities</h3>
            <DataTable
              rows={data.quality.topProfitableOpportunities}
              empty="No profitable opportunities yet"
            />
          </div>
        </Section>

        <Section title="5) Job visibility">
          <div style={{ marginBottom: 16, color: "#6b7280" }}>
            Queue: <strong>{data.jobs.queueName}</strong>
          </div>

          {data.jobs.error ? (
            <div
              style={{
                marginBottom: 16,
                padding: 12,
                borderRadius: 10,
                border: "1px solid #fecaca",
                background: "#fef2f2",
                color: "#991b1b",
              }}
            >
              {data.jobs.error}
            </div>
          ) : null}

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
              gap: 16,
              marginBottom: 20,
            }}
          >
            {Object.entries(data.jobs.counts).map(([key, value]) => (
              <StatCard key={key} label={key} value={value} />
            ))}
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: 20,
            }}
          >
            <div>
              <h3 style={{ marginTop: 0 }}>Recent failed jobs</h3>
              <DataTable rows={data.jobs.recentFailed} empty="No failed jobs found" />
            </div>

            <div>
              <h3 style={{ marginTop: 0 }}>Recent succeeded jobs</h3>
              <DataTable rows={data.jobs.recentSucceeded} empty="No completed jobs found" />
            </div>
          </div>
        </Section>
      </div>
    </main>
  );
}
