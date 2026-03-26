import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import RefreshButton from "@/app/_components/RefreshButton";
import {
  approveOrderForPurchase,
  buildCompactOrderTimeline,
  getCompactBatchReviewSummary,
  getDisabledRowQuickActionHint,
  getAutoPurchaseDiagnostic,
  buildOperatorOrderStepFlow,
  buildOperatorHints,
  buildProfitSnapshot,
  getOperatorOrderStep,
  getTimelineEventTitle,
  getOrderPurchaseSafetyStatus,
  getAdminOrderDetail,
  getAdminOrdersRows,
  getPurchaseStatusIndicator,
  normalizeAdminOrdersFilter,
  prepareTrackingSyncPayload,
  recordSupplierPurchase,
  recordSupplierTracking,
  repairOrderItemSupplierLinkage,
  reconcileTrackingSync,
  setOrderReadyForPurchaseReview,
  syncTrackingToEbay,
  type AdminOrdersFilter,
  type CompactBatchReviewMode,
} from "@/lib/orders";
import { canRecordSupplierPurchaseForOrderStatus } from "@/lib/orders/statuses";
import {
  getReviewActorIdFromAuthorizationHeader,
  isAuthorizedReviewAuthorizationHeader,
  isReviewConsoleConfigured,
} from "@/lib/review/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata: Metadata = {
  title: "Orders Console",
  robots: { index: false, follow: false },
};

type SearchParams = Record<string, string | string[] | undefined>;
type QuickActionKey =
  | "mark-purchase"
  | "supplier-ref"
  | "tracking"
  | "preview-sync"
  | "sync-ebay"
  | "view-safety";

function one(value: string | string[] | undefined): string | null {
  return Array.isArray(value) ? (value[0] ?? null) : (value ?? null);
}

async function requireAdmin() {
  const auth = (await headers()).get("authorization");
  if (!isReviewConsoleConfigured() || !isAuthorizedReviewAuthorizationHeader(auth)) {
    redirect("/admin/review");
  }
  return getReviewActorIdFromAuthorizationHeader(auth) ?? "admin/orders";
}

function statusLabel(status: string): string {
  const key = String(status || "").toUpperCase();
  if (key === "MANUAL_REVIEW" || key === "NEW" || key === "NEW_ORDER") return "Needs review";
  if (key === "READY_FOR_PURCHASE_REVIEW") return "Ready for purchase review";
  if (key === "PURCHASE_APPROVED") return "Purchase approved";
  if (key === "PURCHASE_PLACED") return "Purchase placed";
  if (key === "TRACKING_PENDING") return "Waiting for tracking";
  if (key === "TRACKING_RECEIVED") return "Ready to sync";
  if (key === "TRACKING_SYNCED") return "Synced to eBay";
  if (key === "FAILED" || key === "CANCELED") return "Needs attention";
  return status;
}

function statusTone(status: string): string {
  const key = String(status || "").toUpperCase();
  if (key === "TRACKING_SYNCED") return "border-emerald-300/30 bg-emerald-500/10 text-emerald-100";
  if (key === "TRACKING_RECEIVED" || key === "PURCHASE_APPROVED")
    return "border-cyan-300/30 bg-cyan-500/10 text-cyan-100";
  if (key === "FAILED" || key === "CANCELED") return "border-rose-300/30 bg-rose-500/10 text-rose-100";
  return "border-white/15 bg-white/[0.05] text-white/90";
}

function formatMoney(value: number | null, currency = "USD"): string {
  if (value == null) return "-";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(value);
}

function formatDateTime(value: string | null | undefined): string {
  if (!value) return "-";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString("en-US", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "UTC",
  });
}

function indicatorTone(indicator: ReturnType<typeof getPurchaseStatusIndicator>): string {
  if (indicator === "TRACKING_SYNCED") return "border-emerald-300/30 bg-emerald-500/10 text-emerald-100";
  if (indicator === "TRACKING_READY") return "border-cyan-300/30 bg-cyan-500/10 text-cyan-100";
  if (indicator === "PURCHASE_RECORDED") return "border-amber-300/30 bg-amber-500/10 text-amber-100";
  return "border-white/15 bg-white/[0.05] text-white/90";
}

function stageTone(state: "completed" | "current" | "upcoming"): string {
  if (state === "completed") return "border-emerald-300/30 bg-emerald-500/10 text-emerald-100";
  if (state === "current") return "border-cyan-300/30 bg-cyan-500/10 text-cyan-100";
  return "border-white/15 bg-white/[0.03] text-white/65";
}

function purchaseSafetyTone(status: string): string {
  if (status === "READY_FOR_PURCHASE_REVIEW") {
    return "border-emerald-300/30 bg-emerald-500/10 text-emerald-100";
  }
  if (
    status === "BLOCKED_SUPPLIER_LINKAGE_REQUIRED" ||
    status === "BLOCKED_STALE_DATA" ||
    status === "BLOCKED_SUPPLIER_DRIFT" ||
    status === "BLOCKED_ECONOMICS_OUT_OF_BOUNDS"
  ) {
    return "border-rose-300/30 bg-rose-500/10 text-rose-100";
  }
  if (status === "MANUAL_REVIEW_REQUIRED") {
    return "border-amber-300/30 bg-amber-500/10 text-amber-100";
  }
  return "border-white/15 bg-white/[0.05] text-white/90";
}

const filters: Array<{ key: AdminOrdersFilter; label: string }> = [
  { key: "all", label: "All" },
  { key: "needs-review", label: "Needs review" },
  { key: "waiting-purchase", label: "Waiting for purchase" },
  { key: "waiting-tracking", label: "Waiting for tracking" },
  { key: "ready-sync", label: "Ready to sync" },
  { key: "blocked-review", label: "Blocked / manual review" },
  { key: "missing-linkage", label: "Missing supplier linkage" },
  { key: "synced", label: "Synced" },
  { key: "needs-attention", label: "Failed / needs attention" },
];

function orderDetailsHref(input: {
  filter: AdminOrdersFilter;
  mode: CompactBatchReviewMode;
  orderId: string;
  quickAction?: QuickActionKey;
  anchor?: string;
}): string {
  const q = new URLSearchParams();
  q.set("filter", input.filter);
  q.set("mode", input.mode);
  q.set("orderId", input.orderId);
  if (input.quickAction) q.set("quickAction", input.quickAction);
  const anchor = input.anchor ? `#${input.anchor}` : "";
  return `/admin/orders?${q.toString()}${anchor}`;
}

function buildOrdersPageHref(input: {
  filter: AdminOrdersFilter;
  mode: CompactBatchReviewMode;
  orderId?: string | null;
}): string {
  const q = new URLSearchParams();
  q.set("filter", input.filter);
  q.set("mode", input.mode);
  if (input.orderId) q.set("orderId", input.orderId);
  return `/admin/orders?${q.toString()}`;
}

function normalizeBatchReviewMode(value: string | null | undefined): CompactBatchReviewMode {
  return value === "compact" ? "compact" : "detailed";
}

function normalizePurchaseStatus(value: string | null | undefined): string {
  const key = String(value ?? "").toUpperCase();
  if (["PENDING", "SUBMITTED", "CONFIRMED", "FAILED", "CANCELED"].includes(key)) return key;
  return "SUBMITTED";
}

function isPostPurchaseStatus(status: string | null | undefined): boolean {
  const key = String(status ?? "").toUpperCase();
  return ["PURCHASE_PLACED", "TRACKING_PENDING", "TRACKING_RECEIVED", "TRACKING_SYNCED", "DELIVERED"].includes(key);
}

function isTrackingFullySynced(status: string | null | undefined): boolean {
  return String(status ?? "").toUpperCase() === "TRACKING_SYNCED";
}

function quickActionButtonTone(enabled: boolean): string {
  if (!enabled) return "pointer-events-none cursor-not-allowed border-white/10 bg-white/[0.02] text-white/35";
  return "border-white/15 bg-white/[0.05] text-white/85 hover:bg-white/[0.08]";
}

const ordersHelpLegend = [
  {
    label: "Needs review",
    description: "Check safety first, then decide whether the order is ready for purchase review.",
  },
  {
    label: "Waiting for purchase",
    description: "Purchase is approved, but the supplier order has not been recorded yet.",
  },
  {
    label: "Waiting for tracking",
    description: "Purchase is recorded. Add tracking before syncing anything to eBay.",
  },
  {
    label: "Ready to sync",
    description: "Tracking is complete and safe to sync per order.",
  },
  {
    label: "Blocked / manual review",
    description: "Open the row details to see the blocker before taking action.",
  },
];

async function runOrderAction(formData: FormData) {
  "use server";

  const actorId = await requireAdmin();
  const orderId = String(formData.get("orderId") ?? "").trim();
  const actionType = String(formData.get("actionType") ?? "").trim();
  const filter = normalizeAdminOrdersFilter(String(formData.get("filter") ?? ""));
  const mode = normalizeBatchReviewMode(String(formData.get("mode") ?? ""));

  if (!orderId) {
    redirect(
      `/admin/orders?filter=${encodeURIComponent(filter)}&mode=${encodeURIComponent(mode)}&error=${encodeURIComponent("Please select an order first.")}`
    );
  }

  const redirectWith = (params: { message?: string; error?: string }) => {
    const q = new URLSearchParams();
    q.set("filter", filter);
    q.set("mode", mode);
    q.set("orderId", orderId);
    if (params.message) q.set("message", params.message);
    if (params.error) q.set("error", params.error);
    redirect(`/admin/orders?${q.toString()}`);
  };

  try {
    if (actionType === "ready-review") {
      await setOrderReadyForPurchaseReview({ orderId, actorId });
      redirectWith({ message: "Order moved to Ready for purchase review." });
    }

    if (actionType === "approve-purchase") {
      await approveOrderForPurchase({ orderId, actorId });
      redirectWith({ message: "Order marked as Purchase approved." });
    }

    if (actionType === "record-purchase") {
      const supplierKey = String(formData.get("supplierKey") ?? "").trim();
      const supplierOrderRef = String(formData.get("supplierOrderRef") ?? "").trim() || null;
      const purchaseStatus = String(formData.get("purchaseStatus") ?? "").trim() || "SUBMITTED";
      const note = String(formData.get("manualNote") ?? "").trim() || null;
      if (!supplierKey) {
        redirectWith({ error: "Please enter supplier before recording purchase." });
      }
      await recordSupplierPurchase({
        orderId,
        supplierKey,
        supplierOrderRef,
        purchaseStatus: purchaseStatus as never,
        manualNote: note,
        actorId,
      });
      redirectWith({ message: "Supplier order was saved." });
    }

    if (actionType === "record-tracking") {
      const supplierKey = String(formData.get("supplierKey") ?? "").trim();
      const trackingNumber = String(formData.get("trackingNumber") ?? "").trim();
      const trackingCarrier = String(formData.get("trackingCarrier") ?? "").trim();
      const trackingStatus = String(formData.get("trackingStatus") ?? "").trim() || "LABEL_CREATED";
      const supplierOrderId = String(formData.get("supplierOrderId") ?? "").trim() || undefined;
      if (!supplierKey) {
        redirectWith({ error: "Please enter supplier before recording tracking." });
      }
      if (!trackingNumber) {
        redirectWith({ error: "Tracking number is required." });
      }
      if (!trackingCarrier) {
        redirectWith({ error: "Tracking carrier is required." });
      }
      await recordSupplierTracking({
        orderId,
        supplierKey,
        trackingNumber,
        trackingCarrier,
        trackingStatus: trackingStatus as never,
        actorId,
        supplierOrderId,
      });
      redirectWith({ message: "Tracking details were saved." });
    }

    if (actionType === "repair-linkage") {
      const orderItemId = String(formData.get("orderItemId") ?? "").trim();
      const supplierKey = String(formData.get("supplierKey") ?? "").trim();
      const supplierProductId = String(formData.get("supplierProductId") ?? "").trim();
      const supplierSourceUrl = String(formData.get("supplierSourceUrl") ?? "").trim() || null;
      const listingId = String(formData.get("listingId") ?? "").trim() || null;
      if (!orderItemId) {
        redirectWith({ error: "Please choose an order item to repair." });
      }
      if (!listingId && (!supplierKey || !supplierProductId)) {
        redirectWith({ error: "Provide an exact listing id or both supplier fields." });
      }
      await repairOrderItemSupplierLinkage({
        orderId,
        orderItemId,
        supplierKey,
        supplierProductId,
        supplierSourceUrl,
        listingId,
        actorId,
      });
      redirectWith({ message: "Supplier linkage was repaired." });
    }

    if (actionType === "sync-ebay") {
      const supplierOrderId = String(formData.get("supplierOrderId") ?? "").trim() || undefined;
      const supplierKey = String(formData.get("supplierKey") ?? "").trim() || undefined;
      const result = await syncTrackingToEbay({ orderId, supplierOrderId, supplierKey, actorId });
      if (!result.ok) {
        redirectWith({
          error: `Could not sync tracking to eBay. ${result.reason ?? "Please check the order and try again."}`,
        });
      }
      redirectWith({ message: "Tracking synced to eBay successfully." });
    }

    if (actionType === "confirm-sync") {
      const supplierOrderId = String(formData.get("supplierOrderId") ?? "").trim();
      const trackingCarrier = String(formData.get("trackingCarrier") ?? "").trim() || undefined;
      if (!supplierOrderId) {
        redirectWith({ error: "Supplier order attempt is required for sync confirmation." });
      }
      await reconcileTrackingSync({
        orderId,
        supplierOrderId,
        trackingCarrier,
        actorId,
      });
      redirectWith({ message: "Tracking sync was confirmed from the live eBay order page." });
    }

    redirectWith({ error: "Unknown action." });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    redirectWith({ error: msg });
  }
}

export default async function AdminOrdersPage({ searchParams }: { searchParams?: Promise<SearchParams> }) {
  await requireAdmin();

  const resolved = await searchParams;
  const filter = normalizeAdminOrdersFilter(one(resolved?.filter));
  const mode = normalizeBatchReviewMode(one(resolved?.mode));
  const message = one(resolved?.message);
  const error = one(resolved?.error);
  const requestedOrderId = one(resolved?.orderId);
  const requestedQuickAction = one(resolved?.quickAction);

  const allRows = await getAdminOrdersRows({ filter: "all", limit: 200 });
  const rows = filter === "all" ? allRows : await getAdminOrdersRows({ filter, limit: 200 });
  const selectedOrderId = requestedOrderId || rows[0]?.orderId || null;
  const detail = selectedOrderId ? await getAdminOrderDetail(selectedOrderId) : null;
  const compactRows = rows.map((row) => ({
    row,
    summary: getCompactBatchReviewSummary(row),
  }));
  const batchCounts = allRows.reduce<Record<AdminOrdersFilter | "synced", number>>(
    (acc, row) => {
      const summary = getCompactBatchReviewSummary(row);
      const bucket = summary.bucket;
      if (bucket === "all") {
        acc.all += 1;
      } else {
        acc[bucket] += 1;
        acc.all += 1;
      }
      if (summary.blockedReason && bucket !== "blocked-review") {
        acc["blocked-review"] += 1;
      }
      return acc;
    },
    {
      all: 0,
      "needs-review": 0,
      "waiting-purchase": 0,
      "waiting-tracking": 0,
      "ready-sync": 0,
      "blocked-review": 0,
      "missing-linkage": 0,
      synced: 0,
      "needs-attention": 0,
    }
  );
  batchCounts["needs-attention"] = allRows.filter((row) => {
    const status = String(row.status || "").toUpperCase();
    return (
      status === "FAILED" ||
      status === "CANCELED" ||
      String(row.purchaseStatus || "").toUpperCase() === "FAILED" ||
      Boolean(row.trackingSyncError)
    );
  }).length;
  const compactCards = [
    {
      filterKey: "needs-review" as const,
      label: "Needs review",
      description: "Open these first when you need a fresh purchase decision.",
    },
    {
      filterKey: "waiting-purchase" as const,
      label: "Waiting for purchase",
      description: "Approved orders that still need supplier purchase recording.",
    },
    {
      filterKey: "waiting-tracking" as const,
      label: "Waiting for tracking",
      description: "Purchase is recorded, but tracking still needs to be added.",
    },
    {
      filterKey: "ready-sync" as const,
      label: "Ready to sync",
      description: "Tracking is ready and can be synced per order.",
    },
    {
      filterKey: "blocked-review" as const,
      label: "Blocked / manual review",
      description: "Orders with safety, sync, or workflow blockers.",
    },
    {
      filterKey: "missing-linkage" as const,
      label: "Missing supplier linkage",
      description: "Line items need supplier linkage before purchase work.",
    },
  ];

  const defaultSupplierKey =
    detail?.latestAttempt?.supplierKey ?? detail?.items.find((item) => item.supplierKey)?.supplierKey ?? "";
  const defaultRepairItem = detail?.items[0] ?? null;
  const detailStatus = String(detail?.order.status ?? "").toUpperCase();
  const canReadyReview =
    detail != null &&
    ["MANUAL_REVIEW", "NEW", "NEW_ORDER"].includes(String(detail.order.status).toUpperCase());
  const canRecordPurchase =
    detail != null &&
    !isTrackingFullySynced(detail.order.status) &&
    canRecordSupplierPurchaseForOrderStatus(String(detail.order.status).toUpperCase());
  const canRecordTracking =
    detail != null &&
    !isTrackingFullySynced(detail.order.status) &&
    ["PURCHASE_PLACED", "TRACKING_PENDING", "TRACKING_RECEIVED"].includes(
      String(detail.order.status).toUpperCase()
    );
  const canSync = Boolean(detail?.readiness.ready) && !isTrackingFullySynced(detail?.order.status);
  const timelineRows = detail ? buildCompactOrderTimeline(detail.events) : [];
  const progressIndicator = detail ? getPurchaseStatusIndicator(detail) : "NOT_PURCHASED";
  const stageLabel = detail ? getOperatorOrderStep(detail) : null;
  const stageFlow = detail ? buildOperatorOrderStepFlow(detail) : [];
  const operatorHints = detail ? buildOperatorHints(detail) : [];
  const profitSnapshot = detail ? buildProfitSnapshot(detail) : null;
  const purchaseSafety = detail ? await getOrderPurchaseSafetyStatus(detail) : null;
  const purchaseSafetyRelevant = detail != null && !isPostPurchaseStatus(detailStatus);
  const canApprove =
    detail != null &&
    String(detail.order.status).toUpperCase() === "READY_FOR_PURCHASE_REVIEW" &&
    purchaseSafety?.status === "READY_FOR_PURCHASE_REVIEW";
  const actionHints = detail
    ? Array.from(
        new Set(
          [
            ...(purchaseSafetyRelevant ? [purchaseSafety?.hint, purchaseSafety?.secondaryHint] : []),
            ...operatorHints,
          ].filter(Boolean) as string[]
        )
      ).slice(0, 2)
    : [];
  const hasSupplierLinkage =
    detail?.items.some((item) => Boolean(item.supplierKey && item.supplierProductId)) ?? false;
  const showTrackingPreview =
    detail != null &&
    !isTrackingFullySynced(detail.order.status) &&
    (detail.readiness.ready ||
      ["TRACKING_RECEIVED", "TRACKING_PENDING", "PURCHASE_PLACED"].includes(
        String(detail.order.status || "").toUpperCase()
      ));
  const trackingPreviewPayload =
    showTrackingPreview && detail?.readiness.ready
      ? await prepareTrackingSyncPayload({ orderId: detail.order.id })
      : null;
  const trackingButtonLabel = detail?.latestAttempt?.trackingNumber ? "Update tracking" : "Add tracking";
  const canConfirmHistoricalSync =
    detail != null &&
    Boolean(detail.latestAttempt?.id) &&
    Boolean(detail.latestAttempt?.trackingNumber?.trim()) &&
    Boolean(detail.latestAttempt?.supplierOrderRef?.trim()) &&
    (isPostPurchaseStatus(detail.order.status) || Boolean(detail.lastSyncState?.trackingSyncError));
  const canViewSafety =
    detail != null &&
    purchaseSafetyRelevant &&
    (purchaseSafety?.status ?? "VALIDATION_NEEDED") !== "READY_FOR_PURCHASE_REVIEW";
  const autoPurchaseDiagnostic = detail ? getAutoPurchaseDiagnostic(detail) : null;
  const quickActionHint =
    requestedQuickAction === "mark-purchase"
      ? "Shortcut selected: mark purchase recorded."
      : requestedQuickAction === "supplier-ref"
        ? "Shortcut selected: add or update supplier reference."
        : requestedQuickAction === "tracking"
          ? "Shortcut selected: add or update tracking."
          : requestedQuickAction === "preview-sync"
            ? "Shortcut selected: preview sync readiness."
            : requestedQuickAction === "sync-ebay"
              ? "Shortcut selected: sync tracking to eBay."
              : requestedQuickAction === "view-safety"
                ? "Shortcut selected: review purchase safety details."
                : null;

  return (
    <main className="relative min-h-screen bg-app text-white">
      <div className="relative mx-auto max-w-[1800px] px-4 py-6 sm:px-6 lg:px-8">
        <header className="glass-card rounded-3xl border border-white/10 px-5 py-5 sm:px-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h1 className="text-3xl font-bold">Orders Console</h1>
              <p className="mt-2 text-sm text-white/65">
                Beginner-safe order operations: Review, approve, record supplier order, record tracking, check readiness, sync to eBay.
              </p>
            </div>
            <RefreshButton />
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <Link href="/admin/control" className="rounded-xl border border-white/15 px-3 py-1.5 text-xs text-white/80">
              Open /admin/control
            </Link>
            <Link href="/admin/listings" className="rounded-xl border border-white/15 px-3 py-1.5 text-xs text-white/80">
              Open /admin/listings
            </Link>
            <Link href="/admin/review" className="rounded-xl border border-white/15 px-3 py-1.5 text-xs text-white/80">
              Open /admin/review
            </Link>
          </div>
          {message ? (
            <div className="mt-4 rounded-xl border border-emerald-300/30 bg-emerald-500/10 p-3 text-sm text-emerald-100">
              {message}
            </div>
          ) : null}
          {error ? (
            <div className="mt-4 rounded-xl border border-rose-300/30 bg-rose-500/10 p-3 text-sm text-rose-100">
              {error}
            </div>
          ) : null}
        </header>

        <section className="glass-panel mt-5 rounded-3xl border border-white/10 p-4">
          <div className="mb-4 rounded-2xl border border-white/10 bg-black/20 p-4">
            <div className="text-xs uppercase tracking-[0.16em] text-white/45">Operator help</div>
            <div className="mt-2 text-sm text-white/75">
              Use compact review to decide which order to open next. All execution stays per order in the detail panel.
            </div>
            <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-5">
              {ordersHelpLegend.map((item) => (
                <div key={item.label} className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
                  <div className="text-sm font-semibold text-white">{item.label}</div>
                  <div className="mt-1 text-xs text-white/60">{item.description}</div>
                </div>
              ))}
            </div>
          </div>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="text-xs uppercase tracking-[0.16em] text-white/45">Review mode</div>
              <div className="mt-2 flex flex-wrap gap-2">
                {[
                  {
                    key: "detailed" as const,
                    label: "Detailed workflow",
                    description: "Show the full table and keep the detailed panel workflow front and center.",
                  },
                  {
                    key: "compact" as const,
                    label: "Compact batch review",
                    description: "Scan multiple orders quickly, then open each one for action.",
                  },
                ].map((option) => {
                  const href = buildOrdersPageHref({
                    filter,
                    mode: option.key,
                    orderId: selectedOrderId,
                  });
                  const active = option.key === mode;
                  return (
                    <Link
                      key={option.key}
                      href={href}
                      className={`rounded-2xl border px-3 py-2 text-sm ${active ? "border-cyan-300/35 bg-cyan-500/15 text-cyan-100" : "border-white/15 bg-white/[0.03] text-white/80"}`}
                    >
                      <div className="font-medium">{option.label}</div>
                      <div className="mt-1 text-xs text-white/55">{option.description}</div>
                    </Link>
                  );
                })}
              </div>
            </div>
            <div className="max-w-md rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-white/70">
              Compact batch review keeps all execution per order. Use it to find the next safe order to open, then use the detail panel to perform the actual step.
            </div>
          </div>
          <div className="mt-4 text-xs uppercase tracking-[0.16em] text-white/45">Review filters</div>
          <div className="mt-2 flex flex-wrap gap-2">
            {filters.map((f) => {
              const href = buildOrdersPageHref({
                filter: f.key,
                mode,
                orderId: selectedOrderId,
              });
              const active = f.key === filter;
              return (
                <Link
                  key={f.key}
                  href={href}
                  className={`rounded-xl px-3 py-1.5 text-sm ${active ? "border border-cyan-300/35 bg-cyan-500/15 text-cyan-100" : "border border-white/15 bg-white/[0.03] text-white/80"}`}
                >
                  {f.label}
                </Link>
              );
            })}
          </div>
        </section>

        {mode === "compact" ? (
          <section className="mt-5 grid gap-3 lg:grid-cols-3 xl:grid-cols-6">
            {compactCards.map((card) => {
              const active = filter === card.filterKey;
              const count = batchCounts[card.filterKey];
              return (
                <Link
                  key={card.filterKey}
                  href={buildOrdersPageHref({
                    filter: card.filterKey,
                    mode: "compact",
                    orderId: selectedOrderId,
                  })}
                  className={`glass-panel rounded-3xl border p-4 ${active ? "border-cyan-300/35 bg-cyan-500/10" : "border-white/10 bg-transparent"}`}
                >
                  <div className="text-xs uppercase tracking-[0.16em] text-white/45">{card.label}</div>
                  <div className="mt-2 text-3xl font-semibold text-white">{count}</div>
                  <div className="mt-2 text-sm text-white/65">{card.description}</div>
                </Link>
              );
            })}
          </section>
        ) : null}

        <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,900px)_minmax(0,1fr)]">
          <section className="glass-panel rounded-3xl border border-white/10 p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
              <div className="text-sm text-white/65">
                {mode === "compact"
                  ? `Compact review (${rows.length} rows shown)`
                  : `Orders table (${rows.length} rows)`}
              </div>
              {mode === "compact" ? (
                <div className="rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-xs text-white/65">
                  Review focus: stage, safety, purchase, tracking, next step, and blockers.
                </div>
              ) : null}
            </div>
            <div className="max-h-[76vh] overflow-auto rounded-2xl border border-white/10">
              <table className="min-w-full border-collapse text-sm">
                <thead className="sticky top-0 bg-[#111827]">
                  <tr>
                    {(mode === "compact"
                      ? [
                          "Order ID",
                          "eBay order ID",
                          "Current stage",
                          "Purchase safety",
                          "Purchase status",
                          "Tracking status",
                          "Readiness",
                          "Next action",
                          "Blocked reason",
                          "Quick actions",
                        ]
                      : [
                          "Order ID",
                          "eBay order ID",
                          "Current stage",
                          "Next action",
                          "Buyer country",
                          "Total",
                          "Order status",
                          "Listing",
                          "Supplier",
                          "Supplier product ID",
                          "Purchase status",
                          "Tracking status",
                          "Quick actions",
                        ]).map((h) => (
                      <th key={h} className="border-b border-white/10 px-3 py-2 text-left text-[11px] uppercase tracking-[0.16em] text-white/55">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {!rows.length ? (
                    <tr>
                      <td colSpan={mode === "compact" ? 10 : 13} className="px-3 py-8 text-center text-sm text-white/65">
                        No orders found for this filter. Sync orders, then refresh this page.
                      </td>
                    </tr>
                  ) : null}
                  {compactRows.map(({ row, summary }) => {
                    const href = orderDetailsHref({ filter, mode, orderId: row.orderId });
                    const selected = row.orderId === selectedOrderId;
                    const status = String(row.status || "").toUpperCase();
                    const synced = isTrackingFullySynced(status);
                    const rowHasSupplier = row.hasSupplierLinkage;
                    const rowCanMarkPurchase = !synced && ["PURCHASE_APPROVED", "PURCHASE_PLACED", "TRACKING_PENDING", "TRACKING_RECEIVED"].includes(status);
                    const rowCanTracking = !synced && ["PURCHASE_PLACED", "TRACKING_PENDING", "TRACKING_RECEIVED"].includes(status);
                    const rowCanPreview =
                      !synced &&
                      (row.trackingReady || ["TRACKING_RECEIVED", "TRACKING_PENDING", "PURCHASE_PLACED"].includes(status));
                    const rowCanSync = !synced && row.trackingReady;
                    const rowCanViewSafety =
                      !isPostPurchaseStatus(status) &&
                      ["MANUAL_REVIEW", "NEW", "NEW_ORDER", "READY_FOR_PURCHASE_REVIEW", "PURCHASE_APPROVED"].includes(status);
                    const rowCanSupplierRef = rowCanMarkPurchase && rowHasSupplier;
                    const rowCanMarkPurchaseDirect = rowCanMarkPurchase && rowHasSupplier;
                    const markPurchaseHint = getDisabledRowQuickActionHint({
                      action: "mark-purchase",
                      enabled: rowCanMarkPurchaseDirect,
                      hasSupplier: rowHasSupplier,
                    });
                    const supplierRefHint = getDisabledRowQuickActionHint({
                      action: "supplier-ref",
                      enabled: rowCanSupplierRef,
                      hasSupplier: rowHasSupplier,
                    });
                    const trackingHint = getDisabledRowQuickActionHint({
                      action: "tracking",
                      enabled: rowCanTracking,
                      hasSupplier: rowHasSupplier,
                    });
                    const previewHint = getDisabledRowQuickActionHint({
                      action: "preview-sync",
                      enabled: rowCanPreview,
                      hasSupplier: rowHasSupplier,
                    });
                    const syncHint = getDisabledRowQuickActionHint({
                      action: "sync-ebay",
                      enabled: rowCanSync,
                      hasSupplier: rowHasSupplier,
                    });
                    const viewSafetyHint = getDisabledRowQuickActionHint({
                      action: "view-safety",
                      enabled: rowCanViewSafety,
                      hasSupplier: rowHasSupplier,
                    });
                    const rowSupplierRefLabel = "Open supplier ref form";
                    const rowTrackingLabel = "Open tracking form";
                    const rowSyncPreviewLabel = "Check sync readiness";
                    const rowSafetyLabel = "Review safety";
                    const purchaseActionLabel =
                      mode === "compact" ? "Record purchase" : "Record supplier purchase";
                    const rowTrackingHintText =
                      row.trackingStatus && String(row.trackingStatus).toUpperCase() !== "NOT_AVAILABLE"
                        ? "Tracking can be updated in the detail panel."
                        : "Open the detail panel to add tracking.";
                    const purchaseDefaultStatus = normalizePurchaseStatus(row.purchaseStatus);
                    return (
                      <tr key={row.orderId} className={selected ? "bg-cyan-500/10" : "odd:bg-transparent even:bg-white/[0.02]"}>
                        <td className="border-b border-white/5 px-3 py-3">
                          <Link href={href} className="text-cyan-100 underline">
                            {row.orderId}
                          </Link>
                        </td>
                        <td className="border-b border-white/5 px-3 py-3">{row.ebayOrderId}</td>
                        <td className="border-b border-white/5 px-3 py-3">
                          <span className="rounded-full border border-white/15 bg-white/[0.05] px-2 py-1 text-xs text-white/90">
                            {summary.operatorStage}
                          </span>
                        </td>
                        {mode === "compact" ? (
                          <>
                            <td className="border-b border-white/5 px-3 py-3">
                              <span className="rounded-full border border-white/15 bg-white/[0.05] px-2 py-1 text-xs text-white/90">
                                {summary.purchaseSafetyState}
                              </span>
                            </td>
                            <td className="border-b border-white/5 px-3 py-3 text-xs text-white/80">
                              {row.purchaseStatus ?? "Not recorded"}
                            </td>
                            <td className="border-b border-white/5 px-3 py-3 text-xs text-white/80">
                              {row.trackingStatus ?? "Not added"}
                            </td>
                            <td className="border-b border-white/5 px-3 py-3 text-xs text-white/80">
                              {summary.readinessState}
                            </td>
                            <td className="border-b border-white/5 px-3 py-3 text-xs text-white/80">
                              {summary.nextAction}
                            </td>
                            <td className="border-b border-white/5 px-3 py-3 text-xs text-white/80">
                              {summary.blockedReason ?? "Ready for next guided step"}
                            </td>
                          </>
                        ) : (
                          <>
                            <td className="border-b border-white/5 px-3 py-3 text-xs text-white/80">
                              {summary.nextAction}
                            </td>
                            <td className="border-b border-white/5 px-3 py-3">{row.buyerCountry ?? "-"}</td>
                            <td className="border-b border-white/5 px-3 py-3">{row.totalDisplay ?? "-"}</td>
                            <td className="border-b border-white/5 px-3 py-3">
                              <span className={`rounded-full border px-2 py-1 text-xs ${statusTone(row.status)}`}>
                                {statusLabel(row.status)}
                              </span>
                            </td>
                            <td className="border-b border-white/5 px-3 py-3">{row.listingDisplay ?? "-"}</td>
                            <td className="border-b border-white/5 px-3 py-3">{row.supplierDisplay ?? "-"}</td>
                            <td className="border-b border-white/5 px-3 py-3">{row.supplierProductId ?? "-"}</td>
                            <td className="border-b border-white/5 px-3 py-3">{row.purchaseStatus ?? "-"}</td>
                            <td className="border-b border-white/5 px-3 py-3">{row.trackingStatus ?? "-"}</td>
                          </>
                        )}
                        <td className="border-b border-white/5 px-3 py-3">
                          <div className="flex flex-wrap gap-1 text-xs">
                            <div className="flex flex-col items-start gap-0.5">
                              <form action={runOrderAction}>
                                <input type="hidden" name="actionType" value="record-purchase" />
                                <input type="hidden" name="orderId" value={row.orderId} />
                                <input type="hidden" name="filter" value={filter} />
                                <input type="hidden" name="mode" value={mode} />
                                <input type="hidden" name="supplierKey" value={row.supplierDisplay ?? ""} />
                                <input type="hidden" name="purchaseStatus" value={purchaseDefaultStatus} />
                                <button
                                  disabled={!rowCanMarkPurchaseDirect}
                                  className={`rounded-md border px-2 py-1 ${quickActionButtonTone(rowCanMarkPurchaseDirect)}`}
                                >
                                  {purchaseActionLabel}
                                </button>
                              </form>
                              {markPurchaseHint ? <span className="text-[10px] text-white/50">{markPurchaseHint}</span> : null}
                            </div>
                            <div className="flex flex-col items-start gap-0.5">
                              <Link
                                href={orderDetailsHref({
                                  filter,
                                  mode,
                                  orderId: row.orderId,
                                  quickAction: "supplier-ref",
                                  anchor: "supplier-ref-form",
                                })}
                                className={`rounded-md border px-2 py-1 ${quickActionButtonTone(rowCanSupplierRef)}`}
                                aria-disabled={!rowCanSupplierRef}
                                tabIndex={rowCanSupplierRef ? undefined : -1}
                              >
                                {rowSupplierRefLabel}
                              </Link>
                              {supplierRefHint ? <span className="text-[10px] text-white/50">{supplierRefHint}</span> : null}
                            </div>
                            <div className="flex flex-col items-start gap-0.5">
                              <Link
                                href={orderDetailsHref({
                                  filter,
                                  mode,
                                  orderId: row.orderId,
                                  quickAction: "tracking",
                                  anchor: "tracking-form",
                                })}
                                className={`rounded-md border px-2 py-1 ${quickActionButtonTone(rowCanTracking)}`}
                                aria-disabled={!rowCanTracking}
                                tabIndex={rowCanTracking ? undefined : -1}
                              >
                                {rowTrackingLabel}
                              </Link>
                              {trackingHint ? <span className="text-[10px] text-white/50">{trackingHint}</span> : <span className="text-[10px] text-white/50">{rowTrackingHintText}</span>}
                            </div>
                            <div className="flex flex-col items-start gap-0.5">
                              <Link
                                href={orderDetailsHref({
                                  filter,
                                  mode,
                                  orderId: row.orderId,
                                  quickAction: "preview-sync",
                                  anchor: "tracking-preview",
                                })}
                                className={`rounded-md border px-2 py-1 ${quickActionButtonTone(rowCanPreview)}`}
                                aria-disabled={!rowCanPreview}
                                tabIndex={rowCanPreview ? undefined : -1}
                              >
                                {rowSyncPreviewLabel}
                              </Link>
                              {previewHint ? <span className="text-[10px] text-white/50">{previewHint}</span> : null}
                            </div>
                            <div className="flex flex-col items-start gap-0.5">
                              <form action={runOrderAction}>
                                <input type="hidden" name="actionType" value="sync-ebay" />
                                <input type="hidden" name="orderId" value={row.orderId} />
                                <input type="hidden" name="filter" value={filter} />
                                <input type="hidden" name="mode" value={mode} />
                                <input type="hidden" name="supplierKey" value={row.supplierDisplay ?? ""} />
                                <button
                                  disabled={!rowCanSync}
                                  className={`rounded-md border px-2 py-1 ${quickActionButtonTone(rowCanSync)}`}
                                >
                                  Sync to eBay
                                </button>
                              </form>
                              {syncHint ? <span className="text-[10px] text-white/50">{syncHint}</span> : null}
                            </div>
                            <div className="flex flex-col items-start gap-0.5">
                              <Link
                                href={orderDetailsHref({
                                  filter,
                                  mode,
                                  orderId: row.orderId,
                                  quickAction: "view-safety",
                                  anchor: "purchase-safety",
                                })}
                                className={`rounded-md border px-2 py-1 ${quickActionButtonTone(rowCanViewSafety)}`}
                                aria-disabled={!rowCanViewSafety}
                                tabIndex={rowCanViewSafety ? undefined : -1}
                              >
                                {rowSafetyLabel}
                              </Link>
                              {viewSafetyHint ? <span className="text-[10px] text-white/50">{viewSafetyHint}</span> : null}
                            </div>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>

          <section className="space-y-5">
            {!detail ? (
              <div className="glass-panel rounded-3xl border border-white/10 p-5 text-sm text-white/60">
                {rows.length
                  ? "Select an order from the table to review the current step and next action."
                  : "No orders yet. Run order sync and come back to review and process orders."}
              </div>
            ) : (
              <>
                <section className="glass-panel rounded-3xl border border-white/10 p-5">
                  <h2 className="mb-3 text-lg font-semibold">Order details</h2>
                  <div className="mb-4 rounded-xl border border-white/10 bg-black/20 p-3">
                    <div className="text-xs text-white/45">Current stage</div>
                    <div className="mt-2">
                      <span className="rounded-full border border-cyan-300/30 bg-cyan-500/10 px-2 py-1 text-xs font-semibold text-cyan-100">
                        {stageLabel}
                      </span>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {stageFlow.map((step) => (
                        <span key={step.label} className={`rounded-full border px-2 py-1 text-xs ${stageTone(step.state)}`}>
                          {step.label}
                        </span>
                      ))}
                    </div>
                  </div>
                  <div className="grid gap-3 md:grid-cols-2">
                    <div className="rounded-xl border border-white/10 bg-black/20 p-3"><div className="text-xs text-white/45">Order status</div><div className="mt-1">{statusLabel(detail.order.status)}</div></div>
                    <div className="rounded-xl border border-white/10 bg-black/20 p-3"><div className="text-xs text-white/45">eBay order ID</div><div className="mt-1">{detail.order.marketplaceOrderId}</div></div>
                    <div className="rounded-xl border border-white/10 bg-black/20 p-3"><div className="text-xs text-white/45">Buyer country</div><div className="mt-1">{detail.order.buyerCountry ?? "-"}</div></div>
                    <div className="rounded-xl border border-white/10 bg-black/20 p-3"><div className="text-xs text-white/45">Total</div><div className="mt-1">{detail.order.totalPrice ? `${detail.order.totalPrice} ${detail.order.currency}` : "-"}</div></div>
                  </div>

                  <div className="mt-4">
                    <div className="mb-2 text-xs uppercase tracking-[0.16em] text-white/45">Line items</div>
                    <div className="space-y-2">
                      {detail.items.map((item) => (
                        <div key={item.id} className="rounded-xl border border-white/10 bg-black/20 p-3 text-sm">
                          Listing: {item.listingExternalId ?? item.listingId ?? "-"} | Supplier: {item.supplierKey ?? "-"} | Product: {item.supplierProductId ?? "-"} | Qty: {item.quantity} | Price: {item.itemPrice}
                          {item.supplierSnapshotQuality ? (
                            <div className="mt-2 text-xs text-white/65">
                              Snapshot quality: {item.supplierSnapshotQuality}
                              {item.supplierTelemetrySignals.length
                                ? ` | telemetry: ${item.supplierTelemetrySignals.join(", ")}`
                                : ""}
                            </div>
                          ) : null}
                          {item.supplierWarnings.length ? (
                            <div className="mt-2 rounded-lg border border-amber-300/25 bg-amber-500/10 p-2 text-xs text-amber-100">
                              {item.supplierWarnings.join(" ")}
                            </div>
                          ) : null}
                        </div>
                      ))}
                      {!detail.items.length ? <div className="rounded-xl border border-white/10 bg-black/20 p-3 text-sm text-white/60">No line items found.</div> : null}
                    </div>
                    {!hasSupplierLinkage ? (
                      <div className="mt-2 rounded-xl border border-amber-300/30 bg-amber-500/10 p-3 text-sm text-amber-100">
                        {purchaseSafetyRelevant
                          ? "Supplier linkage is missing. Review listing-to-supplier linkage before recording purchase."
                          : "Supplier linkage is still missing on the order item. Repair it for audit consistency and future automation, but this order is already in post-purchase flow."}
                      </div>
                    ) : null}
                  </div>
                </section>

                <section className="glass-panel rounded-3xl border border-white/10 p-5">
                  <h2 className="mb-3 text-lg font-semibold">Supplier purchase and tracking</h2>
                  <div className="grid gap-3 md:grid-cols-2">
                    <div className="rounded-xl border border-white/10 bg-black/20 p-3"><div className="text-xs text-white/45">Purchase status</div><div className="mt-1">{detail.latestAttempt?.purchaseStatus ?? "-"}</div></div>
                    <div className="rounded-xl border border-white/10 bg-black/20 p-3"><div className="text-xs text-white/45">Supplier order reference</div><div className="mt-1">{detail.latestAttempt?.supplierOrderRef ?? "-"}</div></div>
                    <div className="rounded-xl border border-white/10 bg-black/20 p-3"><div className="text-xs text-white/45">Auto-purchase state</div><div className="mt-1">{autoPurchaseDiagnostic?.label ?? "-"}</div></div>
                    <div className="rounded-xl border border-white/10 bg-black/20 p-3"><div className="text-xs text-white/45">Auto-purchase note</div><div className="mt-1 text-sm text-white/80">{autoPurchaseDiagnostic?.reason ?? (autoPurchaseDiagnostic?.state === "queued" ? "Queued after purchase approval." : autoPurchaseDiagnostic?.state === "submitted" ? "CJ order created and recorded." : purchaseSafetyRelevant && purchaseSafety?.status && purchaseSafety.status !== "READY_FOR_PURCHASE_REVIEW" ? `Blocked by purchase safety: ${purchaseSafety.status}` : isPostPurchaseStatus(detail.order.status) ? "Auto-purchase is no longer relevant because the order is already in post-purchase flow." : "No auto-purchase event yet.")}</div></div>
                    <div className="rounded-xl border border-white/10 bg-black/20 p-3"><div className="text-xs text-white/45">Tracking number</div><div className="mt-1">{detail.latestAttempt?.trackingNumber ?? "-"}</div></div>
                    <div className="rounded-xl border border-white/10 bg-black/20 p-3"><div className="text-xs text-white/45">Tracking carrier</div><div className="mt-1">{detail.latestAttempt?.trackingCarrier ?? "-"}</div></div>
                    <div className="rounded-xl border border-white/10 bg-black/20 p-3"><div className="text-xs text-white/45">Tracking status</div><div className="mt-1">{detail.latestAttempt?.trackingStatus ?? "-"}</div></div>
                    <div className="rounded-xl border border-white/10 bg-black/20 p-3">
                      <div className="text-xs text-white/45">Last sync result</div>
                      <div className="mt-1">
                        {detail.lastSyncState?.trackingSyncedAt
                          ? "Synced successfully"
                          : detail.lastSyncState?.trackingSyncError
                            ? "Last sync failed"
                            : "Not synced yet"}
                      </div>
                      {detail.lastSyncState?.trackingSyncLastAttemptAt ? (
                        <div className="mt-1 text-xs text-white/55">
                          Last attempt: {formatDateTime(detail.lastSyncState.trackingSyncLastAttemptAt.toISOString())}
                        </div>
                      ) : null}
                      {detail.lastSyncState?.trackingSyncError ? (
                        <div className="mt-2 text-xs text-rose-100">{detail.lastSyncState.trackingSyncError}</div>
                      ) : null}
                    </div>
                  </div>
                  <div className="mt-3 rounded-xl border border-white/10 bg-black/20 p-3">
                    <div className="text-xs text-white/45">Purchase status indicator</div>
                    <div className="mt-2">
                      <span className={`rounded-full border px-2 py-1 text-xs font-semibold ${indicatorTone(progressIndicator)}`}>
                        {progressIndicator}
                      </span>
                    </div>
                    <div className="mt-2 text-xs text-white/65">
                      Operator stage: {stageLabel}
                    </div>
                  </div>
                </section>

                <section className="glass-panel rounded-3xl border border-white/10 p-5">
                  <h2 className="mb-3 text-lg font-semibold">Profit snapshot</h2>
                  <div className="grid gap-3 md:grid-cols-3">
                    <div className="rounded-xl border border-white/10 bg-black/20 p-3">
                      <div className="text-xs text-white/45">Listing price</div>
                      <div className="mt-1">{formatMoney(profitSnapshot?.listingPrice ?? null, detail.order.currency || "USD")}</div>
                    </div>
                    <div className="rounded-xl border border-white/10 bg-black/20 p-3">
                      <div className="text-xs text-white/45">Supplier cost</div>
                      <div className="mt-1">
                        {formatMoney(profitSnapshot?.supplierCost ?? null, detail.order.currency || "USD")}
                        {profitSnapshot?.supplierCostIsEstimate ? <span className="ml-2 text-xs text-white/55">(best estimate)</span> : null}
                      </div>
                    </div>
                    <div className="rounded-xl border border-white/10 bg-black/20 p-3">
                      <div className="text-xs text-white/45">Estimated profit</div>
                      <div className="mt-1">{formatMoney(profitSnapshot?.estimatedProfit ?? null, detail.order.currency || "USD")}</div>
                    </div>
                  </div>
                </section>

                <section id="purchase-safety" className="glass-panel rounded-3xl border border-white/10 p-5">
                  <h2 className="mb-3 text-lg font-semibold">Purchase safety check</h2>
                  <div className="rounded-xl border border-white/10 bg-black/20 p-3">
                    <div className="text-xs text-white/45">Safety status</div>
                    <div className="mt-2">
                      <span className={`rounded-full border px-2 py-1 text-xs font-semibold ${purchaseSafetyRelevant ? purchaseSafetyTone(purchaseSafety?.status ?? "VALIDATION_NEEDED") : "border-white/15 bg-white/[0.05] text-white/90"}`}>
                        {purchaseSafetyRelevant ? (purchaseSafety?.label ?? "Validation needed before purchase") : "Archived after purchase"}
                      </span>
                    </div>
                    <div className="mt-2 text-sm text-white/80">{purchaseSafetyRelevant ? (purchaseSafety?.hint ?? "Manual review required.") : "Purchase safety is evaluated before approval. This order has already progressed to post-purchase workflow."}</div>
                    {purchaseSafetyRelevant && purchaseSafety?.secondaryHint ? <div className="mt-1 text-xs text-white/65">{purchaseSafety.secondaryHint}</div> : null}
                    <div className="mt-2 text-[11px] uppercase tracking-[0.16em] text-white/45">
                      {purchaseSafetyRelevant ? (purchaseSafety?.technicalLabel ?? "VALIDATION_NOT_RUN") : "POST_PURCHASE_ARCHIVED"}
                    </div>
                    <div className="mt-2 text-xs text-white/55">
                      {purchaseSafetyRelevant
                        ? "Future execution hook: require fresh supplier validation every time."
                        : "Historical safety gaps can still be repaired for audit consistency, but they no longer block completed supplier or tracking steps."}
                    </div>
                    {purchaseSafetyRelevant && purchaseSafety?.checkedAt ? (
                      <div className="mt-1 text-xs text-white/55">Checked: {formatDateTime(purchaseSafety.checkedAt)}</div>
                    ) : null}
                    {purchaseSafetyRelevant && purchaseSafety?.reasons.length ? (
                      <div className="mt-2 text-xs text-white/55">
                        Reason codes: {purchaseSafety.reasons.join(", ")}
                      </div>
                    ) : null}
                    {purchaseSafetyRelevant && purchaseSafety?.status === "VALIDATION_NEEDED" ? (
                      <div className="mt-2 text-xs text-amber-100">
                        Purchase safety not checked yet. Review supplier price and run a fresh check before approval.
                      </div>
                    ) : null}
                    {purchaseSafetyRelevant && detail.items.some((item) => item.supplierWarnings.length > 0) ? (
                      <div className="mt-3 rounded-xl border border-amber-300/25 bg-amber-500/10 p-3 text-xs text-amber-100">
                        {detail.items
                          .flatMap((item) =>
                            item.supplierWarnings.map((warning) => `${item.supplierKey ?? "supplier"}: ${warning}`)
                          )
                          .slice(0, 6)
                          .join(" ")}
                      </div>
                    ) : null}
                  </div>
                </section>

                <section className="glass-panel rounded-3xl border border-white/10 p-5">
                  <h2 className="mb-3 text-lg font-semibold">Event history</h2>
                  {timelineRows.length ? (
                    <div className="space-y-2">
                      {timelineRows.slice(0, 8).map((event) => (
                        <div key={event.id} className="rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm">
                          <div className="flex items-center justify-between gap-2">
                            <div className="font-medium text-white/90">{getTimelineEventTitle(event.eventType)}</div>
                            <div className="text-xs text-white/50">{formatDateTime(event.timestamp)}</div>
                          </div>
                          <div className="mt-1 text-white/75">{event.description}</div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="rounded-xl border border-white/10 bg-black/20 p-3 text-sm text-white/60">
                      No timeline events yet.
                    </div>
                  )}
                  {timelineRows.length > 8 ? (
                    <div className="mt-2 text-xs text-white/55">Showing latest 8 events.</div>
                  ) : null}
                </section>

                {showTrackingPreview ? (
                  <section id="tracking-preview" className="glass-panel rounded-3xl border border-white/10 p-5">
                    <h2 className="mb-3 text-lg font-semibold">Tracking sync preview (dry-run)</h2>
                    <div className="rounded-xl border border-white/10 bg-black/20 p-3 text-sm">
                      <div className="grid gap-3 md:grid-cols-2">
                        <div>
                          <div className="text-xs text-white/45">eBay order id</div>
                          <div className="mt-1">{detail.order.marketplaceOrderId}</div>
                        </div>
                        <div>
                          <div className="text-xs text-white/45">Sync readiness</div>
                          <div className="mt-1">{detail.readiness.ready ? "Ready to sync" : "Not ready yet"}</div>
                        </div>
                        <div>
                          <div className="text-xs text-white/45">Tracking number</div>
                          <div className="mt-1">
                            {trackingPreviewPayload?.tracking.trackingNumber ?? detail.latestAttempt?.trackingNumber ?? "-"}
                          </div>
                        </div>
                        <div>
                          <div className="text-xs text-white/45">Carrier</div>
                          <div className="mt-1">
                            {trackingPreviewPayload?.tracking.trackingCarrier ?? detail.latestAttempt?.trackingCarrier ?? "-"}
                          </div>
                        </div>
                      </div>
                      {!detail.readiness.ready ? (
                        <div className="mt-3 text-xs text-amber-100">
                          Preview only. Complete purchase and tracking details before live sync.
                        </div>
                      ) : (
                        <div className="mt-3 text-xs text-white/65">
                          Preview only. This does not execute a live eBay sync.
                        </div>
                      )}
                      {!detail.readiness.ready && detail.readiness.blockingReasons.length ? (
                        <div className="mt-2 text-xs text-white/65">
                          Missing: {detail.readiness.blockingReasons[0]}
                        </div>
                      ) : null}
                    </div>
                  </section>
                ) : null}

                <section className="glass-panel rounded-3xl border border-white/10 p-5">
                  <h2 className="mb-3 text-lg font-semibold">Quick actions</h2>
                  <div className="flex flex-wrap gap-2 text-sm">
                    <form action={runOrderAction}>
                      <input type="hidden" name="actionType" value="record-purchase" />
                      <input type="hidden" name="orderId" value={detail.order.id} />
                      <input type="hidden" name="filter" value={filter} />
                      <input type="hidden" name="mode" value={mode} />
                      <input type="hidden" name="supplierKey" value={defaultSupplierKey} />
                      <input type="hidden" name="purchaseStatus" value={normalizePurchaseStatus(detail.latestAttempt?.purchaseStatus)} />
                      <button
                        disabled={!canRecordPurchase || !defaultSupplierKey}
                        className={`rounded-lg border px-3 py-2 disabled:cursor-not-allowed disabled:opacity-50 ${quickActionButtonTone(canRecordPurchase && Boolean(defaultSupplierKey))}`}
                      >
                        Record supplier purchase
                      </button>
                    </form>
                    <a href="#supplier-ref-form" className={`rounded-lg border px-3 py-2 ${quickActionButtonTone(canRecordPurchase)}`}>
                      Open supplier ref form
                    </a>
                    <a href="#tracking-form" className={`rounded-lg border px-3 py-2 ${quickActionButtonTone(canRecordTracking)}`}>
                      Open tracking form
                    </a>
                    <a href="#tracking-preview" className={`rounded-lg border px-3 py-2 ${quickActionButtonTone(showTrackingPreview)}`}>
                      Check sync readiness
                    </a>
                    <form action={runOrderAction}>
                      <input type="hidden" name="actionType" value="sync-ebay" />
                      <input type="hidden" name="orderId" value={detail.order.id} />
                      <input type="hidden" name="filter" value={filter} />
                      <input type="hidden" name="mode" value={mode} />
                      <input type="hidden" name="supplierOrderId" value={detail.latestAttempt?.id ?? ""} />
                      <input type="hidden" name="supplierKey" value={defaultSupplierKey} />
                      <button
                        disabled={!canSync}
                        className={`rounded-lg border px-3 py-2 disabled:cursor-not-allowed disabled:opacity-50 ${quickActionButtonTone(canSync)}`}
                      >
                        Sync to eBay
                      </button>
                    </form>
                    <form action={runOrderAction}>
                      <input type="hidden" name="actionType" value="confirm-sync" />
                      <input type="hidden" name="orderId" value={detail.order.id} />
                      <input type="hidden" name="filter" value={filter} />
                      <input type="hidden" name="mode" value={mode} />
                      <input type="hidden" name="supplierOrderId" value={detail.latestAttempt?.id ?? ""} />
                      <input type="hidden" name="trackingCarrier" value={detail.latestAttempt?.trackingCarrier ?? ""} />
                      <button
                        disabled={!canConfirmHistoricalSync}
                        className={`rounded-lg border px-3 py-2 disabled:cursor-not-allowed disabled:opacity-50 ${quickActionButtonTone(canConfirmHistoricalSync)}`}
                      >
                        Confirm synced from eBay
                      </button>
                    </form>
                    <a href="#purchase-safety" className={`rounded-lg border px-3 py-2 ${quickActionButtonTone(canViewSafety)}`}>
                      Review safety
                    </a>
                  </div>
                  {!defaultSupplierKey ? (
                    <div className="mt-2 text-xs text-amber-100">
                      Add supplier information first, then use quick actions.
                    </div>
                  ) : null}
                </section>

                <section id="action-flow" className="glass-panel rounded-3xl border border-white/10 p-5">
                  <h2 className="mb-3 text-lg font-semibold">Action flow</h2>
                  <div className="mb-4 rounded-xl border border-cyan-300/20 bg-cyan-500/10 p-3 text-xs text-cyan-100">
                    Step 1: Review | Step 2: Approve | Step 3: Record supplier order | Step 4: Record tracking | Step 5: Check readiness | Step 6: Sync to eBay
                  </div>
                  {quickActionHint ? (
                    <div className="mb-4 rounded-xl border border-cyan-300/20 bg-cyan-500/10 p-3 text-sm text-cyan-100">
                      {quickActionHint}
                    </div>
                  ) : null}
                  {actionHints.length ? (
                    <div className="mb-4 rounded-xl border border-amber-300/20 bg-amber-500/10 p-3 text-sm text-amber-100">
                      <div className="font-semibold">Operator hint</div>
                      <div className="mt-1">{actionHints[0]}</div>
                      {actionHints[1] ? <div className="mt-1 text-xs text-amber-100/90">{actionHints[1]}</div> : null}
                    </div>
                  ) : null}

                  <div className="grid gap-3">
                    <form action={runOrderAction} className="rounded-xl border border-white/10 bg-black/20 p-3">
                      <input type="hidden" name="actionType" value="ready-review" />
                      <input type="hidden" name="orderId" value={detail.order.id} />
                      <input type="hidden" name="filter" value={filter} />
                      <input type="hidden" name="mode" value={mode} />
                      <button disabled={!canReadyReview} className="rounded-lg border border-white/15 bg-white/[0.05] px-3 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-50">
                        Mark as ready for purchase review
                      </button>
                    </form>

                    <form action={runOrderAction} className="rounded-xl border border-white/10 bg-black/20 p-3">
                      <input type="hidden" name="actionType" value="approve-purchase" />
                      <input type="hidden" name="orderId" value={detail.order.id} />
                      <input type="hidden" name="filter" value={filter} />
                      <input type="hidden" name="mode" value={mode} />
                      <button disabled={!canApprove} className="rounded-lg border border-white/15 bg-white/[0.05] px-3 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-50">
                        Approve purchase
                      </button>
                      {!canApprove && purchaseSafetyRelevant && purchaseSafety?.status !== "READY_FOR_PURCHASE_REVIEW" ? (
                        <div className="mt-2 text-xs text-amber-100">
                          Disabled: {purchaseSafety?.label ?? "Not checked yet"}.
                        </div>
                      ) : null}
                    </form>

                    <form action={runOrderAction} className="rounded-xl border border-white/10 bg-black/20 p-3">
                      <input type="hidden" name="actionType" value="repair-linkage" />
                      <input type="hidden" name="orderId" value={detail.order.id} />
                      <input type="hidden" name="filter" value={filter} />
                      <input type="hidden" name="mode" value={mode} />
                      <div className="mb-2 text-xs text-white/55">Repair supplier linkage</div>
                      <div className="grid gap-2 md:grid-cols-2">
                        <select name="orderItemId" defaultValue={defaultRepairItem?.id ?? ""} className="contact-input" required>
                          {detail.items.map((item) => (
                            <option key={item.id} value={item.id}>
                              {item.listingExternalId ?? item.listingId ?? item.id} | qty {item.quantity}
                            </option>
                          ))}
                        </select>
                        <input name="supplierKey" defaultValue={defaultRepairItem?.supplierKey ?? defaultSupplierKey} className="contact-input" placeholder="Supplier key (optional if listing id resolves it)" />
                        <input name="supplierProductId" defaultValue={defaultRepairItem?.supplierProductId ?? ""} className="contact-input" placeholder="Supplier product id (optional if listing id resolves it)" />
                        <input name="listingId" defaultValue={defaultRepairItem?.listingId ?? ""} className="contact-input" placeholder="Optional listing id" />
                        <input name="supplierSourceUrl" defaultValue="" className="contact-input md:col-span-2" placeholder="Optional supplier source URL" />
                      </div>
                      <button className="mt-3 rounded-lg border border-white/15 bg-white/[0.05] px-3 py-2 text-sm">
                        Save supplier linkage
                      </button>
                      <div className="mt-2 text-xs text-white/55">
                        Use this only when you have an exact supplier product or exact internal listing row. If the listing already carries source linkage, the supplier fields can be left blank.
                      </div>
                    </form>

                    <form id="supplier-ref-form" action={runOrderAction} className="rounded-xl border border-white/10 bg-black/20 p-3">
                      <input type="hidden" name="actionType" value="record-purchase" />
                      <input type="hidden" name="orderId" value={detail.order.id} />
                      <input type="hidden" name="filter" value={filter} />
                      <input type="hidden" name="mode" value={mode} />
                      <div className="mb-2 text-xs text-white/55">Mark purchase recorded and add supplier ref</div>
                      <div className="grid gap-2 md:grid-cols-2">
                        <input name="supplierKey" defaultValue={defaultSupplierKey} className="contact-input" placeholder="Supplier" required />
                        <input name="supplierOrderRef" defaultValue={detail.latestAttempt?.supplierOrderRef ?? ""} className="contact-input" placeholder="Supplier ref" />
                        <select name="purchaseStatus" defaultValue={detail.latestAttempt?.purchaseStatus ?? "SUBMITTED"} className="contact-input">
                          <option value="PENDING">PENDING</option>
                          <option value="SUBMITTED">SUBMITTED</option>
                          <option value="CONFIRMED">CONFIRMED</option>
                          <option value="FAILED">FAILED</option>
                          <option value="CANCELED">CANCELED</option>
                        </select>
                        <input name="manualNote" defaultValue={detail.latestAttempt?.manualNote ?? ""} className="contact-input" placeholder="Optional note" />
                      </div>
                      <button disabled={!canRecordPurchase} className="mt-3 rounded-lg border border-white/15 bg-white/[0.05] px-3 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-50">
                        Save purchase and supplier ref
                      </button>
                      {canRecordPurchase && purchaseSafetyRelevant && !hasSupplierLinkage ? (
                        <div className="mt-2 text-xs text-amber-100">
                          Missing supplier linkage remains a warning, but it does not block saving a real supplier purchase.
                        </div>
                      ) : null}
                    </form>

                    <form id="tracking-form" action={runOrderAction} className="rounded-xl border border-white/10 bg-black/20 p-3">
                      <input type="hidden" name="actionType" value="record-tracking" />
                      <input type="hidden" name="orderId" value={detail.order.id} />
                      <input type="hidden" name="filter" value={filter} />
                      <input type="hidden" name="mode" value={mode} />
                      <input type="hidden" name="supplierOrderId" value={detail.latestAttempt?.id ?? ""} />
                      <div className="mb-2 text-xs text-white/55">Add or update tracking</div>
                      <div className="grid gap-2 md:grid-cols-2">
                        <input name="supplierKey" defaultValue={defaultSupplierKey} className="contact-input" placeholder="Supplier" required />
                        <input name="trackingNumber" defaultValue={detail.latestAttempt?.trackingNumber ?? ""} className="contact-input" placeholder="Tracking number" required />
                        <input name="trackingCarrier" defaultValue={detail.latestAttempt?.trackingCarrier ?? ""} className="contact-input" placeholder="Tracking carrier (UPS, USPS, FEDEX...)" required />
                        <select name="trackingStatus" defaultValue={detail.latestAttempt?.trackingStatus ?? "LABEL_CREATED"} className="contact-input">
                          <option value="NOT_AVAILABLE">NOT_AVAILABLE</option>
                          <option value="LABEL_CREATED">LABEL_CREATED</option>
                          <option value="IN_TRANSIT">IN_TRANSIT</option>
                          <option value="DELIVERED">DELIVERED</option>
                          <option value="EXCEPTION">EXCEPTION</option>
                        </select>
                      </div>
                      <button disabled={!canRecordTracking} className="mt-3 rounded-lg border border-white/15 bg-white/[0.05] px-3 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-50">
                        {trackingButtonLabel}
                      </button>
                    </form>
                  </div>
                </section>

                <section className="glass-panel rounded-3xl border border-white/10 p-5">
                  <h2 className="mb-3 text-lg font-semibold">Check tracking readiness</h2>
                  {detail.readiness.ready ? (
                    <div className="rounded-xl border border-emerald-300/30 bg-emerald-500/10 p-3 text-sm text-emerald-100">
                      Ready to sync
                    </div>
                  ) : (
                    <div className="rounded-xl border border-amber-300/30 bg-amber-500/10 p-3 text-sm text-amber-100">
                      Not ready yet. Please fix the items below.
                    </div>
                  )}
                  {!detail.readiness.ready && detail.readiness.blockingReasons.length ? (
                    <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-white/80">
                      {detail.readiness.blockingReasons.map((reason) => (
                        <li key={reason}>{reason}</li>
                      ))}
                    </ul>
                  ) : null}
                  {!canSync && !detail.readiness.blockingReasons.length ? (
                    <div className="mt-3 text-sm text-white/70">
                      Sync is blocked until purchase and tracking details are complete.
                    </div>
                  ) : null}
                  {canConfirmHistoricalSync ? (
                    <form action={runOrderAction} className="mt-4">
                      <input type="hidden" name="actionType" value="confirm-sync" />
                      <input type="hidden" name="orderId" value={detail.order.id} />
                      <input type="hidden" name="filter" value={filter} />
                      <input type="hidden" name="mode" value={mode} />
                      <input type="hidden" name="supplierOrderId" value={detail.latestAttempt?.id ?? ""} />
                      <input type="hidden" name="trackingCarrier" value={detail.latestAttempt?.trackingCarrier ?? ""} />
                      <button className="rounded-xl border border-white/15 bg-white/[0.05] px-4 py-2 text-sm font-semibold text-white/90">
                        Confirm tracking already synced on eBay
                      </button>
                      <div className="mt-2 text-xs text-white/55">
                        Use this only for historical orders when the live eBay order page already shows the tracking as shipped.
                      </div>
                    </form>
                  ) : null}

                  <form action={runOrderAction} className="mt-4">
                    <input type="hidden" name="actionType" value="sync-ebay" />
                    <input type="hidden" name="orderId" value={detail.order.id} />
                    <input type="hidden" name="filter" value={filter} />
                    <input type="hidden" name="mode" value={mode} />
                    <input type="hidden" name="supplierOrderId" value={detail.latestAttempt?.id ?? ""} />
                    <input type="hidden" name="supplierKey" value={defaultSupplierKey} />
                    <button disabled={!canSync} className="rounded-xl border border-cyan-300/30 bg-cyan-500/10 px-4 py-2 text-sm font-semibold text-cyan-100 disabled:cursor-not-allowed disabled:opacity-50">
                      Sync tracking to eBay
                    </button>
                  </form>
                </section>
              </>
            )}
          </section>
        </div>
      </div>
    </main>
  );
}
