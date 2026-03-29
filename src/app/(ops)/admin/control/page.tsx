import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import RefreshButton from "@/app/_components/RefreshButton";
import { getControlPanelData } from "@/lib/control/getControlPanelData";
import { getControlPlaneOverview } from "@/lib/controlPlane/getControlPlaneOverview";
import { ControlPlaneOverviewPanel } from "@/components/admin/ControlPlaneOverviewPanel";
import { CONTROL_QUICK_ACTIONS, getControlQuickActionBlockedReason } from "@/lib/control/controlQuickActions";
import { LISTINGS_RISK_FILTERS, LISTINGS_ROUTE } from "@/lib/listings/getApprovedListingsQueueData";
import { getManualOverrideSnapshot, setManualOverride, type ManualOverrideKey } from "@/lib/control/manualOverrides";
import {
  getReviewActorIdFromAuthorizationHeader,
  isAuthorizedReviewAuthorizationHeader,
  isReviewConsoleConfigured,
} from "@/lib/review/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata: Metadata = {
  title: "Operational Control Panel",
  robots: { index: false, follow: false },
};

type SearchParams = Record<string, string | string[] | undefined>;

function one(value: string | string[] | undefined): string | null {
  return Array.isArray(value) ? (value[0] ?? null) : (value ?? null);
}

async function requireAdmin(): Promise<string> {
  const auth = (await headers()).get("authorization");
  if (!isReviewConsoleConfigured() || !isAuthorizedReviewAuthorizationHeader(auth)) {
    redirect("/admin/review");
  }
  return getReviewActorIdFromAuthorizationHeader(auth) ?? "admin";
}

function asCell(value: unknown): string {
  if (value == null) return "-";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function DataTable({ rows, empty }: { rows: Array<Record<string, unknown>>; empty: string }) {
  if (!rows.length) {
    return <div className="rounded-xl border border-white/10 bg-black/15 p-3 text-sm text-white/55">{empty}</div>;
  }

  const cols = Array.from(
    rows.reduce((set, row) => {
      Object.keys(row).forEach((k) => set.add(k));
      return set;
    }, new Set<string>())
  );

  return (
    <div className="w-full overflow-x-auto rounded-2xl border border-white/10 bg-black/15">
      <table className="min-w-max w-full border-collapse text-sm text-white/90">
        <thead>
          <tr>
            {cols.map((col) => (
              <th key={col} className="border-b border-white/10 bg-[#121824] px-3 py-2 text-left text-xs uppercase tracking-[0.14em] text-white/60">
                {col}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, idx) => (
            <tr key={idx} className="odd:bg-transparent even:bg-white/[0.02]">
              {cols.map((col) => (
                <td key={col} className="max-w-[340px] break-words border-b border-white/5 px-3 py-2 align-top">
                  {asCell(row[col])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

type SourceHealthCard = {
  source: string;
  status: "healthy" | "partial" | "blocked";
  statusLabel: string;
  reason: string;
  viableSnapshots: number;
  nominatedCandidates: number;
  fetched: number;
  parsed: number;
  freshRows24h: number;
};

const CANONICAL_SOURCES = ["cjdropshipping", "aliexpress", "alibaba", "temu"] as const;

function StatCard({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
      <div className="text-[11px] uppercase tracking-[0.2em] text-white/55">{label}</div>
      <div className="mt-2 text-2xl font-bold">{value}</div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="glass-panel rounded-3xl border border-white/10 p-5">
      <h2 className="mb-3 text-lg font-semibold">{title}</h2>
      {children}
    </section>
  );
}

function metricOrUnknown(value: number | null, wired: boolean): React.ReactNode {
  if (!wired) return "not wired yet";
  return value ?? "-";
}

function percentOrUnknown(value: number | null, wired: boolean): React.ReactNode {
  if (!wired) return "not wired yet";
  if (value == null) return "unknown";
  return `${value.toFixed(2)}%`;
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

function yesNoUnknown(value: boolean | null): string {
  if (value == null) return "Unknown";
  return value ? "Yes" : "No";
}

function toNum(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function canonicalSourceKey(value: unknown): string {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (normalized === "cj dropshipping") return "cjdropshipping";
  return normalized;
}

function describeSourceIssue(input: {
  topReasons: string[];
  challengePages: number;
  fallbackRows: number;
  rejectedMissingFields: number;
  freshRows24h: number;
}): string {
  if (input.challengePages > 0) return "451 / block-page or challenge response detected.";
  if (input.topReasons.includes("missing_title_or_source_url") || input.rejectedMissingFields > 0) {
    return "Missing title/image/source_url is blocking viable snapshots.";
  }
  if (input.topReasons.includes("shipping_or_availability_weak")) {
    return "Quality gate is rejecting weak shipping or availability evidence.";
  }
  if (input.fallbackRows > 0) return "Fallback/challenge HTML is displacing actionable product rows.";
  if (input.freshRows24h === 0) return "No fresh viable data in the last 24 hours.";
  return "Scanned with no actionable parsed rows.";
}

function buildSourceHealthCards(data: Awaited<ReturnType<typeof getControlPanelData>>): SourceHealthCard[] {
  const cycleRows = new Map(
    data.supplierDiscoveryHealth.latestCycleBreakdown.map((row) => [canonicalSourceKey(row.supplier_key), row])
  );
  const telemetryRows = new Map(
    data.supplierDiscoveryHealth.parserTelemetry.map((row) => [canonicalSourceKey(row.supplierKey), row])
  );
  const freshnessRows = new Map(
    data.supplierDiscoveryHealth.freshnessBySupplier.map((row) => [canonicalSourceKey(row.supplier_key), row])
  );
  const contributions = new Map(
    data.supplierDiscoveryHealth.candidateContributionBySupplier.map((row) => [
      canonicalSourceKey(row.supplier_key),
      toNum(row.total_candidates),
    ])
  );

  return CANONICAL_SOURCES.map((source) => {
    const cycleRow = cycleRows.get(source);
    const telemetryRow = telemetryRows.get(source);
    const freshnessRow = freshnessRows.get(source);
    const fetched = toNum(cycleRow?.fetched_count);
    const parsed = Math.max(toNum(cycleRow?.parsed_count), toNum(telemetryRow?.parsed));
    const valid = toNum(cycleRow?.valid_count);
    const eligible = toNum(cycleRow?.eligible_count);
    const viableSnapshots = Math.max(valid, toNum(telemetryRow?.highQuality) + toNum(telemetryRow?.mediumQuality));
    const nominatedCandidates = contributions.get(source) ?? 0;
    const rejectedMissingFields = toNum(cycleRow?.rejected_missing_required_fields_count);
    const challengePages = toNum(telemetryRow?.challenge);
    const fallbackRows = toNum(telemetryRow?.fallback);
    const freshRows24h = toNum(freshnessRow?.rows_24h);
    const topReasons = Array.isArray(cycleRow?.top_rejection_reasons)
      ? cycleRow.top_rejection_reasons.map((value) => String(value)).filter(Boolean)
      : [];

    if (eligible > 0 || nominatedCandidates > 0) {
      return {
        source,
        status: "healthy",
        statusLabel: "Healthy",
        reason:
          nominatedCandidates > 0
            ? "Contributing downstream nominations with real runtime data."
            : "Parsed snapshots are usable downstream.",
        viableSnapshots,
        nominatedCandidates,
        fetched,
        parsed,
        freshRows24h,
      };
    }

    if (parsed > 0 || valid > 0 || freshRows24h > 0) {
      return {
        source,
        status: "partial",
        statusLabel: "Partial",
        reason: describeSourceIssue({
          topReasons,
          challengePages,
          fallbackRows,
          rejectedMissingFields,
          freshRows24h,
        }),
        viableSnapshots,
        nominatedCandidates,
        fetched,
        parsed,
        freshRows24h,
      };
    }

    return {
      source,
      status: "blocked",
      statusLabel: "Blocked",
      reason: describeSourceIssue({
        topReasons,
        challengePages,
        fallbackRows,
        rejectedMissingFields,
        freshRows24h,
      }),
      viableSnapshots,
      nominatedCandidates,
      fetched,
      parsed,
      freshRows24h,
    };
  });
}

function buildListingsRiskHref(riskFilter: string): string {
  const params = new URLSearchParams();
  params.set("riskFilter", riskFilter);
  return `${LISTINGS_ROUTE}?${params.toString()}`;
}

function getQuickActionState(
  action: string,
  snapshot: Awaited<ReturnType<typeof getManualOverrideSnapshot>>,
  data: Awaited<ReturnType<typeof getControlPanelData>>
): { blockedReason: string | null; caution: string | null } {
  const overrideBlocked = getControlQuickActionBlockedReason(action, snapshot);
  if (overrideBlocked) {
    return { blockedReason: overrideBlocked, caution: null };
  }

  const hasSafetyBlocks =
    (data.recoveryStates.staleMarketplaceBlocks ?? 0) > 0 ||
    (data.recoveryStates.supplierDriftBlocks ?? 0) > 0 ||
    (data.recoveryStates.combinedBlocks ?? 0) > 0;
  const hasRecheckNeeded = (data.recoveryStates.reEvaluationNeeded ?? 0) > 0;
  const hasPublishFailures = (data.listingThroughput.publishFailed ?? 0) > 0;
  const dailyCapExhausted =
    data.listingLifecycle.dailyCap.exists &&
    data.listingLifecycle.dailyCap.exhausted;
  const publishRateBlocked = !data.listingLifecycle.publishRateLimit.allowed;

  if (action === "autonomous-full" || action === "autonomous-prepare") {
    if (dailyCapExhausted) {
      return { blockedReason: "Daily publish cap is exhausted. Wait for cap reset before running promotion/publish stages.", caution: null };
    }
    if (publishRateBlocked) {
      return {
        blockedReason: `Publish rate limiter is active (${data.listingLifecycle.publishRateLimit.blockingWindow}).`,
        caution: null,
      };
    }
    if (hasSafetyBlocks || hasRecheckNeeded) {
      return {
        blockedReason: "Safety blocks are active. Re-check and recover affected listings in /admin/listings first.",
        caution: null,
      };
    }
    if (hasPublishFailures) {
      return {
        blockedReason: "Recent publish failures need review before allowing autonomous listing progression.",
        caution: null,
      };
    }
  }

  if ((action === "autonomous-refresh" || action === "autonomous-prepare") && (hasSafetyBlocks || hasRecheckNeeded)) {
    return {
      blockedReason: null,
      caution: "Safety blocks exist. Use the autonomous pass for diagnostics/recovery, then review blocked rows in /admin/listings.",
    };
  }

  if (action === "autonomous-full" && hasPublishFailures) {
    return {
      blockedReason: null,
      caution: "Publish failures exist. Review failure reasons after the autonomous run completes.",
    };
  }

  return { blockedReason: null, caution: null };
}

async function runOverrideAction(formData: FormData) {
  "use server";

  const actorId = await requireAdmin();
  const key = String(formData.get("controlKey") ?? "").trim() as ManualOverrideKey;
  const enabled = String(formData.get("enabled") ?? "false") === "true";
  const note = String(formData.get("note") ?? "").trim();

  try {
    await setManualOverride({ key, enabled, note: note || null, actorId });
    redirect(`/admin/control?actionMessage=${encodeURIComponent(`${key} set to ${enabled ? "ON" : "OFF"}.`)}`);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    redirect(`/admin/control?actionError=${encodeURIComponent(msg)}`);
  }
}

export default async function ControlPage({ searchParams }: { searchParams?: Promise<SearchParams> }) {
  await requireAdmin();
  const resolvedSearchParams = await searchParams;
  let data: Awaited<ReturnType<typeof getControlPanelData>> | null = null;
  let controlPlane: Awaited<ReturnType<typeof getControlPlaneOverview>> | null = null;

  try {
    [data, controlPlane] = await Promise.all([getControlPanelData(), getControlPlaneOverview()]);
  } catch {}

  if (!data) {
    return (
      <main className="relative min-h-screen bg-app text-white">
        <div className="relative mx-auto grid max-w-[900px] gap-5 px-4 py-6 sm:px-6 lg:px-8">
          <header className="glass-card rounded-3xl border border-rose-300/30 bg-rose-400/10 px-5 py-4 sm:px-6">
            <h1 className="m-0 text-2xl font-bold text-rose-100">Control panel temporarily unavailable</h1>
            <p className="mt-2 text-sm text-rose-100/90">
              We couldn&apos;t load control panel data right now. Please retry in a minute.
            </p>
            <p className="mt-2 text-xs text-rose-100/70">
              If the issue persists, check runtime diagnostics and server logs.
            </p>
          </header>
        </div>
      </main>
    );
  }

  const message = one(resolvedSearchParams?.actionMessage);
  const actionError = one(resolvedSearchParams?.actionError);
  const hasCriticalRecoveryBlock =
    (data.recoveryStates.staleMarketplaceBlocks ?? 0) > 0 ||
    (data.recoveryStates.supplierDriftBlocks ?? 0) > 0 ||
    (data.recoveryStates.supplierAvailabilityManualReview ?? 0) > 0 ||
    (data.recoveryStates.supplierAvailabilityBlocks ?? 0) > 0 ||
    (data.recoveryStates.combinedBlocks ?? 0) > 0 ||
    (data.recoveryStates.reEvaluationNeeded ?? 0) > 0;
  const hasCriticalPurchaseSafety =
    (data.purchaseSafety.notCheckedYet ?? 0) > 0 ||
    (data.purchaseSafety.checkedManualReview ?? 0) > 0 ||
    (data.purchaseSafety.blockedStaleSupplierData ?? 0) > 0 ||
    (data.purchaseSafety.blockedSupplierDrift ?? 0) > 0 ||
    (data.purchaseSafety.blockedEconomics ?? 0) > 0;

  const quickActions = CONTROL_QUICK_ACTIONS;

  const nextSteps: string[] = [];
  if ((data.inventoryRisk.autoPausedListings ?? 0) > 0) {
    nextSteps.push("High-risk listings were auto-paused. Review them in Listings.");
  }
  if ((data.publishPerformance.blockedListings ?? 0) > 0) {
    nextSteps.push(`${data.publishPerformance.blockedListings} listings are blocked. Review in /admin/listings.`);
  }
  if ((data.recoveryStates.supplierDriftBlocks ?? 0) > 0) {
    nextSteps.push("Supplier data changed. Re-check listings before publishing.");
  }
  if ((data.listingThroughput.recentPublishFailures24h ?? 0) > 0) {
    nextSteps.push(`${data.listingThroughput.recentPublishFailures24h} publish failures in 24h. Review /admin/review.`);
  }
  if ((data.orderOperations.purchaseSafetyPending ?? 0) > 0) {
    nextSteps.push("Orders need purchase checks in /admin/orders.");
  }
  if ((data.matchQuality.lowConfidenceAcceptedMatches ?? 0) > 0) {
    nextSteps.push("Low-confidence active matches need review before changing matcher thresholds.");
  }
  if ((data.matchQuality.duplicatePairCount ?? 0) > 0) {
    nextSteps.push("Duplicate match pairs detected. Review match diagnostics in /admin/control.");
  }
  const parserTotals = data.supplierDiscoveryHealth.parserTelemetry.reduce(
    (acc, row) => {
      acc.parsed += row.parsed ?? 0;
      acc.fallback += row.fallback ?? 0;
      acc.challenge += row.challenge ?? 0;
      acc.lowQuality += row.lowQuality ?? 0;
      acc.highQuality += row.highQuality ?? 0;
      acc.mediumQuality += row.mediumQuality ?? 0;
      acc.stubQuality += row.stubQuality ?? 0;
      return acc;
    },
    { parsed: 0, fallback: 0, challenge: 0, lowQuality: 0, highQuality: 0, mediumQuality: 0, stubQuality: 0 }
  );
  const quickActionGuidance = [
    {
      title: "Run the canonical orchestrator first",
      description: "Use autonomous refresh, prepare, or full-cycle actions before falling back to lower-level maintenance work.",
    },
    {
      title: "Use the exception consoles after automation",
      description: "Review, Listings, and Orders are for exceptions and operator decisions after the backbone has refreshed and healed state.",
    },
    {
      title: "Manual actions stay manual",
      description: "Supplier purchase/payment and exceptional investigations remain the only human tasks.",
    },
  ];
  const sourceHealthCards = buildSourceHealthCards(data);

  return (
    <main className="relative min-h-screen bg-app text-white">
      <div className="relative mx-auto grid max-w-[1600px] gap-5 px-4 py-6 sm:px-6 lg:px-8">
        <header className="glass-card rounded-3xl border border-white/10 px-5 py-4 sm:px-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h1 className="m-0 text-3xl font-bold">Operational Control Panel</h1>
              <p className="mt-2 text-sm text-white/65">
                Official v1 operations console. Use this for health, alerts, and safe operational actions; use <code>/admin/review</code> for approval decisions.
              </p>
              <p className="mt-2 text-xs text-white/45">Generated at: {data.generatedAt}</p>
            </div>
            <RefreshButton />
          </div>

          {message ? (
            <div className="mt-3 rounded-xl border border-cyan-300/30 bg-cyan-500/10 p-3 text-sm">{message}</div>
          ) : null}
          {actionError ? (
            <div className="mt-3 rounded-xl border border-rose-300/30 bg-rose-500/10 p-3 text-sm text-rose-100">{actionError}</div>
          ) : null}
        </header>

        {controlPlane ? <ControlPlaneOverviewPanel data={controlPlane} /> : null}

        {controlPlane ? (
          <Section title="Control-Plane Route Map">
            <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3 text-sm text-white/70">
              Dashboard and admin pages now share one autonomous backbone truth source for runtime, pauses, integrity, shipping blocks, and remaining human work.
            </div>
            <div className="mt-4">
              <DataTable
                rows={controlPlane.routeMap.map((route) => ({
                  route: route.route,
                  loader: route.loader,
                  focus: route.primaryFocus,
                }))}
                empty="No route map available."
              />
            </div>
          </Section>
        ) : null}

        <Section title="What To Do Next">
          {nextSteps.length ? (
            <div className="space-y-2 rounded-xl border border-amber-300/30 bg-amber-500/10 p-3 text-sm text-amber-100">
              {nextSteps.slice(0, 4).map((step) => (
                <div key={step}>- {step}</div>
              ))}
            </div>
          ) : (
            <div className="rounded-xl border border-white/10 bg-white/[0.04] p-3 text-sm text-white/75">
              No urgent operator actions right now.
            </div>
          )}
          <div className="mt-3 flex flex-wrap gap-2">
            <Link href="/admin/listings" className="inline-block rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-sm">Open /admin/listings</Link>
            <Link href="/admin/review" className="inline-block rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-sm">Open /admin/review</Link>
            <Link href="/admin/orders" className="inline-block rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-sm">Open /admin/orders</Link>
          </div>
        </Section>

        <Section title="Supplier Discovery Health">
          <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3 text-xs text-white/75">
            Parser telemetry helps confirm whether supplier discovery is returning usable rows or falling back to sparse data.
          </div>
          <div className="mt-4 grid gap-3 lg:grid-cols-4">
            {sourceHealthCards.map((card) => (
              <div key={card.source} className="rounded-2xl border border-white/10 bg-black/20 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-[11px] uppercase tracking-[0.18em] text-white/45">{card.source}</div>
                    <div className="mt-2 text-xl font-semibold text-white">{card.statusLabel}</div>
                  </div>
                  <span
                    className={
                      card.status === "healthy"
                        ? "rounded-full border border-emerald-300/30 bg-emerald-500/10 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-emerald-100"
                        : card.status === "partial"
                          ? "rounded-full border border-amber-300/30 bg-amber-500/10 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-amber-100"
                          : "rounded-full border border-rose-300/30 bg-rose-500/10 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-rose-100"
                    }
                  >
                    {card.status}
                  </span>
                </div>
                <div className="mt-3 text-sm leading-6 text-white/70">{card.reason}</div>
                <div className="mt-4 grid grid-cols-3 gap-2 text-sm">
                  <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
                    <div className="text-[10px] uppercase tracking-[0.16em] text-white/40">Fetched</div>
                    <div className="mt-1 font-semibold text-white">{card.fetched}</div>
                  </div>
                  <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
                    <div className="text-[10px] uppercase tracking-[0.16em] text-white/40">Parsed</div>
                    <div className="mt-1 font-semibold text-white">{card.parsed}</div>
                  </div>
                  <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
                    <div className="text-[10px] uppercase tracking-[0.16em] text-white/40">Fresh 24h</div>
                    <div className="mt-1 font-semibold text-white">{card.freshRows24h}</div>
                  </div>
                </div>
                <div className="mt-2 grid grid-cols-2 gap-2 text-sm">
                  <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
                    <div className="text-[10px] uppercase tracking-[0.16em] text-white/40">Viable Snapshots</div>
                    <div className="mt-1 font-semibold text-white">{card.viableSnapshots}</div>
                  </div>
                  <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
                    <div className="text-[10px] uppercase tracking-[0.16em] text-white/40">Nominated</div>
                    <div className="mt-1 font-semibold text-white">{card.nominatedCandidates}</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard
              label="Parsed rows"
              value={data.supplierDiscoveryHealth.telemetryWired ? parserTotals.parsed : "not wired yet"}
            />
            <StatCard
              label="Fallback rows"
              value={data.supplierDiscoveryHealth.telemetryWired ? parserTotals.fallback : "not wired yet"}
            />
            <StatCard
              label="Challenge pages"
              value={data.supplierDiscoveryHealth.telemetryWired ? parserTotals.challenge : "not wired yet"}
            />
            <StatCard
              label="Low-quality rows"
              value={data.supplierDiscoveryHealth.telemetryWired ? parserTotals.lowQuality : "not wired yet"}
            />
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard
              label="High quality"
              value={data.supplierDiscoveryHealth.telemetryWired ? parserTotals.highQuality : "not wired yet"}
            />
            <StatCard
              label="Medium quality"
              value={data.supplierDiscoveryHealth.telemetryWired ? parserTotals.mediumQuality : "not wired yet"}
            />
            <StatCard
              label="Low quality"
              value={data.supplierDiscoveryHealth.telemetryWired ? parserTotals.lowQuality : "not wired yet"}
            />
            <StatCard
              label="Stub snapshots"
              value={data.supplierDiscoveryHealth.telemetryWired ? parserTotals.stubQuality : "not wired yet"}
            />
          </div>
          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <DataTable rows={data.supplierDiscoveryHealth.bySupplier} empty="No supplier discovery rows yet." />
            <DataTable rows={data.supplierDiscoveryHealth.freshnessBySupplier} empty="No supplier freshness rows yet." />
          </div>
          <div className="mt-4">
            <DataTable
              rows={data.supplierDiscoveryHealth.parserTelemetry.map((row) => ({
                supplier: row.supplierKey,
                parsed: row.parsed ?? "-",
                fallback: row.fallback ?? "-",
                challenge: row.challenge ?? "-",
                low_quality: row.lowQuality ?? "-",
                high_quality: row.highQuality ?? "-",
                medium_quality: row.mediumQuality ?? "-",
                stub: row.stubQuality ?? "-",
              }))}
              empty="No supplier parser telemetry yet."
            />
          </div>
          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <DataTable
              rows={data.supplierDiscoveryHealth.latestCycleBreakdown}
              empty="No supplier discovery source breakdown yet."
            />
            <DataTable
              rows={data.supplierDiscoveryHealth.candidateContributionBySupplier}
              empty="No supplier candidate contribution rows yet."
            />
          </div>
        </Section>

        <Section title="Match Quality">
          <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3 text-xs text-white/75">
            These diagnostics are observability-only for v1. Use them to validate confidence bands, duplicate patterns, and weak evidence before changing matcher behavior.
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <StatCard label="Matches" value={data.matchQuality.totalMatches ?? "-"} />
            <StatCard label="Active matches" value={data.matchQuality.activeMatches ?? "-"} />
            <StatCard label="Inactive matches" value={data.matchQuality.inactiveMatches ?? "-"} />
            <StatCard label="Low confidence" value={data.matchQuality.lowConfidenceCount ?? "-"} />
            <StatCard label="Borderline active" value={data.matchQuality.borderlineAcceptedMatches ?? "-"} />
            <StatCard label="Weak matches" value={data.matchQuality.weakMatchCount ?? "-"} />
          </div>
          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <DataTable
              rows={data.matchQuality.confidenceDistribution.map((row) => ({
                bucket: row.bucket,
                count: row.count,
              }))}
              empty="No match confidence distribution yet."
            />
            <DataTable
              rows={[
                {
                  low_confidence_active: data.matchQuality.lowConfidenceAcceptedMatches ?? "-",
                  duplicate_pairs: data.matchQuality.duplicatePairCount ?? "-",
                  weak_matches: data.matchQuality.weakMatchCount ?? "-",
                  invalid_supplier_keys: data.matchQuality.supplierKeyConsistency.invalidKeyCount ?? "-",
                  noncanonical_supplier_keys: data.matchQuality.supplierKeyConsistency.nonCanonicalKeyCount ?? "-",
                },
              ]}
              empty="No compact match diagnostics yet."
            />
          </div>
          <div className="mt-4 grid gap-4 lg:grid-cols-3">
            <DataTable rows={data.matchQuality.weakMatchReasons} empty="No weak-match reasons found." />
            <DataTable rows={data.matchQuality.duplicatePatterns} empty="No duplicate match patterns found." />
            <DataTable
              rows={data.matchQuality.supplierKeyConsistency.inconsistentGroups}
              empty="Supplier keys are already canonical."
            />
          </div>
        </Section>

        <Section title="Manual Override / Safety Controls">
          {!data.manualOverrides.available ? (
            <div className="mb-3 rounded-xl border border-rose-300/35 bg-rose-500/10 p-3 text-sm text-rose-100">
              Manual override store is unavailable. State-changing actions are blocked for safety.
            </div>
          ) : null}
          {data.manualOverrides.activeCount > 0 ? (
            <div className="mb-3 rounded-xl border border-amber-300/35 bg-amber-500/10 p-3 text-sm text-amber-100">
              Active overrides: {data.manualOverrides.activeCount}. Emergency mode is read-only by design.
            </div>
          ) : null}
          <div className="grid gap-3 md:grid-cols-2">
            {data.manualOverrides.entries.map((entry) => (
              <form key={entry.key} action={runOverrideAction} className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
                <input type="hidden" name="controlKey" value={entry.key} />
                <div className="text-sm font-semibold">{entry.key}</div>
                <div className="mt-2 text-xs text-white/60">State: {entry.enabled ? "ON" : "OFF"}</div>
                <div className="text-xs text-white/60">Last changed: {entry.changedAt ?? "-"}</div>
                <div className="text-xs text-white/60">Last changed by: {entry.changedBy ?? "-"}</div>
                <textarea name="note" className="contact-input mt-3 min-h-[72px]" placeholder="Optional incident note" defaultValue={entry.note ?? ""} />
                <div className="mt-3 flex gap-2">
                  <button name="enabled" value="true" className="rounded-xl border border-amber-300/30 bg-amber-500/10 px-3 py-2 text-xs font-semibold text-amber-100">
                    Turn ON
                  </button>
                  <button name="enabled" value="false" className="rounded-xl border border-emerald-300/30 bg-emerald-500/10 px-3 py-2 text-xs font-semibold text-emerald-100">
                    Turn OFF
                  </button>
                </div>
              </form>
            ))}
          </div>
          <div className="mt-3 space-y-1 text-xs text-white/55">
            {data.manualOverrides.limitations.map((line) => (
              <div key={line}>- {line}</div>
            ))}
          </div>
        </Section>

        <Section title="Publishing Safety (Priority)">
          <div className="rounded-xl border border-rose-300/35 bg-rose-500/10 p-3 text-xs text-rose-100">
            Publishing safety alerts are prioritized above general pipeline metrics.
          </div>
          <div className="mt-3 rounded-xl border border-white/10 bg-white/[0.03] p-3 text-xs text-white/75">
            <div>
              Marketplace snapshot threshold: {data.publishingSafety.marketplaceSnapshotHealth.thresholdHours}h
            </div>
            <div>
              Latest eBay snapshot: {data.publishingSafety.marketplaceSnapshotHealth.latestSnapshotTs ?? "n/a"}
            </div>
            {data.publishingSafety.marketplaceSnapshotHealth.hasPartialData ? (
              <div className="mt-1 text-amber-200">
                Snapshot age visibility is partial (missing marketplace snapshot backing data).
              </div>
            ) : null}
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard label="price guard candidates" value={data.publishingSafety.priceGuardSummary.totalCandidates ?? "-"} />
            <StatCard label="stale candidates" value={data.publishingSafety.staleCandidateCount ?? "-"} />
            <StatCard label="blocked count" value={data.publishingSafety.blockedCount ?? "-"} />
            <StatCard label="manual review count" value={data.publishingSafety.manualReviewCount ?? "-"} />
            <StatCard label="fresh snapshots" value={data.publishingSafety.marketplaceSnapshotHealth.freshSnapshots ?? "-"} />
            <StatCard label="stale snapshots" value={data.publishingSafety.marketplaceSnapshotHealth.staleSnapshots ?? "-"} />
            <StatCard label="rate-limit allowed" value={data.publishingSafety.publishRateLimit.allowed ? "yes" : "no"} />
            <StatCard label="rate-limit window" value={data.publishingSafety.publishRateLimit.blockingWindow} />
            <StatCard
              label="attempts 15m / 1h / 1d"
              value={`${data.publishingSafety.publishRateLimit.counts.attempts15m} / ${data.publishingSafety.publishRateLimit.counts.attempts1h} / ${data.publishingSafety.publishRateLimit.counts.attempts1d}`}
            />
            <StatCard
              label="limits 15m / 1h / 1d"
              value={`${data.publishingSafety.publishRateLimit.limits.limit15m} / ${data.publishingSafety.publishRateLimit.limits.limit1h} / ${data.publishingSafety.publishRateLimit.limits.limit1d}`}
            />
          </div>
        </Section>

        <Section title="Inventory Risk Summary">
          <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3 text-xs text-white/75">
            Inventory risk monitor status for live listings.
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard
              label="Listings scanned for risk"
              value={metricOrUnknown(data.inventoryRisk.listingsScanned, data.inventoryRisk.sourceWired.listings)}
            />
            <StatCard
              label="Low risk flags"
              value={metricOrUnknown(data.inventoryRisk.lowRiskFlags, data.inventoryRisk.sourceWired.response)}
            />
            <StatCard
              label="Needs manual review"
              value={
                <div>
                  <div>{metricOrUnknown(data.inventoryRisk.manualReviewRisks, data.inventoryRisk.sourceWired.response)}</div>
                  <Link href={buildListingsRiskHref(LISTINGS_RISK_FILTERS.MANUAL_REVIEW)} className="mt-2 inline-block text-xs font-medium text-cyan-100 underline">
                    View listings needing manual review
                  </Link>
                </div>
              }
            />
            <div className="rounded-2xl border border-rose-300/35 bg-rose-500/10 p-4">
              <div className="text-[11px] uppercase tracking-[0.2em] text-rose-100">Auto-paused listings</div>
              <div className="mt-2 text-2xl font-bold text-rose-100">
                {metricOrUnknown(data.inventoryRisk.autoPausedListings, data.inventoryRisk.sourceWired.response)}
              </div>
              <Link href={buildListingsRiskHref(LISTINGS_RISK_FILTERS.AUTO_PAUSED)} className="mt-2 inline-block text-xs font-medium text-rose-100 underline">
                View auto-paused listings
              </Link>
            </div>
          </div>
          <div className="mt-4 rounded-2xl border border-cyan-300/25 bg-cyan-500/10 p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="text-sm font-semibold text-cyan-100">Risk scan schedule</div>
                <div className="mt-1 text-xs text-cyan-50/85">
                  Automatic risk protection checks live listings on a recurring schedule.
                </div>
              </div>
              <div className="rounded-xl border border-cyan-200/30 bg-black/15 px-3 py-1.5 text-xs font-semibold text-cyan-50">
                Protection active: {yesNoUnknown(data.inventoryRisk.schedule.scheduleActive)}
              </div>
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <div className="rounded-xl border border-white/10 bg-black/15 p-3">
                <div className="text-[11px] uppercase tracking-[0.16em] text-white/55">Cadence</div>
                <div className="mt-2 text-sm font-semibold text-white">
                  {data.inventoryRisk.schedule.cadenceLabel}
                </div>
              </div>
              <div className="rounded-xl border border-white/10 bg-black/15 p-3">
                <div className="text-[11px] uppercase tracking-[0.16em] text-white/55">Next automatic run</div>
                <div className="mt-2 text-sm font-semibold text-white">
                  {formatDateTime(data.inventoryRisk.schedule.nextRun)}
                </div>
              </div>
              <div className="rounded-xl border border-white/10 bg-black/15 p-3">
                <div className="text-[11px] uppercase tracking-[0.16em] text-white/55">Schedule active</div>
                <div className="mt-2 text-sm font-semibold text-white">
                  {yesNoUnknown(data.inventoryRisk.schedule.scheduleActive)}
                </div>
              </div>
              <div className="rounded-xl border border-white/10 bg-black/15 p-3">
                <div className="text-[11px] uppercase tracking-[0.16em] text-white/55">Queue status</div>
                <div className="mt-2 text-sm font-semibold text-white">
                  {data.inventoryRisk.schedule.queueSummary}
                </div>
              </div>
            </div>
            <div className="mt-3 rounded-xl border border-white/10 bg-black/15 p-3 text-sm text-white/80">
              You can also run a manual scan from the control actions if needed.
            </div>
          </div>
          <div className="mt-3 rounded-xl border border-amber-300/35 bg-amber-500/10 p-3 text-sm text-amber-100">
            Review paused or risky listings to confirm supplier availability and pricing before resuming publishing.
          </div>
          <div className="mt-3">
            <Link href="/admin/listings" className="inline-block rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-sm">
              Open /admin/listings for risk review
            </Link>
          </div>
        </Section>

        <Section title="Risk Type Breakdown">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <StatCard
              label="Price drift too high"
              value={metricOrUnknown(data.inventoryRisk.riskTypeBreakdown.priceDriftHigh, data.inventoryRisk.sourceWired.response)}
            />
            <StatCard
              label="Supplier out of stock"
              value={
                <div>
                  <div>{metricOrUnknown(data.inventoryRisk.riskTypeBreakdown.supplierOutOfStock, data.inventoryRisk.sourceWired.response)}</div>
                  <Link href={buildListingsRiskHref(LISTINGS_RISK_FILTERS.OUT_OF_STOCK)} className="mt-2 inline-block text-xs font-medium text-cyan-100 underline">
                    View listings where supplier is out of stock
                  </Link>
                </div>
              }
            />
            <StatCard
              label="Supplier data too old"
              value={
                <div>
                  <div>{metricOrUnknown(data.inventoryRisk.riskTypeBreakdown.snapshotTooOld, data.inventoryRisk.sourceWired.response)}</div>
                  <Link href={buildListingsRiskHref(LISTINGS_RISK_FILTERS.STALE_SNAPSHOT)} className="mt-2 inline-block text-xs font-medium text-cyan-100 underline">
                    View listings with old supplier data
                  </Link>
                </div>
              }
            />
            <StatCard
              label="Supplier shipping changed"
              value={
                <div>
                  <div>{metricOrUnknown(data.inventoryRisk.riskTypeBreakdown.supplierShippingChanged, data.inventoryRisk.sourceWired.response)}</div>
                  <Link href={buildListingsRiskHref(LISTINGS_RISK_FILTERS.SHIPPING_CHANGED)} className="mt-2 inline-block text-xs font-medium text-cyan-100 underline">
                    View listings with changed shipping
                  </Link>
                </div>
              }
            />
            <StatCard
              label="Supplier listing removed"
              value={metricOrUnknown(data.inventoryRisk.riskTypeBreakdown.listingRemoved, data.inventoryRisk.sourceWired.response)}
            />
          </div>
        </Section>

        {hasCriticalRecoveryBlock ? (
          <Section title="Recovery / Safety Summary">
            <div className="rounded-xl border border-rose-300/35 bg-rose-500/10 p-3 text-xs text-rose-100">
              Publishability is currently blocked for one or more listings.
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <StatCard
                label="Market data too old (STALE_MARKETPLACE_BLOCK)"
                value={metricOrUnknown(
                  data.recoveryStates.staleMarketplaceBlocks,
                  data.recoveryStates.sourceWired.staleMarketplaceBlocks
                )}
              />
              <StatCard
                label="Supplier product changed (SUPPLIER_DRIFT_BLOCK)"
                value={metricOrUnknown(
                  data.recoveryStates.supplierDriftBlocks,
                  data.recoveryStates.sourceWired.supplierDriftBlocks
                )}
              />
              <StatCard
                label="Supplier availability review"
                value={metricOrUnknown(
                  data.recoveryStates.supplierAvailabilityManualReview,
                  data.recoveryStates.sourceWired.supplierAvailabilityManualReview
                )}
              />
              <StatCard
                label="Supplier availability blocked"
                value={metricOrUnknown(
                  data.recoveryStates.supplierAvailabilityBlocks,
                  data.recoveryStates.sourceWired.supplierAvailabilityBlocks
                )}
              />
              <StatCard
                label="Blocked for safety (COMBINED_BLOCKS)"
                value={metricOrUnknown(
                  data.recoveryStates.combinedBlocks,
                  data.recoveryStates.sourceWired.combinedBlocks
                )}
              />
              <StatCard
                label="Needs re-check (RE_EVALUATION_NEEDED)"
                value={metricOrUnknown(
                  data.recoveryStates.reEvaluationNeeded,
                  data.recoveryStates.sourceWired.reEvaluationNeeded
                )}
              />
              <StatCard
                label="Ready for re-promotion (REPROMOTION_READY)"
                value={metricOrUnknown(
                  data.recoveryStates.rePromotionReady,
                  data.recoveryStates.sourceWired.rePromotionReady
                )}
              />
            </div>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <StatCard
                label="Waiting for refresh: market (MARKETPLACE_REFRESH_PENDING)"
                value={metricOrUnknown(
                  data.recoveryStates.marketplaceRefreshPending,
                  data.recoveryStates.sourceWired.marketplaceRefreshPending
                )}
              />
              <StatCard
                label="Waiting for refresh: supplier (SUPPLIER_REFRESH_PENDING)"
                value={metricOrUnknown(
                  data.recoveryStates.supplierRefreshPending,
                  data.recoveryStates.sourceWired.supplierRefreshPending
                )}
              />
            </div>
            <div className="mt-4 grid gap-3 lg:grid-cols-2">
              {data.recoveryStates.actionHints.length ? (
                data.recoveryStates.actionHints.map((hint) => (
                  <div
                    key={hint.id}
                    className={`rounded-xl border p-3 text-sm ${
                      hint.severity === "critical"
                        ? "border-amber-300/35 bg-amber-500/10 text-amber-100"
                        : "border-white/10 bg-white/[0.04] text-white/85"
                    }`}
                  >
                    <div className="font-semibold">{hint.label}</div>
                    <div className="text-[11px] uppercase tracking-[0.14em] text-white/55">{hint.technicalLabel}</div>
                    <div className="mt-1">{hint.hint}</div>
                  </div>
                ))
              ) : (
                <div className="rounded-xl border border-white/10 bg-white/[0.04] p-3 text-sm text-white/75">
                  No stale/drift recovery actions are currently pending.
                </div>
              )}
            </div>
            <div className="mt-3">
              <Link href="/admin/listings" className="inline-block rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-sm">
                Open /admin/listings for recovery actions
              </Link>
              <Link href="/admin/review" className="ml-2 inline-block rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-sm">
                Open /admin/review for supplier safety review
              </Link>
            </div>
          </Section>
        ) : null}

        <Section title="Publish Operations">
          <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3 text-xs text-white/75">
            Compact publish KPI view from listing lifecycle truth.
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard
              label="Active listings"
              value={metricOrUnknown(data.publishPerformance.activeListings, data.publishPerformance.sourceWired.listings)}
            />
            <StatCard
              label="Published today"
              value={metricOrUnknown(data.publishPerformance.publishedToday, data.publishPerformance.sourceWired.listings)}
            />
            <StatCard
              label="Success rate"
              value={percentOrUnknown(data.publishPerformance.publishSuccessRatePct, data.publishPerformance.sourceWired.successRate)}
            />
            <StatCard
              label="Blocked listings"
              value={metricOrUnknown(data.publishPerformance.blockedListings, data.publishPerformance.sourceWired.blockedListings)}
            />
          </div>
          <div className="mt-3 text-xs text-white/65">
            Some listings are blocked? Review them in <Link href="/admin/listings" className="underline">/admin/listings</Link>.
          </div>
          <div className="mt-4">
            <DataTable
              rows={data.publishPerformance.publishFailureReasons.map((row) => ({
                reason: row.reason,
                count: row.count,
                technical_detail: row.technicalDetail ?? "-",
              }))}
              empty="No publish failures by reason."
            />
          </div>
        </Section>

        {hasCriticalPurchaseSafety ? (
          <Section title="Order Operations (Compact)">
            <div className="rounded-xl border border-rose-300/35 bg-rose-500/10 p-3 text-xs text-rose-100">
              Some orders are blocked or waiting for purchase safety checks.
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <StatCard
                label="Orders total"
                value={metricOrUnknown(data.orderOperations.totalOrders, data.orderOperations.sourceWired.orders)}
              />
              <StatCard
                label="Purchase safety pending"
                value={metricOrUnknown(data.orderOperations.purchaseSafetyPending, data.orderOperations.sourceWired.purchaseSafety)}
              />
              <StatCard
                label="Tracking waiting"
                value={metricOrUnknown(data.orderOperations.trackingPending, data.orderOperations.sourceWired.tracking)}
              />
              <StatCard
                label="Tracking synced"
                value={metricOrUnknown(data.orderOperations.trackingSynced, data.orderOperations.sourceWired.tracking)}
              />
            </div>
            <div className="mt-4 grid gap-3 lg:grid-cols-2">
              {data.purchaseSafety.actionHints.length ? (
                data.purchaseSafety.actionHints.map((hint) => (
                  <div
                    key={hint.id}
                    className={`rounded-xl border p-3 text-sm ${
                      hint.severity === "critical"
                        ? "border-amber-300/35 bg-amber-500/10 text-amber-100"
                        : "border-white/10 bg-white/[0.04] text-white/85"
                    }`}
                  >
                    <div className="font-semibold">{hint.label}</div>
                    <div className="text-[11px] uppercase tracking-[0.14em] text-white/55">{hint.technicalLabel}</div>
                    <div className="mt-1">{hint.hint}</div>
                  </div>
                ))
              ) : (
                <div className="rounded-xl border border-white/10 bg-white/[0.04] p-3 text-sm text-white/75">
                  No purchase safety alerts right now.
                </div>
              )}
            </div>
            <div className="mt-3">
              <Link href="/admin/orders" className="inline-block rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-sm">
                Open /admin/orders for purchase actions
              </Link>
            </div>
          </Section>
        ) : null}

        <Section title="Listing Throughput">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard label="previews" value={data.listingThroughput.previews ?? "-"} />
            <StatCard label="ready_to_publish" value={data.listingThroughput.readyToPublish ?? "-"} />
            <StatCard label="active" value={data.listingThroughput.active ?? "-"} />
            <StatCard label="publish failures (all time)" value={data.listingThroughput.publishFailed ?? "-"} />
            <StatCard label="publish attempts (24h)" value={data.listingThroughput.recentPublishAttempts24h ?? "unknown"} />
            <StatCard label="publish successes (24h)" value={data.listingThroughput.recentPublishSuccesses24h ?? "unknown"} />
            <StatCard label="publish failures (24h)" value={data.listingThroughput.recentPublishFailures24h ?? "unknown"} />
            <StatCard label="seller feedback score" value={data.listingThroughput.sellerFeedbackScore ?? "unknown"} />
            <StatCard label="feedback source" value={data.listingThroughput.sellerFeedbackSource ?? "unknown"} />
            <StatCard label="feedback fetched at" value={formatDateTime(data.listingThroughput.sellerFeedbackFetchedAt)} />
          </div>
        </Section>

        <Section title="Controlled Scale Rollout">
          <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3 text-xs text-white/75">
            Operational scaling limits and KPI snapshot. These controls are observability/guardrail only and do not bypass existing BLOCK protections.
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard label="prepare cap / run" value={data.rolloutLimits.listingPreparePerRun} />
            <StatCard label="promote cap / run" value={data.rolloutLimits.listingPromotePerRun} />
            <StatCard
              label="publish attempts 1h / 1d"
              value={`${data.rolloutLimits.livePublishAttempts.used1h}/${data.rolloutLimits.livePublishAttempts.limit1h} · ${data.rolloutLimits.livePublishAttempts.used1d}/${data.rolloutLimits.livePublishAttempts.limit1d}`}
            />
            <StatCard
              label="auto-purchase attempts 1h / 1d"
              value={`${data.rolloutLimits.autoPurchaseAttempts.used1h}/${data.rolloutLimits.autoPurchaseAttempts.limit1h} · ${data.rolloutLimits.autoPurchaseAttempts.used1d}/${data.rolloutLimits.autoPurchaseAttempts.limit1d}`}
            />
            <StatCard label="auto-purchase allowed" value={data.rolloutLimits.autoPurchaseAttempts.allowed ? "yes" : "no"} />
            <StatCard label="preview count" value={data.scaleKpis.previewCount ?? "-"} />
            <StatCard label="ready count" value={data.scaleKpis.readyCount ?? "-"} />
            <StatCard label="active listings" value={data.scaleKpis.activeListings ?? "-"} />
            <StatCard label="publish success 24h" value={data.scaleKpis.publishSuccessCount24h ?? "-"} />
            <StatCard label="publish failure 24h" value={data.scaleKpis.publishFailureCount24h ?? "-"} />
            <StatCard label="stock-block rate 24h" value={percentOrUnknown(data.scaleKpis.stockBlockRatePct24h, true)} />
            <StatCard label="profit-block rate" value={percentOrUnknown(data.scaleKpis.profitBlockRatePct24h, true)} />
            <StatCard label="supplier fallback blocks 24h" value={data.scaleKpis.supplierFallbackBlockCount24h ?? "-"} />
            <StatCard label="supplier fetch failures 24h" value={data.scaleKpis.supplierFetchFailureCount24h ?? "-"} />
            <StatCard label="listing pauses 24h" value={data.scaleKpis.listingPauseCount24h ?? "-"} />
            <StatCard label="repeat buyers" value={data.scaleKpis.customerRepeatBuyerCount ?? "-"} />
          </div>
          <div className="mt-4 grid gap-3 lg:grid-cols-2">
            <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3 text-sm text-white/80">
              <div className="text-[11px] uppercase tracking-[0.2em] text-white/55">conversion quality</div>
              <div className="mt-2">{data.operatorSummary.conversionQuality}</div>
              <div className="mt-2 text-[11px] uppercase tracking-[0.2em] text-white/55">economic quality</div>
              <div className="mt-2">{data.operatorSummary.economicQuality}</div>
            </div>
            <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3 text-sm text-white/80">
              <div className="text-[11px] uppercase tracking-[0.2em] text-white/55">supplier reliability</div>
              <div className="mt-2">{data.operatorSummary.supplierReliability}</div>
              <div className="mt-2 text-[11px] uppercase tracking-[0.2em] text-white/55">repeat-customer growth</div>
              <div className="mt-2">{data.operatorSummary.repeatCustomerGrowth}</div>
            </div>
          </div>
          <div className="mt-4">
            <DataTable rows={data.scaleKpis.failureReasons} empty="No recent failure reasons." />
          </div>
        </Section>

        <Section title="Listing Performance">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard
              label="zero-view listings"
              value={metricOrUnknown(data.listingPerformance.zeroViewListings, data.listingPerformance.sourceWired.response)}
            />
            <StatCard
              label="low-traffic listings"
              value={metricOrUnknown(data.listingPerformance.lowTrafficListings, data.listingPerformance.sourceWired.response)}
            />
            <StatCard
              label="title optimization needed"
              value={metricOrUnknown(data.listingPerformance.titleOptimizationNeeded, data.listingPerformance.sourceWired.response)}
            />
            <StatCard
              label="item specifics missing"
              value={metricOrUnknown(data.listingPerformance.itemSpecificsMissing, data.listingPerformance.sourceWired.response)}
            />
            <StatCard
              label="promoted rate below suggested"
              value={metricOrUnknown(data.listingPerformance.promotedRateBelowSuggested, data.listingPerformance.sourceWired.response)}
            />
            <StatCard
              label="dead listing recovery actions"
              value={metricOrUnknown(data.listingPerformance.deadListingRecoveryActions, data.listingPerformance.sourceWired.response)}
            />
            <StatCard
              label="commercially weak live"
              value={metricOrUnknown(data.listingPerformance.commerciallyWeakLiveListings, data.listingPerformance.sourceWired.response)}
            />
            <StatCard
              label="first-sale candidates"
              value={data.listingPerformance.firstSaleCandidates.length}
            />
          </div>
          <div className="mt-4">
            <DataTable rows={data.listingPerformance.firstSaleCandidates} empty="No first-sale candidates identified yet." />
          </div>
        </Section>

        <Section title="Worker Health">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard label="upstream schedules configured" value={`${data.workerQueueHealth.configuredStages}`} />
            <StatCard label="worker alive" value={data.workerQueueHealth.workerAlive ? "yes" : "no"} />
            <StatCard label="worker state" value={data.workerQueueHealth.workerState} />
            <StatCard label="pipeline state" value={data.workerQueueHealth.pipelineState} />
            <StatCard label="revenue state" value={data.workerQueueHealth.revenueState} />
            <StatCard label="last successful worker ts" value={data.workerQueueHealth.lastSuccessfulWorkerActivityTs ?? "none"} />
            <StatCard label="stale stages" value={data.workerQueueHealth.staleStages.length} />
            <StatCard label="listing_performance freshness" value={data.workerQueueHealth.listingPerformanceFreshness.state} />
            <StatCard label="namespace mismatch" value={data.workerQueueHealth.queueNamespace.mismatch ? "yes" : "no"} />
            <StatCard label="worker successes (24h)" value={data.workerQueueHealth.recentSuccessCount24h ?? "n/a"} />
            <StatCard label="worker failures (24h)" value={data.workerQueueHealth.recentFailureCount24h ?? "n/a"} />
            <StatCard label="recent activity ts" value={data.workerQueueHealth.recentWorkerActivityTs ?? "none"} />
            <StatCard label="recent job failures" value={data.workerQueueHealth.recentJobFailures.length} />
          </div>
          <div className="mt-4 grid gap-3 lg:grid-cols-3">
            <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3 text-sm text-white/80">
              <div className="text-[11px] uppercase tracking-[0.2em] text-white/55">worker detail</div>
              <div className="mt-2">{data.workerQueueHealth.workerStateDetail}</div>
            </div>
            <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3 text-sm text-white/80">
              <div className="text-[11px] uppercase tracking-[0.2em] text-white/55">pipeline detail</div>
              <div className="mt-2">{data.workerQueueHealth.pipelineStateDetail}</div>
            </div>
            <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3 text-sm text-white/80">
              <div className="text-[11px] uppercase tracking-[0.2em] text-white/55">revenue detail</div>
              <div className="mt-2">{data.workerQueueHealth.revenueStateDetail}</div>
            </div>
          </div>
          <div className="mt-4 grid gap-3 lg:grid-cols-2">
            <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3 text-sm text-white/80">
              <div className="text-[11px] uppercase tracking-[0.2em] text-white/55">listing performance freshness</div>
              <div className="mt-2">{data.workerQueueHealth.listingPerformanceFreshness.detail}</div>
            </div>
            <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3 text-sm text-white/80">
              <div className="text-[11px] uppercase tracking-[0.2em] text-white/55">queue namespace</div>
              <div className="mt-2">
                {data.workerQueueHealth.queueNamespace.environment} / {data.workerQueueHealth.queueNamespace.bullPrefix} / {data.workerQueueHealth.queueNamespace.jobsQueueName}
              </div>
            </div>
          </div>
          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <DataTable rows={data.workerQueueHealth.upstreamSchedules} empty="No upstream schedule rows." />
            <DataTable rows={data.workerQueueHealth.failureClassifications} empty="No classified worker or job failures." />
          </div>
          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <DataTable rows={data.workerQueueHealth.recentWorkerFailures} empty="No recent worker failures." />
            <DataTable rows={data.workerQueueHealth.recentJobFailures} empty="No recent job failures." />
          </div>
        </Section>

        {!hasCriticalRecoveryBlock ? (
          <Section title="Recovery / Safety Summary">
            <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3 text-xs text-white/75">
              Recovery metrics are currently informational and are shown below critical worker failures.
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <StatCard
                label="Market data too old (STALE_MARKETPLACE_BLOCK)"
                value={metricOrUnknown(
                  data.recoveryStates.staleMarketplaceBlocks,
                  data.recoveryStates.sourceWired.staleMarketplaceBlocks
                )}
              />
              <StatCard
                label="Supplier product changed (SUPPLIER_DRIFT_BLOCK)"
                value={metricOrUnknown(
                  data.recoveryStates.supplierDriftBlocks,
                  data.recoveryStates.sourceWired.supplierDriftBlocks
                )}
              />
              <StatCard
                label="Supplier availability review"
                value={metricOrUnknown(
                  data.recoveryStates.supplierAvailabilityManualReview,
                  data.recoveryStates.sourceWired.supplierAvailabilityManualReview
                )}
              />
              <StatCard
                label="Supplier availability blocked"
                value={metricOrUnknown(
                  data.recoveryStates.supplierAvailabilityBlocks,
                  data.recoveryStates.sourceWired.supplierAvailabilityBlocks
                )}
              />
              <StatCard
                label="Blocked for safety (COMBINED_BLOCKS)"
                value={metricOrUnknown(
                  data.recoveryStates.combinedBlocks,
                  data.recoveryStates.sourceWired.combinedBlocks
                )}
              />
              <StatCard
                label="Needs re-check (RE_EVALUATION_NEEDED)"
                value={metricOrUnknown(
                  data.recoveryStates.reEvaluationNeeded,
                  data.recoveryStates.sourceWired.reEvaluationNeeded
                )}
              />
              <StatCard
                label="Ready for re-promotion (REPROMOTION_READY)"
                value={metricOrUnknown(
                  data.recoveryStates.rePromotionReady,
                  data.recoveryStates.sourceWired.rePromotionReady
                )}
              />
            </div>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <StatCard
                label="Waiting for refresh: market (MARKETPLACE_REFRESH_PENDING)"
                value={metricOrUnknown(
                  data.recoveryStates.marketplaceRefreshPending,
                  data.recoveryStates.sourceWired.marketplaceRefreshPending
                )}
              />
              <StatCard
                label="Waiting for refresh: supplier (SUPPLIER_REFRESH_PENDING)"
                value={metricOrUnknown(
                  data.recoveryStates.supplierRefreshPending,
                  data.recoveryStates.sourceWired.supplierRefreshPending
                )}
              />
            </div>
            <div className="mt-4 grid gap-3 lg:grid-cols-2">
              {data.recoveryStates.actionHints.length ? (
                data.recoveryStates.actionHints.map((hint) => (
                  <div
                    key={hint.id}
                    className={`rounded-xl border p-3 text-sm ${
                      hint.severity === "critical"
                        ? "border-amber-300/35 bg-amber-500/10 text-amber-100"
                        : "border-white/10 bg-white/[0.04] text-white/85"
                    }`}
                  >
                    <div className="font-semibold">{hint.label}</div>
                    <div className="text-[11px] uppercase tracking-[0.14em] text-white/55">{hint.technicalLabel}</div>
                    <div className="mt-1">{hint.hint}</div>
                  </div>
                ))
              ) : (
                <div className="rounded-xl border border-white/10 bg-white/[0.04] p-3 text-sm text-white/75">
                  No stale/drift recovery actions are currently pending.
                </div>
              )}
            </div>
            <div className="mt-3">
              <Link href="/admin/listings" className="inline-block rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-sm">
                Open /admin/listings for recovery actions
              </Link>
              <Link href="/admin/review" className="ml-2 inline-block rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-sm">
                Open /admin/review for supplier safety review
              </Link>
            </div>
          </Section>
        ) : null}

        {!hasCriticalPurchaseSafety ? (
          <Section title="Order Operations (Compact)">
            <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3 text-xs text-white/75">
              Purchase safety summary stays compact here; detailed actions remain in /admin/orders.
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <StatCard
                label="Orders total"
                value={metricOrUnknown(data.orderOperations.totalOrders, data.orderOperations.sourceWired.orders)}
              />
              <StatCard
                label="Purchase safety pending"
                value={metricOrUnknown(data.orderOperations.purchaseSafetyPending, data.orderOperations.sourceWired.purchaseSafety)}
              />
              <StatCard
                label="Tracking waiting"
                value={metricOrUnknown(data.orderOperations.trackingPending, data.orderOperations.sourceWired.tracking)}
              />
              <StatCard
                label="Tracking synced"
                value={metricOrUnknown(data.orderOperations.trackingSynced, data.orderOperations.sourceWired.tracking)}
              />
            </div>
            <div className="mt-3">
              <Link href="/admin/orders" className="inline-block rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-sm">
                Open /admin/orders for purchase actions
              </Link>
            </div>
          </Section>
        ) : null}

        <Section title="Alerts">
          <div className="grid gap-4 lg:grid-cols-3">
            <DataTable rows={data.prioritizedAlerts.publishingSafety} empty="No publishing safety alerts." />
            <DataTable rows={data.prioritizedAlerts.operationalFreshness} empty="No operational freshness alerts." />
            <DataTable rows={data.prioritizedAlerts.futureOrders} empty="No future-order alerts." />
          </div>
        </Section>

        <Section title="Future Automation Readiness (Placeholder)">
          <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3 text-xs text-white/75">
            This block is forward-looking only. Use Order Operations (Compact) above for current day-to-day actions.
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard label="total orders" value={data.futureOrders.totalOrders ?? "-"} />
            <StatCard label="purchase review pending" value={data.futureOrders.purchaseReviewPending ?? "-"} />
            <StatCard label="tracking pending" value={data.futureOrders.trackingPending ?? "-"} />
            <StatCard label="tracking synced" value={data.futureOrders.trackingSynced ?? "-"} />
          </div>
          {!data.futureOrders.supported ? (
            <div className="mt-3 rounded-xl border border-amber-300/35 bg-amber-500/10 p-3 text-xs text-amber-100">
              Partial state: {data.futureOrders.partialReason}
            </div>
          ) : null}
        </Section>

        <Section title="Quick Actions">
          <div className="rounded-xl border border-amber-300/30 bg-amber-400/10 p-3 text-xs text-amber-100">
            Listing execution-related actions are eBay-only and preserve review gate constraints.
          </div>
          <div className="mt-3 grid gap-3 lg:grid-cols-3">
            {quickActionGuidance.map((item) => (
              <div key={item.title} className="rounded-xl border border-white/10 bg-white/[0.04] p-3 text-sm text-white/85">
                <div className="font-semibold text-white">{item.title}</div>
                <div className="mt-1 text-xs text-white/60">{item.description}</div>
              </div>
            ))}
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {quickActions.map((item) => {
              const snapshot = {
                available: data.manualOverrides.available,
                activeCount: data.manualOverrides.activeCount,
                emergencyReadOnly: data.manualOverrides.emergencyReadOnly,
                limitations: data.manualOverrides.limitations,
                entries: data.manualOverrides.entries.reduce((acc, entry) => {
                  acc[entry.key as ManualOverrideKey] = {
                    key: entry.key as ManualOverrideKey,
                    enabled: entry.enabled,
                    note: entry.note,
                    changedBy: entry.changedBy,
                    changedAt: entry.changedAt,
                  };
                  return acc;
                }, {} as Awaited<ReturnType<typeof getManualOverrideSnapshot>>["entries"]),
              };
              const state = getQuickActionState(item.key, snapshot, data);
              return (
                <form key={item.key} method="post" action="/api/admin/control/run-action">
                  <input type="hidden" name="actionKey" value={item.key} />
                  <button disabled={Boolean(state.blockedReason)} className="w-full rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-left text-sm disabled:cursor-not-allowed disabled:opacity-50">
                    {item.label}
                    {state.blockedReason ? <div className="mt-1 text-[11px] text-amber-200">{state.blockedReason}</div> : null}
                    {!state.blockedReason && state.caution ? (
                      <div className="mt-1 text-[11px] text-sky-200">{state.caution}</div>
                    ) : null}
                  </button>
                </form>
              );
            })}
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <Link href="/admin/review" className="inline-block rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-sm">Open /admin/review</Link>
            <Link href="/admin/listings" className="inline-block rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-sm">Open /admin/listings</Link>
            <Link href="/admin/orders" className="inline-block rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-sm">Open /admin/orders</Link>
          </div>
        </Section>
      </div>
    </main>
  );
}
