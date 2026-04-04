import { cjRequest } from "./client";
import type { CjCreateOrderInput, CjCreateOrderResult, CjOrderStatusResult } from "./types";

export type CjOrderListItem = Record<string, unknown>;
export type CjBalanceSummary = Record<string, unknown>;

function cleanString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function cleanArray(values: Array<string | null | undefined>): string[] {
  return Array.from(new Set(values.filter((value): value is string => Boolean(cleanString(value)))));
}

function assertCreateOrderInput(input: CjCreateOrderInput): void {
  if (!cleanString(input.orderNumber)) throw new Error("CJ order validation failed: orderNumber is required");
  if (!cleanString(input.shippingCountryCode)) {
    throw new Error("CJ order validation failed: shippingCountryCode is required");
  }
  if (!cleanString(input.shippingCustomerName) || !cleanString(input.shippingAddress)) {
    throw new Error("CJ order validation failed: recipient name and address are required");
  }
  if (!cleanString(input.logisticName)) {
    throw new Error("CJ order validation failed: logisticName is required");
  }
  if (!cleanString(input.fromCountryCode)) {
    throw new Error("CJ order validation failed: fromCountryCode is required");
  }
  if (!Array.isArray(input.products) || input.products.length === 0) {
    throw new Error("CJ order validation failed: at least one product is required");
  }
  if (input.products.some((product) => !cleanString(product.sku) && !cleanString(product.vid))) {
    throw new Error("CJ order validation failed: each product requires sku or vid");
  }
}

export function mapCjOrderStatusToPurchaseStatus(value: string | null): "SUBMITTED" | "CONFIRMED" {
  const normalized = cleanString(value)?.toUpperCase() ?? "";
  if (normalized === "UNPAID" || normalized === "CREATED" || normalized === "IN_CART") {
    return "SUBMITTED";
  }
  if (normalized === "UNSHIPPED" || normalized === "SHIPPED" || normalized === "DELIVERED") {
    return "CONFIRMED";
  }
  return "SUBMITTED";
}

export async function createCjOrder(input: CjCreateOrderInput): Promise<CjCreateOrderResult> {
  assertCreateOrderInput(input);
  const wrapped = await cjRequest<Record<string, unknown>>({
    method: "POST",
    path: "/shopping/order/createOrderV3",
    operation: "cj.orders.createOrderV3",
    includePlatformToken: true,
    body: {
      orderNumber: input.orderNumber,
      shippingZip: input.shippingZip,
      shippingCountry: input.shippingCountry,
      shippingCountryCode: input.shippingCountryCode,
      shippingProvince: input.shippingProvince,
      shippingCity: input.shippingCity,
      shippingCounty: input.shippingCounty ?? "",
      shippingPhone: input.shippingPhone,
      shippingCustomerName: input.shippingCustomerName,
      shippingAddress: input.shippingAddress,
      shippingAddress2: input.shippingAddress2 ?? "",
      email: input.email ?? "",
      remark: input.remark ?? "",
      logisticName: input.logisticName,
      fromCountryCode: input.fromCountryCode,
      platform: cleanString(input.platform) ?? "ebay",
      payType: 3,
      products: input.products.map((product) => ({
        sku: cleanString(product.sku) ?? undefined,
        vid: cleanString(product.vid) ?? undefined,
        quantity: product.quantity,
        storeLineItemId: cleanString(product.storeLineItemId) ?? undefined,
      })),
    },
  });
  const data = (wrapped?.data ?? {}) as Record<string, unknown>;
  return {
    orderId: cleanString(data.orderId),
    orderNum: cleanString(data.orderNum) ?? cleanString(data.orderNumber),
    cjOrderId: cleanString(data.cjOrderId),
    orderStatus: cleanString(data.orderStatus),
    logisticName: cleanString(data.logisticName),
    cjPayUrl: cleanString(data.cjPayUrl),
    raw: wrapped?.data ?? null,
  };
}

export async function listCjOrders(input?: {
  pageNum?: number;
  pageSize?: number;
  orderStatus?: string | null;
  orderNumber?: string | null;
  orderId?: string | null;
  startCreatedAt?: string | null;
  endCreatedAt?: string | null;
}): Promise<CjOrderListItem[]> {
  const wrapped = await cjRequest<Record<string, unknown> | CjOrderListItem[]>({
    method: "GET",
    path: "/shopping/order/list",
    operation: "cj.orders.list",
    query: {
      pageNum: input?.pageNum ?? 1,
      pageSize: input?.pageSize ?? 20,
      orderStatus: cleanString(input?.orderStatus),
      orderNumber: cleanString(input?.orderNumber),
      orderId: cleanString(input?.orderId),
      startCreatedAt: cleanString(input?.startCreatedAt),
      endCreatedAt: cleanString(input?.endCreatedAt),
    },
    cacheTtlMs: 15_000,
  });
  const data = wrapped?.data;
  if (Array.isArray(data)) return data;
  const possibleLists = [data?.list, data?.records, data?.content, data?.pageList];
  for (const value of possibleLists) {
    if (Array.isArray(value)) return value as CjOrderListItem[];
  }
  return [];
}

export async function getCjOrderDetail(orderId: string): Promise<CjOrderStatusResult> {
  const wrapped = await cjRequest<Record<string, unknown>>({
    method: "GET",
    path: "/shopping/order/getOrderDetail",
    operation: "cj.orders.getOrderDetail",
    query: {
      orderId,
      features: "LOGISTICS_TIMELINESS",
    },
    cacheTtlMs: 15_000,
  });
  const data = (wrapped?.data ?? {}) as Record<string, unknown>;
  return {
    orderId: cleanString(data.orderId),
    orderNum: cleanString(data.orderNum),
    cjOrderId: cleanString(data.cjOrderId),
    orderStatus: cleanString(data.orderStatus),
    logisticName: cleanString(data.logisticName),
    fromCountryCode: cleanString(data.fromCountryCode),
    trackNumber: cleanString(data.trackNumber),
    raw: wrapped?.data ?? null,
  };
}

export async function confirmCjOrder(orderId: string): Promise<string | null> {
  const trimmed = cleanString(orderId);
  if (!trimmed) throw new Error("CJ order validation failed: orderId is required");
  const wrapped = await cjRequest<string>({
    method: "POST",
    path: "/shopping/order/confirmOrder",
    operation: "cj.orders.confirmOrder",
    body: { orderId: trimmed },
  });
  return cleanString(wrapped?.data) ?? trimmed;
}

export async function deleteCjOrder(orderIds: string[]): Promise<string[] | null> {
  const normalized = cleanArray(orderIds.map((value) => cleanString(value)));
  if (!normalized.length) throw new Error("CJ order validation failed: at least one orderId is required");
  const wrapped = await cjRequest<string[] | string>({
    method: "POST",
    path: "/shopping/order/deleteOrder",
    operation: "cj.orders.deleteOrder",
    body: normalized.length === 1 ? { orderId: normalized[0] } : { orderIds: normalized },
  });
  const data = wrapped?.data;
  if (Array.isArray(data)) return data.map((value) => String(value));
  const single = cleanString(data);
  return single ? [single] : null;
}

export async function getCjBalance(): Promise<CjBalanceSummary | null> {
  const wrapped = await cjRequest<Record<string, unknown>>({
    method: "GET",
    path: "/shopping/pay/getBalance",
    operation: "cj.pay.getBalance",
    cacheTtlMs: 15_000,
  });
  return (wrapped?.data ?? null) as CjBalanceSummary | null;
}

export async function payCjBalance(orderIds: string[]): Promise<Record<string, unknown> | null> {
  const normalized = cleanArray(orderIds.map((value) => cleanString(value)));
  if (!normalized.length) throw new Error("CJ pay validation failed: at least one orderId is required");
  const wrapped = await cjRequest<Record<string, unknown>>({
    method: "POST",
    path: "/shopping/pay/payBalance",
    operation: "cj.pay.payBalance",
    body: {
      orderIds: normalized,
    },
  });
  return (wrapped?.data ?? null) as Record<string, unknown> | null;
}
