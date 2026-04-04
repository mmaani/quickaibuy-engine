import { cjRequest } from "./client";
import type { CjTrackingInfo } from "./types";

export type CjFreightCalculateQuote = {
  logisticAging?: string;
  logisticPrice?: number | string;
  logisticPriceCn?: number | string;
  logisticName?: string;
  taxesFee?: number | string;
  clearanceOperationFee?: number | string;
  totalPostageFee?: number | string;
};

export type CjFreightCalculateTipQuote = {
  arrivalTime?: string;
  discountFee?: number | string;
  postage?: number | string;
  wrapPostage?: number | string;
  taxesFee?: number | string;
  clearanceOperationFee?: number | string;
  option?: {
    enName?: string;
    cnName?: string;
    id?: string;
  };
  channel?: {
    enName?: string;
    cnName?: string;
    id?: string;
  };
  srcArea?: {
    shortCode?: string;
    enName?: string;
  };
  destArea?: {
    shortCode?: string;
    enName?: string;
  };
  message?: string;
  error?: string;
  errorEn?: string;
  logisticsList?: Array<{
    logisticName?: string;
    arrivalTime?: string;
    discountFee?: number | string;
    postage?: number | string;
    wrapPostage?: number | string;
    error?: string;
    errorEn?: string;
  }>;
};

function cleanString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function toFiniteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseDeliveryCycleDays(value: unknown): { minDays: number | null; maxDays: number | null } {
  const raw = String(value ?? "").trim();
  const matches = Array.from(raw.matchAll(/\d+/g)).map((match) => Number(match[0]));
  if (!matches.length) return { minDays: null, maxDays: null };
  return {
    minDays: Math.min(...matches),
    maxDays: Math.max(...matches),
  };
}

function asObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function findStringDeep(value: unknown, wantedKeys: Set<string>, depth = 0): string | null {
  if (depth > 6 || value == null) return null;
  if (Array.isArray(value)) {
    for (const entry of value) {
      const found = findStringDeep(entry, wantedKeys, depth + 1);
      if (found) return found;
    }
    return null;
  }
  const obj = asObject(value);
  if (!obj) return null;
  for (const [key, raw] of Object.entries(obj)) {
    const normalized = key.replace(/[^a-z0-9]/gi, "").toLowerCase();
    if (wantedKeys.has(normalized)) {
      const found = cleanString(raw);
      if (found) return found;
    }
  }
  for (const raw of Object.values(obj)) {
    const found = findStringDeep(raw, wantedKeys, depth + 1);
    if (found) return found;
  }
  return null;
}

export function extractTrackingNumber(raw: unknown): string | null {
  return findStringDeep(raw, new Set(["tracknumber", "trackingnumber", "trackno", "trackingno"]));
}

export function extractTrackingCarrier(raw: unknown): string | null {
  return findStringDeep(
    raw,
    new Set(["logisticname", "logisticsname", "trackingcarrier", "carrier", "shippingcarrier", "shippingmethod"])
  );
}

export function selectBestCjFreightQuote(quotes: CjFreightCalculateQuote[] | undefined): CjFreightCalculateQuote | null {
  const normalized = (Array.isArray(quotes) ? quotes : []).filter((quote) => quote && typeof quote === "object");
  if (!normalized.length) return null;

  const ranked = normalized
    .map((quote) => {
      const price =
        toFiniteNumber(quote.totalPostageFee) ??
        toFiniteNumber(quote.logisticPrice) ??
        toFiniteNumber(quote.logisticPriceCn);
      const aging = parseDeliveryCycleDays(quote.logisticAging);
      const maxDays = aging.maxDays ?? Number.POSITIVE_INFINITY;
      return { quote, price, maxDays };
    })
    .sort((left, right) => {
      if (left.price != null && right.price != null && left.price !== right.price) {
        return left.price - right.price;
      }
      if (left.price != null) return -1;
      if (right.price != null) return 1;
      return left.maxDays - right.maxDays;
    });

  return ranked[0]?.quote ?? null;
}

export function selectBestCjFreightTipQuote(
  quotes: CjFreightCalculateTipQuote[] | undefined
): CjFreightCalculateTipQuote | null {
  const normalized = (Array.isArray(quotes) ? quotes : []).filter((quote) => quote && typeof quote === "object");
  if (!normalized.length) return null;

  const ranked = normalized
    .map((quote) => {
      const price =
        toFiniteNumber(quote.discountFee) ??
        toFiniteNumber(quote.wrapPostage) ??
        toFiniteNumber(quote.postage);
      const aging = parseDeliveryCycleDays(quote.arrivalTime);
      const maxDays = aging.maxDays ?? Number.POSITIVE_INFINITY;
      const hasExplicitError = Boolean(cleanString(quote.error) || cleanString(quote.errorEn));
      return { quote, price, maxDays, hasExplicitError };
    })
    .filter((entry) => !entry.hasExplicitError)
    .sort((left, right) => {
      if (left.price != null && right.price != null && left.price !== right.price) {
        return left.price - right.price;
      }
      if (left.price != null) return -1;
      if (right.price != null) return 1;
      return left.maxDays - right.maxDays;
    });

  return ranked[0]?.quote ?? null;
}

export async function calculateCjFreight(input: {
  startCountryCode: string;
  endCountryCode: string;
  products: Array<{ quantity: number; vid: string }>;
}): Promise<CjFreightCalculateQuote[]> {
  const wrapped = await cjRequest<CjFreightCalculateQuote[]>({
    method: "POST",
    path: "/logistic/freightCalculate",
    operation: "cj.logistics.freightCalculate",
    body: {
      startCountryCode: cleanString(input.startCountryCode),
      endCountryCode: cleanString(input.endCountryCode),
      products: input.products.map((product) => ({
        quantity: product.quantity,
        vid: cleanString(product.vid),
      })),
    },
    cacheTtlMs: 30_000,
  });
  return Array.isArray(wrapped?.data) ? wrapped.data : [];
}

export async function calculateCjFreightTip(input: {
  reqDTOS: Array<Record<string, unknown>>;
}): Promise<CjFreightCalculateTipQuote[]> {
  const wrapped = await cjRequest<CjFreightCalculateTipQuote[]>({
    method: "POST",
    path: "/logistic/freightCalculateTip",
    operation: "cj.logistics.freightCalculateTip",
    body: {
      reqDTOS: input.reqDTOS,
    },
    cacheTtlMs: 30_000,
  });
  return Array.isArray(wrapped?.data) ? wrapped.data : [];
}

export async function getCjTrackingInfo(trackNumber: string): Promise<CjTrackingInfo | null> {
  const trimmed = cleanString(trackNumber);
  if (!trimmed) return null;
  const wrapped = await cjRequest<Array<Record<string, unknown>>>({
    method: "GET",
    path: "/logistic/trackInfo",
    operation: "cj.logistics.trackInfo",
    query: { trackNumber: trimmed },
    cacheTtlMs: 30_000,
  });
  const first = Array.isArray(wrapped?.data) ? wrapped.data[0] ?? null : null;
  if (!first) return null;
  return {
    trackingNumber: cleanString(first.trackingNumber) ?? extractTrackingNumber(first),
    logisticName: cleanString(first.logisticName) ?? extractTrackingCarrier(first),
    trackingStatus: cleanString(first.trackingStatus),
    raw: first,
  };
}
