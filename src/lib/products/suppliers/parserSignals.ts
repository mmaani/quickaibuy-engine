import type { ShippingEstimate } from "./types";

const MAX_EVIDENCE_TEXT_LENGTH = 220;

export type SupplierListingValidity = "VALID" | "POSSIBLE_STALE" | "INVALID";
export type SupplierPriceSignal = "DIRECT" | "RANGE" | "FALLBACK" | "MISSING";
export type SupplierShippingSignal = "DIRECT" | "PARTIAL" | "INFERRED" | "MISSING";

function normalizeCountryCode(value: string): string | null {
  const normalized = compactText(value).toUpperCase();
  if (/^[A-Z]{2}$/.test(normalized)) return normalized;
  if (normalized === "USA" || normalized === "UNITED STATES") return "US";
  if (normalized === "UK" || normalized === "UNITED KINGDOM") return "GB";
  if (normalized === "CHINA") return "CN";
  if (normalized === "POLAND") return "PL";
  if (normalized === "GERMANY") return "DE";
  return null;
}

export function compactText(value: string): string {
  return String(value || "").replace(/\s+/g, " ").trim();
}

export function looksLikeProviderBlockPayload(value: string): boolean {
  const compact = compactText(value).toLowerCase();
  if (!compact) return false;
  return (
    compact.includes("securitycompromiseerror") ||
    compact.includes("\"code\":451") ||
    compact.includes("\"status\":45102") ||
    compact.includes("anonymous access to domain") ||
    compact.includes("blocked until")
  );
}

export function sliceEvidence(value: string, maxLength = MAX_EVIDENCE_TEXT_LENGTH): string {
  const compact = compactText(value);
  return compact.length <= maxLength ? compact : `${compact.slice(0, maxLength - 1)}...`;
}

export function extractPriceEvidence(rawText: string): {
  price: string | null;
  priceText: string | null;
  signal: SupplierPriceSignal;
} {
  const compact = compactText(rawText);
  if (!compact) {
    return { price: null, priceText: null, signal: "MISSING" };
  }

  const rangeMatch = compact.match(
    /\$?\s*([0-9]+(?:\.[0-9]{1,2})?)\s*(?:-|to)\s*\$?\s*([0-9]+(?:\.[0-9]{1,2})?)/
  );
  if (rangeMatch) {
    return {
      price: rangeMatch[1],
      priceText: sliceEvidence(rangeMatch[0]),
      signal: "RANGE",
    };
  }

  const directMatch = compact.match(
    /(?:price|us\$|usd|now|from|deal price|current price)?\s*[:=]?\s*\$([0-9]+(?:\.[0-9]{1,2})?)\b/i
  );
  if (directMatch) {
    return {
      price: directMatch[1],
      priceText: sliceEvidence(directMatch[0]),
      signal: "DIRECT",
    };
  }

  return { price: null, priceText: null, signal: "MISSING" };
}

export function extractShippingEvidence(rawText: string): {
  shippingEstimates: ShippingEstimate[];
  evidenceText: string | null;
  shipsFromHint: string | null;
  shipFromCountry: string | null;
  shipFromLocation: string | null;
  shippingGuarantee: string | null;
  signal: SupplierShippingSignal;
} {
  const compact = compactText(rawText);
  if (!compact) {
    return {
      shippingEstimates: [],
      evidenceText: null,
      shipsFromHint: null,
      shipFromCountry: null,
      shipFromLocation: null,
      shippingGuarantee: null,
      signal: "MISSING",
    };
  }

  const shippingTextMatch = compact.match(
    /(free shipping|shipping[:=]?\s*\$?\d+(?:\.\d{1,2})?|delivery[:=]?\s*\d+\s*(?:-|to)\s*\d+\s*(?:business\s*)?days|ships within\s+\d+\s+(?:business\s*)?days|arrives? (?:by|in|within)\s+[a-z0-9 ,\-]+|fast delivery|choice|aliexpress standard shipping|cainiao|e[- ]?packet|dollar express|standard shipping|us warehouse delivery)/i
  );
  const shipsFromMatch = compact.match(/ships from\s+([a-z][a-z ,.\-]{1,40})/i);
  const shipFromCountryMatch = compact.match(/ship(?:s|ping)? from\s+(united states|usa|us|china|cn|poland|pl|germany|de)\b/i);
  const warehouseMatch = compact.match(
    /(warehouse(?:s)?(?: in| service for product preparation, including warehouses in)?\s+[a-z][a-z ,.\-]{1,80})/i
  );
  const etaMatch = compact.match(
    /(?:delivery|ships within|arrives? in|arrival time(?: is)? within|estimated delivery time(?: in [a-z ]+)?(?: is|:)?|processing time(?: is|:)?|delivery time(?: is|:)?)\s*(?:within\s*)?(\d{1,2})(?:\s*(?:-|to)\s*(\d{1,2}))?\s*(?:business\s*)?days/i
  );
  const shippingCostMatch = compact.match(/shipping[:=]?\s*\$([0-9]+(?:\.[0-9]{1,2})?)/i);
  const methodMatch = compact.match(
    /(aliexpress standard shipping|cainiao[^|,.;]*|e[- ]?packet|dollar express|choice|us warehouse delivery|standard shipping|express shipping|fedex|ups|usps|dhl)/i
  );
  const freeShipping = /free shipping/i.test(compact);
  const shippingGuaranteeMatch = compact.match(
    /(buyer protection|refund if[^\s,.;]+|free returns|delivery guarantee|on-time guarantee)/i
  );
  const shipFromLocation = shipsFromMatch?.[1]
    ? sliceEvidence(shipsFromMatch[1])
    : warehouseMatch?.[1]
      ? sliceEvidence(warehouseMatch[1], 120)
      : null;
  const shipFromCountry = normalizeCountryCode(shipFromCountryMatch?.[1] ?? shipFromLocation ?? "");

  const estimate: ShippingEstimate | null =
    shippingTextMatch || etaMatch || shippingCostMatch || shipsFromMatch || methodMatch || shipFromCountryMatch
      ? {
          label: methodMatch?.[1]
            ? sliceEvidence(methodMatch[1])
            : shippingTextMatch?.[0]
              ? sliceEvidence(shippingTextMatch[0])
              : "shipping signal",
          cost: freeShipping ? "0" : shippingCostMatch?.[1] ?? null,
          currency: freeShipping || shippingCostMatch ? "USD" : null,
          etaMinDays: etaMatch ? Number(etaMatch[1]) : null,
          etaMaxDays: etaMatch ? Number(etaMatch[2] ?? etaMatch[1]) : null,
          ship_from_country: shipFromCountry,
          ship_from_location: shipFromLocation,
        }
      : null;

  return {
    shippingEstimates: estimate ? [estimate] : [],
    evidenceText: shippingTextMatch?.[0] ? sliceEvidence(shippingTextMatch[0]) : null,
    shipsFromHint: shipFromLocation,
    shipFromCountry,
    shipFromLocation,
    shippingGuarantee: shippingGuaranteeMatch?.[1] ? sliceEvidence(shippingGuaranteeMatch[1]) : null,
    signal: estimate
      ? etaMatch || shippingCostMatch || freeShipping
        ? "DIRECT"
        : shipFromCountry || methodMatch
          ? "PARTIAL"
        : "INFERRED"
      : "MISSING",
  };
}

export function inferListingValidity(rawText: string): {
  status: SupplierListingValidity;
  reason: string | null;
} {
  const compact = compactText(rawText).toLowerCase();
  if (!compact) {
    return { status: "POSSIBLE_STALE", reason: "empty evidence window" };
  }

  const invalidMatch = compact.match(
    /(item removed|listing removed|product unavailable|currently unavailable|store closed|seller unavailable|does not exist)/i
  );
  if (invalidMatch) {
    return { status: "INVALID", reason: sliceEvidence(invalidMatch[0]) };
  }

  const cautionMatch = compact.match(/(similar items|search result|sponsored|recommended)/i);
  const hasProductCardSignals =
    /(?:!\[image \d+:|https?:\/\/[^\s)]*(?:alicdn\.com|aliexpress-media\.com))/i.test(compact) &&
    /(###\s+[^\n$]{8,220}|\$[0-9]+(?:\.[0-9]{1,2})?|\b[0-5]\.[0-9]\b|\b[0-9][0-9,]*\+?\s+sold\b)/i.test(compact);
  if (cautionMatch && !hasProductCardSignals) {
    return { status: "POSSIBLE_STALE", reason: sliceEvidence(cautionMatch[0]) };
  }

  const staleMatch = compact.match(/(security verification|challenge|captcha)/i);
  if (staleMatch) {
    return { status: "POSSIBLE_STALE", reason: sliceEvidence(staleMatch[0]) };
  }

  return { status: "VALID", reason: null };
}
