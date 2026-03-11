export type AvailabilitySignal = "IN_STOCK" | "LOW_STOCK" | "OUT_OF_STOCK" | "UNKNOWN";

export function normalizeAvailabilitySignal(value: unknown): AvailabilitySignal {
  const raw = String(value ?? "").trim().toUpperCase();
  if (!raw) return "UNKNOWN";

  if (
    raw.includes("OUT_OF_STOCK") ||
    raw.includes("SOLD_OUT") ||
    raw.includes("UNAVAILABLE") ||
    raw.includes("NO_STOCK")
  ) {
    return "OUT_OF_STOCK";
  }

  if (raw.includes("LOW_STOCK") || raw.includes("LIMITED_STOCK") || raw.includes("ONLY_")) {
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

  if (
    normalized.includes("out of stock") ||
    normalized.includes("sold out") ||
    normalized.includes("unavailable") ||
    normalized.includes("currently unavailable")
  ) {
    return { signal: "OUT_OF_STOCK", confidence: 0.95 };
  }

  if (
    normalized.includes("low stock") ||
    normalized.includes("limited stock") ||
    normalized.includes("only ") ||
    normalized.includes("few left")
  ) {
    return { signal: "LOW_STOCK", confidence: 0.8 };
  }

  if (
    normalized.includes("in stock") ||
    normalized.includes("available now") ||
    normalized.includes("ships from")
  ) {
    return { signal: "IN_STOCK", confidence: 0.65 };
  }

  return { signal: "UNKNOWN", confidence: 0.35 };
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
    payload?.stockConfidence;

  const signal = normalizeAvailabilitySignal(statusFromPayload ?? input.availabilityStatus);
  const confidence = normalizeAvailabilityConfidence(confidenceFromPayload);
  return { signal, confidence };
}
