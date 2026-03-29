import Link from "next/link";
import type { ControlPlaneOverview } from "@/lib/controlPlane/getControlPlaneOverview";

type Variant = "compact" | "expanded";

function toneClass(tone: "healthy" | "watch" | "paused" | "critical" | "info") {
  if (tone === "healthy") return "border-emerald-300/30 bg-emerald-500/10 text-emerald-100";
  if (tone === "watch") return "border-amber-300/30 bg-amber-500/10 text-amber-100";
  if (tone === "paused" || tone === "critical") return "border-rose-300/30 bg-rose-500/10 text-rose-100";
  return "border-cyan-300/30 bg-cyan-500/10 text-cyan-100";
}

function severityTone(severity: "info" | "warning" | "critical") {
  if (severity === "critical") return toneClass("critical");
  if (severity === "warning") return toneClass("watch");
  return toneClass("info");
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return "unknown";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "unknown";
  return date.toLocaleString("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  });
}

function Stat({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-white/10 bg-black/20 p-3">
      <div className="text-[10px] uppercase tracking-[0.18em] text-white/45">{label}</div>
      <div className="mt-2 text-lg font-semibold text-white">{value}</div>
    </div>
  );
}

function formatPercent(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return "n/a";
  return `${Math.round(value * 100)}%`;
}

export function ControlPlaneOverviewPanel({
  data,
  variant = "expanded",
}: {
  data: ControlPlaneOverview;
  variant?: Variant;
}) {
  const latestRun = data.latestRun;
  const compact = variant === "compact";
  const runtimeSourceLabel = data.runtime.envSource ?? data.runtime.dotenvPath ?? "unknown";
  const latestRunLabel = latestRun?.generatedAt ? formatDateTime(latestRun.generatedAt) : "unavailable";
  const latestFullCycleLabel = data.latestFullCycleRun?.generatedAt
    ? formatDateTime(data.latestFullCycleRun.generatedAt)
    : "unavailable";
  const topSuppliers = [...data.summary.supplierReliability]
    .sort((left, right) => right.candidates - left.candidates)
    .slice(0, compact ? 2 : 4);
  const candidateMix = [...data.summary.candidateUniverse.supplierMix]
    .sort((left, right) => right.totalCandidates - left.totalCandidates)
    .slice(0, compact ? 2 : 4);

  return (
    <section className="glass-panel rounded-3xl border border-white/10 p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="text-[11px] uppercase tracking-[0.22em] text-white/45">Autonomous Control Plane</div>
          <h2 className="mt-2 text-xl font-semibold text-white">
            {compact ? "Runtime Truth Strip" : "Canonical Autonomous Backbone Status"}
          </h2>
          <div className="mt-2 text-sm text-white/65">
            Runtime source {runtimeSourceLabel} on DB target {data.runtime.dbTargetClassification ?? "unknown"}.
            {" "}
            Latest run {latestRunLabel}.
          </div>
        </div>
        <div className={`rounded-full border px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.18em] ${toneClass(data.health.pipelineState)}`}>
          {data.health.pipelineState}
        </div>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-6">
        <Stat label="Env source" value={runtimeSourceLabel} />
        <Stat label="DB target" value={data.runtime.dbTargetClassification ?? "unknown"} />
        <Stat label="Shipping blocks" value={data.summary.shippingBlocks} />
        <Stat label="Ready to publish" value={data.summary.pipeline.readyToPublish} />
        <Stat label="Manual purchase queue" value={data.summary.manualPurchaseQueueCount} />
        <Stat label="Repeat customers" value={data.summary.repeatCustomerGrowth.repeatCustomers} />
      </div>

      <div className="mt-4 rounded-2xl border border-white/10 bg-black/20 p-4">
        <div className="mb-3 text-[11px] uppercase tracking-[0.18em] text-white/45">Operating mode</div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Stat label="Operating branch" value={data.runtime.sensitiveFilePolicy?.operatingBranch ?? "main"} />
          <Stat label="Canonical command" value={data.runtime.sensitiveFilePolicy?.canonicalFullCycleCommand ?? "pnpm ops:full-cycle"} />
          <Stat label="Full-cycle available" value={data.runtime.sensitiveFilePolicy ? "yes" : "yes"} />
          <Stat label="Safe to run now" value={data.health.safeToRunFullCycleNow ? "yes" : "no"} />
        </div>
        <div className="mt-3 text-sm text-white/70">
          Last full-cycle run {latestFullCycleLabel}. Result {data.latestFullCycleRun?.ok == null ? "unknown" : data.latestFullCycleRun.ok ? "ok" : "failed"}.
        </div>
        {data.latestFullCycleRun?.stages?.length ? (
          <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
            {data.latestFullCycleRun.stages.slice(0, compact ? 4 : 9).map((stage) => (
              <div key={stage.key} className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-white/75">
                {stage.key}: {stage.status}
                {stage.reasonCode ? ` (${stage.reasonCode})` : ""}
              </div>
            ))}
          </div>
        ) : null}
      </div>

      {data.learningHub ? (
        <div className="mt-4 rounded-2xl border border-white/10 bg-black/20 p-4">
          <div className="mb-3 text-[11px] uppercase tracking-[0.18em] text-white/45">Learning hub + data quality</div>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Stat
              label="Evidence pass / warn / fail"
              value={`${data.learningHub.evidence.pass} / ${data.learningHub.evidence.warn} / ${data.learningHub.evidence.fail}`}
            />
            <Stat
              label="Open drift (critical)"
              value={`${data.learningHub.openDrift.total} (${data.learningHub.openDrift.critical})`}
            />
            <Stat
              label="Supplier reliability"
              value={formatPercent(data.learningHub.supplierReliability.average)}
            />
            <Stat
              label="Evals pending / graded"
              value={`${data.learningHub.evals.pending} / ${data.learningHub.evals.graded}`}
            />
          </div>
          <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Stat
              label="Shipping quality"
              value={formatPercent(data.learningHub.shippingQuality.passRate)}
            />
            <Stat
              label="Stock quality"
              value={formatPercent(data.learningHub.stockQuality.passRate)}
            />
            <Stat
              label="Top supplier"
              value={data.learningHub.supplierReliability.topSupplier ?? "n/a"}
            />
            <Stat
              label="Top parser"
              value={data.learningHub.parserPerformance[0]?.parserVersion ?? "n/a"}
            />
          </div>
          {data.learningHub.failureSignatures.length ? (
            <div className="mt-3 rounded-2xl border border-white/10 bg-white/[0.03] p-3">
              <div className="text-[11px] uppercase tracking-[0.18em] text-white/45">Top failure signatures</div>
              <div className="mt-2 space-y-1 text-sm text-white/75">
                {data.learningHub.failureSignatures.slice(0, compact ? 2 : 4).map((row) => (
                  <div key={row.reason}>
                    {row.reason}: {row.count}
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="mt-4 grid gap-4 xl:grid-cols-[1.3fr_0.9fr]">
        <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
          <div className="mb-3 text-[11px] uppercase tracking-[0.18em] text-white/45">AI-assisted operator brief</div>
          <div className="space-y-3">
            {data.recommendations.map((item) => (
              <div key={item.title} className={`rounded-2xl border p-3 ${severityTone(item.severity)}`}>
                <div className="text-sm font-semibold">{item.title}</div>
                <div className="mt-1 text-sm leading-6 text-white/85">{item.detail}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
          <div className="mb-3 text-[11px] uppercase tracking-[0.18em] text-white/45">Current autonomous state</div>
          <div className="space-y-2 text-sm text-white/75">
            <div>eBay creds: {data.runtime.hasEbayClientId && data.runtime.hasEbayClientSecret ? "present" : "missing"}</div>
            <div>Latest phase: {latestRun?.phase ?? "unknown"}</div>
            <div>Latest run result: {latestRun?.ok == null ? "unknown" : latestRun.ok ? "ok" : "failed"}</div>
            <div>Human work: {data.health.manualWorkLabel}</div>
          </div>
          <div className="mt-4 space-y-2">
            {data.pauses.length ? (
              data.pauses.map((pause) => (
                <div key={`${pause.stage}-${pause.reason}`} className="rounded-xl border border-rose-300/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-100">
                  {pause.stage}: {pause.reason}
                </div>
              ))
            ) : (
              <div className="rounded-xl border border-emerald-300/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-100">
                No current pause reasons.
              </div>
            )}
          </div>
          {data.runtime.sensitiveFilePolicy ? (
            <div className="mt-4 rounded-xl border border-white/10 bg-white/[0.03] p-3 text-sm text-white/75">
              <div>Canonical files: {data.runtime.sensitiveFilePolicy.canonical.filter((file) => file.present).map((file) => file.file).join(", ") || "none detected"}</div>
              <div className="mt-1">Compatibility files: {data.runtime.sensitiveFilePolicy.compatibility.filter((file) => file.present).map((file) => file.file).join(", ") || "none detected"}</div>
              <div className="mt-1">Should remove from normal working exports: {data.runtime.sensitiveFilePolicy.shouldNotBePresent.filter((file) => file.present).map((file) => file.file).join(", ") || "none detected"}</div>
            </div>
          ) : null}
        </div>
      </div>

      {!compact ? (
        <div className="mt-4 grid gap-4 xl:grid-cols-[1fr_1fr]">
          <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
            <div className="mb-3 text-[11px] uppercase tracking-[0.18em] text-white/45">Auto-heal coverage</div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Stat
                label="Detached previews archived"
                value={data.latestIntegrityHeal?.detachedPreviewsArchived ?? 0}
              />
              <Stat
                label="Orphan active paused"
                value={data.latestIntegrityHeal?.orphanActivePaused ?? 0}
              />
              <Stat
                label="Orphan ready fail-closed"
                value={data.latestIntegrityHeal?.orphanReadyToPublishClosed ?? 0}
              />
              <Stat
                label="Broken lineage contained"
                value={data.latestIntegrityHeal?.brokenLineageContained ?? 0}
              />
            </div>
          </div>

          <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
            <div className="mb-3 text-[11px] uppercase tracking-[0.18em] text-white/45">Anomaly groups</div>
            <div className="space-y-3">
              {data.anomalyGroups.length ? (
                data.anomalyGroups.map((group) => (
                  <div key={group.key} className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
                    <div className="flex items-center justify-between gap-3">
                      <div className="text-sm font-semibold text-white">{group.label}</div>
                      <div className="text-sm text-white/70">{group.count}</div>
                    </div>
                    <div className="mt-1 text-sm text-white/65">{group.detail}</div>
                  </div>
                ))
              ) : (
                <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3 text-sm text-white/65">
                  No anomaly groups are active right now.
                </div>
              )}
            </div>
          </div>
        </div>
      ) : null}

      {!compact ? (
        <div className="mt-4 rounded-2xl border border-white/10 bg-black/20 p-4">
          <div className="mb-3 text-[11px] uppercase tracking-[0.18em] text-white/45">Supplier reliability</div>
          <div className="grid gap-3 lg:grid-cols-2 xl:grid-cols-4">
            {topSuppliers.map((supplier) => (
              <div key={supplier.supplierKey} className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
                <div className="text-sm font-semibold text-white">{supplier.supplierKey}</div>
                <div className="mt-2 text-xs text-white/65">
                  refresh success {formatPercent(supplier.refreshSuccessRate)}
                </div>
                <div className="mt-1 text-xs text-white/65">
                  exact matches {supplier.exactMatches}/{supplier.refreshAttempts}
                </div>
                <div className="mt-1 text-xs text-white/65">
                  shipping blocked {supplier.shippingBlocked}/{supplier.candidates}
                </div>
                <div className="mt-1 text-xs text-white/65">
                  429 / exact-miss pressure {supplier.rateLimitEvents + supplier.exactMatchMisses}
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {!compact ? (
        <div className="mt-4 grid gap-4 xl:grid-cols-[0.9fr_1.1fr]">
          <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
            <div className="mb-3 text-[11px] uppercase tracking-[0.18em] text-white/45">Candidate universe scorecard</div>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <Stat label="Shipping known" value={formatPercent(data.summary.candidateUniverse.shippingKnownRatio)} />
              <Stat label="Stock known" value={formatPercent(data.summary.candidateUniverse.stockKnownRatio)} />
              <Stat label="Publishable" value={formatPercent(data.summary.candidateUniverse.publishableRatio)} />
              <Stat label="Manual review" value={formatPercent(data.summary.candidateUniverse.manualReviewRatio)} />
              <Stat label="Stale blocked" value={formatPercent(data.summary.candidateUniverse.staleRatio)} />
              <Stat label="Blocked by shipping" value={formatPercent(data.summary.candidateUniverse.blockedByShippingRatio)} />
              <Stat label="Blocked by profit" value={formatPercent(data.summary.candidateUniverse.blockedByProfitRatio)} />
              <Stat label="Blocked by linkage" value={formatPercent(data.summary.candidateUniverse.blockedByLinkageRatio)} />
            </div>
          </div>

          <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
            <div className="mb-3 text-[11px] uppercase tracking-[0.18em] text-white/45">Supplier mix</div>
            <div className="space-y-3">
              {candidateMix.map((supplier) => (
                <div key={supplier.supplierKey} className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-sm font-semibold text-white">{supplier.supplierKey}</div>
                    <div className="text-xs text-white/65">{formatPercent(supplier.shareOfPool)} of pool</div>
                  </div>
                  <div className="mt-2 grid gap-2 text-xs text-white/65 sm:grid-cols-3">
                    <div>candidates {supplier.totalCandidates}</div>
                    <div>publishable {supplier.publishable}</div>
                    <div>manual review {supplier.manualReview}</div>
                    <div>shipping blocked {supplier.shippingBlocked}</div>
                    <div>stock blocked {supplier.stockBlocked}</div>
                    <div>stale blocked {supplier.staleBlocked}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : null}

      {latestRun?.stages?.length ? (
        <div className="mt-4 rounded-2xl border border-white/10 bg-black/20 p-4">
          <div className="mb-3 text-[11px] uppercase tracking-[0.18em] text-white/45">Latest autonomous stages</div>
          <div className="grid gap-2 lg:grid-cols-2 xl:grid-cols-3">
            {latestRun.stages.map((stage) => (
              <div key={stage.key} className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="text-sm font-semibold text-white">{stage.key}</div>
                  <div
                    className={`rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] ${
                      stage.status === "completed"
                        ? toneClass("healthy")
                        : stage.status === "paused"
                          ? toneClass("watch")
                          : stage.status === "failed"
                            ? toneClass("critical")
                            : "border-white/10 bg-white/[0.05] text-white/70"
                    }`}
                  >
                    {stage.status}
                  </div>
                </div>
                <div className="mt-2 text-xs text-white/60">{stage.reasonCode ?? "OK"}</div>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {!compact ? (
        <div className="mt-4 flex flex-wrap gap-2 text-sm">
          <Link href="/dashboard" className="rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-white/85">
            Dashboard
          </Link>
          <Link href="/admin/control" className="rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-white/85">
            Control
          </Link>
          <Link href="/admin/review" className="rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-white/85">
            Review
          </Link>
          <Link href="/admin/listings" className="rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-white/85">
            Listings
          </Link>
          <Link href="/admin/orders" className="rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-white/85">
            Orders
          </Link>
        </div>
      ) : null}
    </section>
  );
}
