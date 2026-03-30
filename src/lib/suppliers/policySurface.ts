import type {
  SupplierMonitoringPriority,
  SupplierStockClass,
  SupplierUsPriorityStatus,
} from "@/lib/suppliers/intelligence";

type PolicySurface = {
  stockClass: SupplierStockClass | null;
  stockConfidence: number | null;
  lowStockControlledRiskEligible: boolean;
  monitoringPriority: SupplierMonitoringPriority | null;
  warning: boolean;
  reject: boolean;
  policyReason: string | null;
  operatorMessage: string | null;
  usPriorityStatus: SupplierUsPriorityStatus | null;
  originAvailabilityRate: number | null;
  shippingTransparencyRate: number | null;
  deliveryEstimateMinDays: number | null;
  deliveryEstimateMaxDays: number | null;
  deliveryAcceptableForDestination: boolean | null;
  shippingOriginCountry: string | null;
  shippingOriginConfidence: number | null;
  shippingOriginValidity: string | null;
};

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value.trim());
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function asBoolean(value: unknown): boolean {
  return value === true || value === "true";
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function readSupplierPolicySurface(estimatedFees: unknown): PolicySurface {
  const fees = asObject(estimatedFees);
  const supplierPolicy = asObject(fees?.supplierPolicy);
  const selectedSupplierOption = asObject(fees?.selectedSupplierOption);
  const shippingBreakdown = asObject(fees?.shippingBreakdown);
  const stockClass = asString(supplierPolicy?.stockClass);
  const monitoringPriority = asString(supplierPolicy?.monitoringPriority);
  const usPriorityStatus = asString(supplierPolicy?.usPriorityStatus);

  return {
    stockClass:
      stockClass === "SAFE" || stockClass === "LOW" || stockClass === "CRITICAL" || stockClass === "UNKNOWN"
        ? stockClass
        : null,
    stockConfidence: asNumber(supplierPolicy?.stockConfidence),
    lowStockControlledRiskEligible: asBoolean(supplierPolicy?.lowStockControlledRiskEligible),
    monitoringPriority:
      monitoringPriority === "NORMAL" ||
      monitoringPriority === "PRIORITY_RECHECK" ||
      monitoringPriority === "URGENT_RECHECK"
        ? monitoringPriority
        : null,
    warning: asBoolean(supplierPolicy?.warning),
    reject: asBoolean(supplierPolicy?.reject),
    policyReason: asString(supplierPolicy?.policyReason),
    operatorMessage: asString(supplierPolicy?.operatorMessage),
    usPriorityStatus:
      usPriorityStatus === "US_ORIGIN_PREFERRED" ||
      usPriorityStatus === "KNOWN_NON_US_ORIGIN_ALLOWED" ||
      usPriorityStatus === "ORIGIN_UNRESOLVED_BLOCKED"
        ? usPriorityStatus
        : null,
    originAvailabilityRate: asNumber(supplierPolicy?.originAvailabilityRate),
    shippingTransparencyRate: asNumber(supplierPolicy?.shippingTransparencyRate),
    deliveryEstimateMinDays: asNumber(supplierPolicy?.deliveryEstimateMinDays),
    deliveryEstimateMaxDays: asNumber(supplierPolicy?.deliveryEstimateMaxDays),
    deliveryAcceptableForDestination:
      supplierPolicy?.deliveryAcceptableForDestination == null
        ? null
        : asBoolean(supplierPolicy?.deliveryAcceptableForDestination),
    shippingOriginCountry:
      asString(selectedSupplierOption?.shippingOriginCountry) ?? asString(shippingBreakdown?.originCountry),
    shippingOriginConfidence:
      asNumber(selectedSupplierOption?.shippingOriginConfidence) ?? asNumber(shippingBreakdown?.originConfidence),
    shippingOriginValidity:
      asString(selectedSupplierOption?.shippingOriginValidity) ?? asString(shippingBreakdown?.originValidity),
  };
}
