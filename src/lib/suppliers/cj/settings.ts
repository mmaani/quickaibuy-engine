import { cjRequest } from "./client";
import type { CjSettingsPayload, CjSettingsSummary } from "./types";

function toFiniteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const parsed = Number(String(value ?? "").trim());
  return Number.isFinite(parsed) ? parsed : null;
}

function cleanString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function inferOperationalState(payload: CjSettingsPayload | null): CjSettingsSummary["operationalState"] {
  if (!payload) return "unknown";
  const qps = toFiniteNumber(payload.qps) ?? toFiniteNumber(payload.apiQps) ?? toFiniteNumber(payload.limitQps);
  const userLevel = String(payload.userLevel ?? payload.apiLevel ?? "").trim().toLowerCase();
  const salesLevel = toFiniteNumber(payload.salesLevel);
  if (qps != null && qps <= 1) return "unverified-like";
  if (userLevel === "free" || salesLevel === 0 || salesLevel === 1) return "unverified-like";
  if (qps != null && qps >= 2) return "verified-like";
  return "unknown";
}

export async function getCjSettingsSummary(): Promise<CjSettingsSummary | null> {
  const wrapped = await cjRequest<CjSettingsPayload>({
    method: "GET",
    path: "/setting/get",
    operation: "cj.settings.get",
    cacheTtlMs: 5 * 60 * 1000,
  });
  if (!wrapped) return null;
  const payload = (wrapped.data ?? null) as CjSettingsPayload | null;
  return {
    raw: payload,
    qpsLimit: toFiniteNumber(payload?.qps) ?? toFiniteNumber(payload?.apiQps) ?? toFiniteNumber(payload?.limitQps),
    quotaLimit: toFiniteNumber(payload?.quota) ?? toFiniteNumber(payload?.dayQuota) ?? toFiniteNumber(payload?.monthQuota),
    quotaRemaining: toFiniteNumber(payload?.remainingQuota),
    userLevel: cleanString(payload?.userLevel) ?? cleanString(payload?.apiLevel),
    salesLevel: cleanString(payload?.salesLevel),
    sandbox:
      typeof payload?.sandbox === "boolean"
        ? payload.sandbox
        : typeof payload?.isSandbox === "boolean"
          ? payload.isSandbox
          : null,
    operationalState: inferOperationalState(payload),
  };
}
