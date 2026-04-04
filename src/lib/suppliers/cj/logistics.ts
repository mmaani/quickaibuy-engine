import { cjRequest } from "./client";
import type { CjTrackingInfo } from "./types";

function cleanString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
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
