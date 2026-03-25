import type { ShippingEstimate } from "./types";

const MAX_EVIDENCE_TEXT_LENGTH = 220;

export type SupplierListingValidity = "VALID" | "POSSIBLE_STALE" | "INVALID";
export type SupplierPriceSignal = "DIRECT" | "RANGE" | "FALLBACK" | "MISSING";
export type SupplierShippingSignal = "DIRECT" | "INFERRED" | "MISSING";

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
  signal: SupplierShippingSignal;
} {
  const compact = compactText(rawText);
  if (!compact) {
    return {
      shippingEstimates: [],
      evidenceText: null,
      shipsFromHint: null,
      signal: "MISSING",
    };
  }

  const shippingTextMatch = compact.match(
    /(free shipping|shipping[:=]?\s*\$?\d+(?:\.\d{1,2})?|delivery[:=]?\s*\d+\s*(?:-|to)\s*\d+\s*days|ships within\s+\d+\s+days|arrives? (?:by|in)\s+[a-z0-9 ,\-]+|fast delivery|choice)/i
  );
  const shipsFromMatch = compact.match(/ships from\s+([a-z][a-z ,.\-]{1,40})/i);
  const etaMatch = compact.match(
    /(?:delivery|ships within|arrives? in)\s*(?:within\s*)?(\d{1,2})(?:\s*(?:-|to)\s*(\d{1,2}))?\s*days/i
  );
  const shippingCostMatch = compact.match(/shipping[:=]?\s*\$([0-9]+(?:\.[0-9]{1,2})?)/i);
  const freeShipping = /free shipping/i.test(compact);

  const estimate: ShippingEstimate | null =
    shippingTextMatch || etaMatch || shippingCostMatch || shipsFromMatch
      ? {
          label: shippingTextMatch?.[0] ? sliceEvidence(shippingTextMatch[0]) : "shipping signal",
          cost: freeShipping ? "0" : shippingCostMatch?.[1] ?? null,
          currency: freeShipping || shippingCostMatch ? "USD" : null,
          etaMinDays: etaMatch ? Number(etaMatch[1]) : null,
          etaMaxDays: etaMatch ? Number(etaMatch[2] ?? etaMatch[1]) : null,
        }
      : null;

  return {
    shippingEstimates: estimate ? [estimate] : [],
    evidenceText: shippingTextMatch?.[0] ? sliceEvidence(shippingTextMatch[0]) : null,
    shipsFromHint: shipsFromMatch?.[1] ? sliceEvidence(shipsFromMatch[1]) : null,
    signal: estimate
      ? etaMatch || shippingCostMatch || freeShipping
        ? "DIRECT"
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

  const staleMatch = compact.match(
    /(similar items|search result|sponsored|recommended|security verification|challenge|captcha)/i
  );
  if (staleMatch) {
    return { status: "POSSIBLE_STALE", reason: sliceEvidence(staleMatch[0]) };
  }

  return { status: "VALID", reason: null };
}
