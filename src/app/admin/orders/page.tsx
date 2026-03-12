import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import RefreshButton from "@/app/_components/RefreshButton";
import {
  approveOrderForPurchase,
  buildCompactOrderTimeline,
  buildOperatorOrderStepFlow,
  buildOperatorHints,
  buildProfitSnapshot,
  getOperatorOrderStep,
  getOperatorOrderStepFromRow,
  getOperatorRowNextAction,
  getTimelineEventTitle,
  getOrderPurchaseSafetyStatus,
  getAdminOrderDetail,
  getAdminOrdersRows,
  getPurchaseStatusIndicator,
  normalizeAdminOrdersFilter,
  prepareTrackingSyncPayload,
  recordSupplierPurchase,
  recordSupplierTracking,
  setOrderReadyForPurchaseReview,
  syncTrackingToEbay,
  type AdminOrdersFilter,
} from "@/lib/orders";
import { isAuthorizedReviewAuthorizationHeader, isReviewConsoleConfigured } from "@/lib/review/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata: Metadata = {
  title: "Orders Console",
  robots: { index: false, follow: false },
};

type SearchParams = Record<string, string | string[] | undefined>;

function one(value: string | string[] | undefined): string | null {
  return Array.isArray(value) ? (value[0] ?? null) : (value ?? null);
}

async function requireAdmin() {
  const auth = (await headers()).get("authorization");
  if (!isReviewConsoleConfigured() || !isAuthorizedReviewAuthorizationHeader(auth)) {
    redirect("/admin/review");
  }
  return auth;
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
  { key: "synced", label: "Synced" },
  { key: "needs-attention", label: "Failed / needs attention" },
];

async function runOrderAction(formData: FormData) {
  "use server";

  const authHeader = await requireAdmin();
  const orderId = String(formData.get("orderId") ?? "").trim();
  const actionType = String(formData.get("actionType") ?? "").trim();
  const filter = normalizeAdminOrdersFilter(String(formData.get("filter") ?? ""));
  const actorId = authHeader ? "admin/orders" : "admin/orders";

  if (!orderId) {
    redirect(`/admin/orders?filter=${encodeURIComponent(filter)}&error=${encodeURIComponent("Please select an order first.")}`);
  }

  const redirectWith = (params: { message?: string; error?: string }) => {
    const q = new URLSearchParams();
    q.set("filter", filter);
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
  const message = one(resolved?.message);
  const error = one(resolved?.error);
  const requestedOrderId = one(resolved?.orderId);

  const rows = await getAdminOrdersRows({ filter, limit: 200 });
  const selectedOrderId = requestedOrderId || rows[0]?.orderId || null;
  const detail = selectedOrderId ? await getAdminOrderDetail(selectedOrderId) : null;

  const defaultSupplierKey =
    detail?.latestAttempt?.supplierKey ?? detail?.items.find((item) => item.supplierKey)?.supplierKey ?? "";
  const canReadyReview =
    detail != null &&
    ["MANUAL_REVIEW", "NEW", "NEW_ORDER"].includes(String(detail.order.status).toUpperCase());
  const canRecordPurchase =
    detail != null &&
    ["PURCHASE_APPROVED", "PURCHASE_PLACED", "TRACKING_PENDING", "TRACKING_RECEIVED", "TRACKING_SYNCED"].includes(
      String(detail.order.status).toUpperCase()
    );
  const canRecordTracking =
    detail != null &&
    ["PURCHASE_PLACED", "TRACKING_PENDING", "TRACKING_RECEIVED", "TRACKING_SYNCED"].includes(
      String(detail.order.status).toUpperCase()
    );
  const canSync = detail?.readiness.ready ?? false;
  const timelineRows = detail ? buildCompactOrderTimeline(detail.events) : [];
  const progressIndicator = detail ? getPurchaseStatusIndicator(detail) : "NOT_PURCHASED";
  const stageLabel = detail ? getOperatorOrderStep(detail) : null;
  const stageFlow = detail ? buildOperatorOrderStepFlow(detail) : [];
  const operatorHints = detail ? buildOperatorHints(detail) : [];
  const profitSnapshot = detail ? buildProfitSnapshot(detail) : null;
  const purchaseSafety = detail ? await getOrderPurchaseSafetyStatus(detail) : null;
  const canApprove =
    detail != null &&
    String(detail.order.status).toUpperCase() === "READY_FOR_PURCHASE_REVIEW" &&
    purchaseSafety?.status === "READY_FOR_PURCHASE_REVIEW";
  const actionHints = detail
    ? Array.from(new Set([purchaseSafety?.hint, purchaseSafety?.secondaryHint, ...operatorHints].filter(Boolean) as string[])).slice(0, 2)
    : [];
  const hasSupplierLinkage =
    detail?.items.some((item) => Boolean(item.supplierKey && item.supplierProductId)) ?? false;
  const showTrackingPreview =
    detail != null &&
    (detail.readiness.ready ||
      ["TRACKING_RECEIVED", "TRACKING_PENDING", "PURCHASE_PLACED"].includes(
        String(detail.order.status || "").toUpperCase()
      ));
  const trackingPreviewPayload =
    showTrackingPreview && detail?.readiness.ready
      ? await prepareTrackingSyncPayload({ orderId: detail.order.id })
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
          <div className="text-xs uppercase tracking-[0.16em] text-white/45">Status filters</div>
          <div className="mt-2 flex flex-wrap gap-2">
            {filters.map((f) => {
              const href = `/admin/orders?filter=${encodeURIComponent(f.key)}`;
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

        <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,900px)_minmax(0,1fr)]">
          <section className="glass-panel rounded-3xl border border-white/10 p-4">
            <div className="mb-3 text-sm text-white/65">Orders table ({rows.length} rows)</div>
            <div className="max-h-[76vh] overflow-auto rounded-2xl border border-white/10">
              <table className="min-w-full border-collapse text-sm">
                <thead className="sticky top-0 bg-[#111827]">
                  <tr>
                    {[
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
                    ].map((h) => (
                      <th key={h} className="border-b border-white/10 px-3 py-2 text-left text-[11px] uppercase tracking-[0.16em] text-white/55">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {!rows.length ? (
                    <tr>
                      <td colSpan={12} className="px-3 py-8 text-center text-sm text-white/65">
                        No orders found for this filter. Sync orders, then refresh this page.
                      </td>
                    </tr>
                  ) : null}
                  {rows.map((row) => {
                    const href = `/admin/orders?filter=${encodeURIComponent(filter)}&orderId=${encodeURIComponent(row.orderId)}`;
                    const selected = row.orderId === selectedOrderId;
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
                            {getOperatorOrderStepFromRow(row)}
                          </span>
                        </td>
                        <td className="border-b border-white/5 px-3 py-3 text-xs text-white/80">
                          {getOperatorRowNextAction(row)}
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
                        </div>
                      ))}
                      {!detail.items.length ? <div className="rounded-xl border border-white/10 bg-black/20 p-3 text-sm text-white/60">No line items found.</div> : null}
                    </div>
                    {!hasSupplierLinkage ? (
                      <div className="mt-2 rounded-xl border border-amber-300/30 bg-amber-500/10 p-3 text-sm text-amber-100">
                        Supplier linkage is missing. Review listing-to-supplier linkage before recording purchase.
                      </div>
                    ) : null}
                  </div>
                </section>

                <section className="glass-panel rounded-3xl border border-white/10 p-5">
                  <h2 className="mb-3 text-lg font-semibold">Supplier purchase and tracking</h2>
                  <div className="grid gap-3 md:grid-cols-2">
                    <div className="rounded-xl border border-white/10 bg-black/20 p-3"><div className="text-xs text-white/45">Purchase status</div><div className="mt-1">{detail.latestAttempt?.purchaseStatus ?? "-"}</div></div>
                    <div className="rounded-xl border border-white/10 bg-black/20 p-3"><div className="text-xs text-white/45">Supplier order reference</div><div className="mt-1">{detail.latestAttempt?.supplierOrderRef ?? "-"}</div></div>
                    <div className="rounded-xl border border-white/10 bg-black/20 p-3"><div className="text-xs text-white/45">Tracking number</div><div className="mt-1">{detail.latestAttempt?.trackingNumber ?? "-"}</div></div>
                    <div className="rounded-xl border border-white/10 bg-black/20 p-3"><div className="text-xs text-white/45">Tracking carrier</div><div className="mt-1">{detail.latestAttempt?.trackingCarrier ?? "-"}</div></div>
                    <div className="rounded-xl border border-white/10 bg-black/20 p-3"><div className="text-xs text-white/45">Tracking status</div><div className="mt-1">{detail.latestAttempt?.trackingStatus ?? "-"}</div></div>
                    <div className="rounded-xl border border-white/10 bg-black/20 p-3"><div className="text-xs text-white/45">Last sync result</div><div className="mt-1">{detail.lastSyncState?.trackingSyncedAt ? "Synced successfully" : detail.lastSyncState?.trackingSyncError ? "Last sync failed" : "Not synced yet"}</div></div>
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

                <section className="glass-panel rounded-3xl border border-white/10 p-5">
                  <h2 className="mb-3 text-lg font-semibold">Purchase safety check</h2>
                  <div className="rounded-xl border border-white/10 bg-black/20 p-3">
                    <div className="text-xs text-white/45">Safety status</div>
                    <div className="mt-2">
                      <span className={`rounded-full border px-2 py-1 text-xs font-semibold ${purchaseSafetyTone(purchaseSafety?.status ?? "VALIDATION_NEEDED")}`}>
                        {purchaseSafety?.label ?? "Validation needed before purchase"}
                      </span>
                    </div>
                    <div className="mt-2 text-sm text-white/80">{purchaseSafety?.hint ?? "Manual review required."}</div>
                    {purchaseSafety?.secondaryHint ? <div className="mt-1 text-xs text-white/65">{purchaseSafety.secondaryHint}</div> : null}
                    <div className="mt-2 text-[11px] uppercase tracking-[0.16em] text-white/45">
                      {purchaseSafety?.technicalLabel ?? "VALIDATION_NOT_RUN"}
                    </div>
                    <div className="mt-2 text-xs text-white/55">
                      Future execution hook: require fresh supplier validation every time.
                    </div>
                    {purchaseSafety?.checkedAt ? (
                      <div className="mt-1 text-xs text-white/55">Checked: {formatDateTime(purchaseSafety.checkedAt)}</div>
                    ) : null}
                    {purchaseSafety?.reasons.length ? (
                      <div className="mt-2 text-xs text-white/55">
                        Reason codes: {purchaseSafety.reasons.join(", ")}
                      </div>
                    ) : null}
                    {purchaseSafety?.status === "VALIDATION_NEEDED" ? (
                      <div className="mt-2 text-xs text-amber-100">
                        Purchase safety not checked yet. Review supplier price and run a fresh check before approval.
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
                  <section className="glass-panel rounded-3xl border border-white/10 p-5">
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
                  <h2 className="mb-3 text-lg font-semibold">Action flow</h2>
                  <div className="mb-4 rounded-xl border border-cyan-300/20 bg-cyan-500/10 p-3 text-xs text-cyan-100">
                    Step 1: Review | Step 2: Approve | Step 3: Record supplier order | Step 4: Record tracking | Step 5: Check readiness | Step 6: Sync to eBay
                  </div>
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
                      <button disabled={!canReadyReview} className="rounded-lg border border-white/15 bg-white/[0.05] px-3 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-50">
                        Mark as ready for purchase review
                      </button>
                    </form>

                    <form action={runOrderAction} className="rounded-xl border border-white/10 bg-black/20 p-3">
                      <input type="hidden" name="actionType" value="approve-purchase" />
                      <input type="hidden" name="orderId" value={detail.order.id} />
                      <input type="hidden" name="filter" value={filter} />
                      <button disabled={!canApprove} className="rounded-lg border border-white/15 bg-white/[0.05] px-3 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-50">
                        Approve purchase
                      </button>
                      {!canApprove && purchaseSafety?.status !== "READY_FOR_PURCHASE_REVIEW" ? (
                        <div className="mt-2 text-xs text-amber-100">
                          Disabled: {purchaseSafety?.label ?? "Not checked yet"}.
                        </div>
                      ) : null}
                    </form>

                    <form action={runOrderAction} className="rounded-xl border border-white/10 bg-black/20 p-3">
                      <input type="hidden" name="actionType" value="record-purchase" />
                      <input type="hidden" name="orderId" value={detail.order.id} />
                      <input type="hidden" name="filter" value={filter} />
                      <div className="mb-2 text-xs text-white/55">Record supplier order</div>
                      <div className="grid gap-2 md:grid-cols-2">
                        <input name="supplierKey" defaultValue={defaultSupplierKey} className="contact-input" placeholder="Supplier" required />
                        <input name="supplierOrderRef" defaultValue={detail.latestAttempt?.supplierOrderRef ?? ""} className="contact-input" placeholder="Supplier order reference" />
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
                        Save supplier order
                      </button>
                    </form>

                    <form action={runOrderAction} className="rounded-xl border border-white/10 bg-black/20 p-3">
                      <input type="hidden" name="actionType" value="record-tracking" />
                      <input type="hidden" name="orderId" value={detail.order.id} />
                      <input type="hidden" name="filter" value={filter} />
                      <input type="hidden" name="supplierOrderId" value={detail.latestAttempt?.id ?? ""} />
                      <div className="mb-2 text-xs text-white/55">Record tracking</div>
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
                        Save tracking
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

                  <form action={runOrderAction} className="mt-4">
                    <input type="hidden" name="actionType" value="sync-ebay" />
                    <input type="hidden" name="orderId" value={detail.order.id} />
                    <input type="hidden" name="filter" value={filter} />
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
