export type AvailabilitySignal = "IN_STOCK" | "LOW_STOCK" | "OUT_OF_STOCK" | "UNKNOWN";

export function normalizeAvailabilitySignal(value: unknown): AvailabilitySignal {
  const raw = String(value ?? "").trim().toUpperCase();
  if (!raw) return "UNKNOWN";

  if (
    raw.includes("OUT_OF_STOCK") ||
    raw.includes("SOLD_OUT") ||
    raw.includes("UNAVAILABLE") ||
    raw.includes("NO_STOCK") ||
    raw.includes("REMOVED")
  ) {
    return "OUT_OF_STOCK";
  }

  if (
    raw.includes("LOW_STOCK") ||
    raw.includes("LIMITED_STOCK") ||
    raw.includes("ONLY_") ||
    raw.includes("FEW_LEFT") ||
    raw.includes("SELLING_FAST")
  ) {
    return "LOW_STOCK";
  }

  if (raw.includes("IN_STOCK") || raw.includes("AVAILABLE") || raw.includes("INSTOCK")) {
    return "IN_STOCK";
  }

  if (raw === "UNKNOWN") return "UNKNOWN";
  return "UNKNOWN";
}

export function normalizeAvailabilityConfidence(value: unknown): number | null {
  if (value == null) return null;
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.max(0, Math.min(1, value));
  }

  const raw = String(value).trim().toLowerCase();
  if (!raw) return null;
  if (raw === "high") return 0.9;
  if (raw === "medium") return 0.65;
  if (raw === "low") return 0.35;

  const n = Number(raw);
  if (Number.isFinite(n)) {
    return Math.max(0, Math.min(1, n));
  }

  return null;
}

export function inferAvailabilityFromText(text: string): {
  signal: AvailabilitySignal;
  confidence: number;
} {
  const normalized = String(text ?? "").toLowerCase();
  if (!normalized) return { signal: "UNKNOWN", confidence: 0.3 };

  const compact = normalized.replace(/\s+/g, " ").trim();
  const stockCountMatch = compact.match(
    /(?:only|just|about|around)?\s*(\d{1,5})\s*(?:left|units?|pieces?|items?)\s*(?:in stock|available|remaining)?|(?:"?(?:stockcount|stock_count|inventorycount|inventory_count|availablequantity|available_quantity|quantityavailable|quantity_available|totalavailquantity|availquantity)"?\s*[:=]\s*"?(?:true|false|null)?\s*,?\s*)?(\d{1,5})(?=\D|$)|(?:stock|inventory|available quantity|available qty|quantity available)\s*[:=]?\s*(\d{1,5})/
  );
  const stockCount = stockCountMatch
    ? Number(stockCountMatch[1] ?? stockCountMatch[2] ?? stockCountMatch[3])
    : null;

  if (
    compact.includes("out of stock") ||
    compact.includes("sold out") ||
    compact.includes("unavailable") ||
    compact.includes("currently unavailable") ||
    compact.includes("no stock") ||
    compact.includes("temporarily out") ||
    compact.includes("item removed") ||
    compact.includes("store closed") ||
    compact.includes("seller unavailable") ||
    compact.includes("\"issoldout\":true") ||
    compact.includes("\"soldout\":true") ||
    compact.includes("\"inventorystatus\":\"out_of_stock\"")
  ) {
    return { signal: "OUT_OF_STOCK", confidence: 0.95 };
  }

  if (stockCount != null) {
    if (stockCount <= 0) return { signal: "OUT_OF_STOCK", confidence: 0.95 };
    if (stockCount <= 5) return { signal: "LOW_STOCK", confidence: 0.9 };
    if (stockCount <= 20) return { signal: "LOW_STOCK", confidence: 0.82 };
    return { signal: "IN_STOCK", confidence: 0.78 };
  }

  if (
    compact.includes("low stock") ||
    compact.includes("limited stock") ||
    compact.includes("few left") ||
    compact.includes("almost sold out") ||
    compact.includes("selling fast") ||
    compact.includes("limited quantity") ||
    compact.includes("\"inventorystatus\":\"low_stock\"")
  ) {
    return { signal: "LOW_STOCK", confidence: 0.8 };
  }

  if (
    compact.includes("in stock") ||
    compact.includes("available now") ||
    compact.includes("ready to ship") ||
    compact.includes("ships within") ||
    compact.includes("inventory available") ||
    compact.includes("stock available") ||
    compact.includes("\"issoldout\":false") ||
    compact.includes("\"soldout\":false") ||
    compact.includes("\"inventorystatus\":\"in_stock\"") ||
    compact.includes("\"inventorystatus\":\"available\"")
  ) {
    return { signal: "IN_STOCK", confidence: 0.7 };
  }

  return { signal: "UNKNOWN", confidence: 0.35 };
}

function readStringField(payload: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = payload[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function readNumericField(payload: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    const value = payload[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
    const raw = String(value ?? "").trim();
    if (!raw) continue;
    const parsed = Number(raw);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function readBooleanField(payload: Record<string, unknown>, keys: string[]): boolean | null {
  for (const key of keys) {
    const value = payload[key];
    if (typeof value === "boolean") return value;
    const normalized = String(value ?? "").trim().toLowerCase();
    if (!normalized) continue;
    if (["true", "1", "yes", "y", "in_stock", "available"].includes(normalized)) return true;
    if (["false", "0", "no", "n", "out_of_stock", "unavailable", "sold_out"].includes(normalized)) return false;
  }
  return null;
}

export function extractAvailabilityFromRawPayload(input: {
  availabilityStatus: unknown;
  rawPayload: unknown;
}): {
  signal: AvailabilitySignal;
  confidence: number | null;
} {
  const payload =
    typeof input.rawPayload === "object" && input.rawPayload !== null && !Array.isArray(input.rawPayload)
      ? (input.rawPayload as Record<string, unknown>)
      : null;

  const statusFromPayload =
    payload?.availabilitySignal ??
    payload?.availability_status ??
    payload?.availability ??
    payload?.availabilityStatus;
  const confidenceFromPayload =
    payload?.availabilityConfidence ??
    payload?.availability_confidence ??
    payload?.stockConfidence ??
    payload?.inventoryConfidence;
  const stockFromPayload = payload
    ? readNumericField(payload, [
        "stockCount",
        "stock_count",
        "inventoryCount",
        "inventory_count",
        "availableQuantity",
        "available_quantity",
        "quantityAvailable",
        "quantity_available",
      ])
    : null;
  const availabilityBoolFromPayload = payload
    ? readBooleanField(payload, [
        "inStock",
        "in_stock",
        "isAvailable",
        "is_available",
        "available",
        "isInStock",
        "is_in_stock",
      ])
    : null;
  const statusTextFromPayload = payload
    ? readStringField(payload, [
        "availabilityText",
        "availability_text",
        "stockText",
        "stock_text",
        "inventoryBadge",
        "inventory_badge",
        "sellerStatus",
        "seller_status",
        "listingValidityReason",
        "listing_validity_reason",
      ])
    : null;

  const signal = normalizeAvailabilitySignal(statusFromPayload ?? input.availabilityStatus);
  const confidence = normalizeAvailabilityConfidence(confidenceFromPayload);
  if (signal !== "UNKNOWN") {
    return { signal, confidence: confidence ?? 0.75 };
  }

  if (stockFromPayload != null) {
    if (stockFromPayload <= 0) return { signal: "OUT_OF_STOCK", confidence: 0.95 };
    if (stockFromPayload <= 5) return { signal: "LOW_STOCK", confidence: 0.9 };
    if (stockFromPayload <= 20) return { signal: "LOW_STOCK", confidence: 0.82 };
    return { signal: "IN_STOCK", confidence: 0.78 };
  }

  if (availabilityBoolFromPayload != null) {
    return availabilityBoolFromPayload
      ? { signal: "IN_STOCK", confidence: confidence ?? 0.84 }
      : { signal: "OUT_OF_STOCK", confidence: confidence ?? 0.95 };
  }

  if (statusTextFromPayload) {
    const inferred = inferAvailabilityFromText(statusTextFromPayload);
    return {
      signal: inferred.signal,
      confidence: confidence ?? inferred.confidence,
    };
  }

  return { signal, confidence };
}
