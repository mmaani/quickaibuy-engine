import { cjRequest } from "./client";
import type { CjCreateOrderInput, CjCreateOrderResult, CjOrderStatusResult } from "./types";

function cleanString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function assertCreateOrderInput(input: CjCreateOrderInput): void {
  if (!cleanString(input.orderNumber)) throw new Error("CJ order validation failed: orderNumber is required");
  if (!cleanString(input.shippingCountryCode)) {
    throw new Error("CJ order validation failed: shippingCountryCode is required");
  }
  if (!cleanString(input.shippingCustomerName) || !cleanString(input.shippingAddress)) {
    throw new Error("CJ order validation failed: recipient name and address are required");
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
      logisticName: input.logisticName ?? "",
      fromCountryCode: input.fromCountryCode ?? "",
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
