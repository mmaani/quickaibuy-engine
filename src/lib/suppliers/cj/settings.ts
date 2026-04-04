import { cjRequest } from "./client";
import type { CjSettingsPayload, CjSettingsSummary } from "./types";

export type CjShopSummary = Record<string, unknown>;

type CjQuotaLimitRow = {
  quotaUrl?: string;
  quotaLimit?: number | string;
  requestedNum?: number | string;
};

function toFiniteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const parsed = Number(String(value ?? "").trim());
  return Number.isFinite(parsed) ? parsed : null;
}

function firstPositiveNumber(...values: unknown[]): number | null {
  for (const value of values) {
    const parsed = toFiniteNumber(value);
    if (parsed != null && parsed > 0) return parsed;
  }
  return null;
}

function cleanString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function parseNullableBoolean(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value === 1 ? true : value === 0 ? false : null;
  const normalized = cleanString(value)?.toLowerCase();
  if (normalized === "true" || normalized === "1" || normalized === "yes") return true;
  if (normalized === "false" || normalized === "0" || normalized === "no") return false;
  return null;
}

function getNestedSetting(payload: CjSettingsPayload | null): Record<string, unknown> | null {
  const setting = payload?.setting;
  if (!setting || typeof setting !== "object" || Array.isArray(setting)) return null;
  return setting as Record<string, unknown>;
}

function getQuotaLimits(payload: CjSettingsPayload | null): CjQuotaLimitRow[] {
  const quotaLimits = getNestedSetting(payload)?.quotaLimits;
  return Array.isArray(quotaLimits) ? (quotaLimits as CjQuotaLimitRow[]) : [];
}

function inferOperationalState(payload: CjSettingsPayload | null): CjSettingsSummary["operationalState"] {
  if (!payload) return "unknown";
  const nestedSetting = getNestedSetting(payload);
  const qps = firstPositiveNumber(payload.qps, payload.apiQps, payload.limitQps, nestedSetting?.qpsLimit);
  const userLevel = String(payload.userLevel ?? payload.apiLevel ?? nestedSetting?.root ?? "").trim().toLowerCase();
  const salesLevel = firstPositiveNumber(payload.salesLevel);
  if (qps != null && qps <= 1) return "unverified-like";
  if (userLevel === "free" || salesLevel === 1) return "unverified-like";
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
  const nestedSetting = getNestedSetting(payload);
  const quotaLimits = getQuotaLimits(payload);
  const settingsQuota = quotaLimits.find((entry) => cleanString(entry.quotaUrl) === "/setting/get") ?? quotaLimits[0] ?? null;
  const quotaLimit = firstPositiveNumber(payload?.quota, payload?.dayQuota, payload?.monthQuota, settingsQuota?.quotaLimit);
  const quotaRemaining =
    firstPositiveNumber(payload?.remainingQuota) ??
    (() => {
      const used = firstPositiveNumber(payload?.usedQuota, settingsQuota?.requestedNum);
      return quotaLimit != null && used != null ? Math.max(0, quotaLimit - used) : null;
    })();

  return {
    raw: payload,
    qpsLimit: firstPositiveNumber(payload?.qps, payload?.apiQps, payload?.limitQps, nestedSetting?.qpsLimit),
    quotaLimit,
    quotaRemaining,
    userLevel: cleanString(payload?.userLevel) ?? cleanString(payload?.apiLevel) ?? cleanString(payload?.root),
    salesLevel: cleanString(payload?.salesLevel),
    sandbox: parseNullableBoolean(payload?.sandbox) ?? parseNullableBoolean(payload?.isSandbox),
    operationalState: inferOperationalState(payload),
  };
}

export async function getCjShops(): Promise<CjShopSummary[]> {
  const wrapped = await cjRequest<CjShopSummary[] | Record<string, unknown>>({
    method: "GET",
    path: "/shop/getShops",
    operation: "cj.shop.getShops",
    cacheTtlMs: 60_000,
  });
  const data = wrapped?.data;
  if (Array.isArray(data)) return data;
  const possibleLists = [data?.list, data?.records, data?.content];
  for (const value of possibleLists) {
    if (Array.isArray(value)) return value as CjShopSummary[];
  }
  return [];
}
