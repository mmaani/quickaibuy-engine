import { buildVerifyEbayListingPrompt } from "./prompts/verifyEbayListing";
import {
  LISTING_PACK_LOW_CONFIDENCE_THRESHOLD,
  LISTING_SPECIFIC_KEYS,
  type ListingPackOutput,
  type ListingSpecificKey,
  type VerifiedListingPackOutput,
  validateVerifiedListingPackOutput,
} from "./schemas";
import { sanitizeTitleForEbay } from "@/lib/listings/optimizeListingTitle";

const OPENAI_API_URL = "https://api.openai.com/v1/responses";
const DEFAULT_MODEL = "gpt-4.1-mini";

type VerifyListingPackInput = {
  generatedPack: ListingPackOutput;
  supplierTitle: string | null;
  supplierFeatures: string[];
  supplierRawPayload: unknown;
  supplierMediaMetadata: Record<string, unknown>;
  matchedMarketplaceEvidence: Record<string, unknown>;
  pricingEconomicsSummary: Record<string, unknown>;
  heuristicCategory: {
    categoryId: string | null;
    categoryName: string | null;
    confidence: number | null;
    ruleLabel: string | null;
  };
};
export type VerifyListingPackInputShape = VerifyListingPackInput;

export type VerifyListingPackResult =
  | {
      ok: true;
      pack: VerifiedListingPackOutput;
      diagnostics: Record<string, unknown>;
    }
  | {
      ok: false;
      reviewRequired: true;
      reason: string;
      diagnostics: Record<string, unknown>;
    };

function normalizeApiKey(): string {
  return String(process.env.OPENAI_API_KEY ?? "").trim();
}

function cleanString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeText(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, round2(value)));
}

function collectEvidenceStrings(value: unknown, acc: string[], depth = 0): void {
  if (depth > 4 || value == null) return;
  if (typeof value === "string") {
    const cleaned = value.trim();
    if (cleaned.length > 0) acc.push(cleaned);
    return;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    acc.push(String(value));
    return;
  }
  if (Array.isArray(value)) {
    for (const entry of value.slice(0, 40)) collectEvidenceStrings(entry, acc, depth + 1);
    return;
  }
  if (typeof value === "object") {
    for (const [key, entry] of Object.entries(value).slice(0, 60)) {
      acc.push(key);
      collectEvidenceStrings(entry, acc, depth + 1);
    }
  }
}

export function buildEvidenceCorpus(input: VerifyListingPackInput): { summary: string[]; normalized: string } {
  const evidence: string[] = [];
  if (input.supplierTitle) evidence.push(input.supplierTitle);
  evidence.push(...input.supplierFeatures);
  collectEvidenceStrings(input.supplierRawPayload, evidence);
  collectEvidenceStrings(input.supplierMediaMetadata, evidence);
  collectEvidenceStrings(input.matchedMarketplaceEvidence, evidence);
  if (input.heuristicCategory.categoryId) evidence.push(input.heuristicCategory.categoryId);
  if (input.heuristicCategory.categoryName) evidence.push(input.heuristicCategory.categoryName);
  if (input.heuristicCategory.ruleLabel) evidence.push(input.heuristicCategory.ruleLabel);

  const summary = Array.from(new Set(evidence.map((entry) => entry.trim()).filter((entry) => entry.length > 0))).slice(
    0,
    120
  );
  return {
    summary,
    normalized: normalizeText(summary.join(" ")),
  };
}

function isEvidenceBacked(value: string | null, corpus: string): boolean {
  if (!value) return false;
  const normalized = normalizeText(value);
  if (normalized.length < 2) return false;
  return corpus.includes(normalized);
}

function removeClaimFromText(text: string, claim: string): string {
  const trimmedClaim = claim.trim();
  if (!text || !trimmedClaim) return text;
  const escaped = trimmedClaim.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return text
    .replace(new RegExp(`\\b${escaped}\\b`, "gi"), "")
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([,.;:])/g, "$1")
    .trim();
}

function sanitizeSpecifics(
  itemSpecifics: Record<ListingSpecificKey, string | null>,
  evidenceCorpus: string
): {
  itemSpecifics: Record<ListingSpecificKey, string | null>;
  removedClaims: string[];
  correctedFields: string[];
} {
  const sanitized = { ...itemSpecifics };
  const removedClaims: string[] = [];
  const correctedFields: string[] = [];

  for (const key of LISTING_SPECIFIC_KEYS) {
    const value = sanitized[key];
    if (!value) continue;
    if (!isEvidenceBacked(value, evidenceCorpus)) {
      sanitized[key] = null;
      removedClaims.push(`${key}: ${value}`);
      correctedFields.push(`verified_item_specifics.${key}`);
    }
  }

  return {
    itemSpecifics: sanitized,
    removedClaims,
    correctedFields,
  };
}

function sanitizeTextFields(input: {
  title: string;
  bulletPoints: string[];
  description: string;
  unsupportedClaims: string[];
}): {
  title: string;
  bulletPoints: string[];
  description: string;
  correctedFields: string[];
} {
  let title = input.title;
  let description = input.description;
  let bulletPoints = [...input.bulletPoints];
  const correctedFields: string[] = [];

  for (const claim of input.unsupportedClaims) {
    const value = claim.includes(":") ? claim.split(":").slice(1).join(":").trim() : claim.trim();
    const nextTitle = removeClaimFromText(title, value);
    if (nextTitle !== title) {
      title = nextTitle;
      correctedFields.push("verified_title");
    }
    const nextDescription = removeClaimFromText(description, value);
    if (nextDescription !== description) {
      description = nextDescription;
      correctedFields.push("verified_description");
    }
    const nextBullets = bulletPoints.map((bullet) => removeClaimFromText(bullet, value)).filter((bullet) => bullet.length > 0);
    if (JSON.stringify(nextBullets) !== JSON.stringify(bulletPoints)) {
      bulletPoints = nextBullets;
      correctedFields.push("verified_bullet_points");
    }
  }

  if (bulletPoints.length < 3) {
    const fallbackBullets = Array.from(
      new Set(
        description
          .split(/[\n.]/)
          .map((entry) => entry.trim())
          .filter((entry) => entry.length > 10)
      )
    ).slice(0, 4);
    if (fallbackBullets.length >= 3) {
      bulletPoints = fallbackBullets;
      correctedFields.push("verified_bullet_points");
    }
  }

  return {
    title: sanitizeTitleForEbay(title, description),
    bulletPoints,
    description,
    correctedFields,
  };
}

function chooseVerifiedCategory(
  generatedPack: ListingPackOutput,
  heuristicCategory: VerifyListingPackInput["heuristicCategory"],
  evidenceCorpus: string
): {
  verifiedCategoryId: string;
  verifiedCategoryName: string;
  correctedFields: string[];
  riskFlags: string[];
} {
  const correctedFields: string[] = [];
  const riskFlags: string[] = [];
  const generatedIdBacked = isEvidenceBacked(generatedPack.category_id, evidenceCorpus);
  const generatedNameBacked = isEvidenceBacked(generatedPack.category_name, evidenceCorpus);
  const heuristicStrong =
    Boolean(heuristicCategory.categoryId) &&
    Boolean(heuristicCategory.categoryName) &&
    typeof heuristicCategory.confidence === "number" &&
    heuristicCategory.confidence >= LISTING_PACK_LOW_CONFIDENCE_THRESHOLD;
  const generatedConflictsWithHeuristic =
    heuristicStrong &&
    (cleanString(heuristicCategory.categoryId) !== cleanString(generatedPack.category_id) ||
      cleanString(heuristicCategory.categoryName).toLowerCase() !== cleanString(generatedPack.category_name).toLowerCase());

  if (generatedConflictsWithHeuristic) {
    correctedFields.push("verified_category_id", "verified_category_name");
    riskFlags.push("CATEGORY_STABILITY_HEURISTIC_LOCK");
    return {
      verifiedCategoryId: cleanString(heuristicCategory.categoryId),
      verifiedCategoryName: cleanString(heuristicCategory.categoryName),
      correctedFields,
      riskFlags,
    };
  }

  if (generatedIdBacked || generatedNameBacked) {
    return {
      verifiedCategoryId: generatedPack.category_id,
      verifiedCategoryName: generatedPack.category_name,
      correctedFields,
      riskFlags,
    };
  }

  if (heuristicStrong) {
    correctedFields.push("verified_category_id", "verified_category_name");
    riskFlags.push("CATEGORY_EVIDENCE_CONFLICT");
    return {
      verifiedCategoryId: cleanString(heuristicCategory.categoryId),
      verifiedCategoryName: cleanString(heuristicCategory.categoryName),
      correctedFields,
      riskFlags,
    };
  }

  riskFlags.push("CATEGORY_EVIDENCE_WEAK");
  return {
    verifiedCategoryId: generatedPack.category_id,
    verifiedCategoryName: generatedPack.category_name,
    correctedFields,
    riskFlags,
  };
}

export function applyEvidenceBackedListingCorrections(rawPack: unknown, input: VerifyListingPackInput) {
  const validation = validateVerifiedListingPackOutput(rawPack);
  if (!validation.ok) return validation;

  const evidence = buildEvidenceCorpus(input);
  const sanitizedSpecifics = sanitizeSpecifics(validation.data.verified_item_specifics, evidence.normalized);
  const unsupportedClaims = Array.from(
    new Set([...validation.data.removed_claims, ...sanitizedSpecifics.removedClaims])
  );
  const sanitizedText = sanitizeTextFields({
    title: validation.data.verified_title,
    bulletPoints: validation.data.verified_bullet_points,
    description: validation.data.verified_description,
    unsupportedClaims,
  });
  const category = chooseVerifiedCategory(input.generatedPack, input.heuristicCategory, evidence.normalized);
  const correctedFields = Array.from(
    new Set([
      ...validation.data.corrected_fields,
      ...sanitizedSpecifics.correctedFields,
      ...sanitizedText.correctedFields,
      ...category.correctedFields,
    ])
  );
  const removedClaims = unsupportedClaims;
  const verifiedCategoryMatchesGenerated =
    cleanString(category.verifiedCategoryId) === cleanString(input.generatedPack.category_id) &&
    cleanString(category.verifiedCategoryName) === cleanString(input.generatedPack.category_name);
  const riskFlags = Array.from(
    new Set(
      [...validation.data.risk_flags, ...category.riskFlags].filter((flag) => {
        if (!verifiedCategoryMatchesGenerated) return true;
        return flag !== "CATEGORY_EVIDENCE_CONFLICT";
      })
    )
  );
  const supportedSpecificCount = LISTING_SPECIFIC_KEYS.filter((key) => Boolean(sanitizedSpecifics.itemSpecifics[key])).length;
  const supportedSpecificRatio = supportedSpecificCount / LISTING_SPECIFIC_KEYS.length;
  const generatedOverallConfidence = clamp01(input.generatedPack.confidence.overall);
  const generatedSpecificsConfidence = clamp01(input.generatedPack.confidence.specifics);
  const coverageConfidence = clamp01(
    0.35 +
      Math.min(0.2, sanitizedText.bulletPoints.length * 0.03) +
      Math.min(0.2, supportedSpecificRatio * 0.4) +
      (verifiedCategoryMatchesGenerated ? 0.15 : 0) +
      (removedClaims.length <= 2 ? 0.1 : removedClaims.length <= 4 ? 0.05 : 0)
  );
  const verificationConfidence = clamp01(
    validation.data.verification_confidence * 0.2 +
      generatedOverallConfidence * 0.4 +
      generatedSpecificsConfidence * 0.2 +
      coverageConfidence * 0.2
  );
  if (verificationConfidence < LISTING_PACK_LOW_CONFIDENCE_THRESHOLD) {
    riskFlags.push("VERIFICATION_CONFIDENCE_LOW");
  }
  const reviewRequired = verificationConfidence < LISTING_PACK_LOW_CONFIDENCE_THRESHOLD
    || riskFlags.includes("CATEGORY_EVIDENCE_WEAK")
    || riskFlags.includes("LISTING_VERIFICATION_FAILED");

  return {
    ok: true as const,
    data: {
      verified_title: sanitizedText.title || input.generatedPack.optimized_title,
      verified_category_id: category.verifiedCategoryId || input.generatedPack.category_id,
      verified_category_name: category.verifiedCategoryName || input.generatedPack.category_name,
      verified_bullet_points:
        sanitizedText.bulletPoints.length >= 3 ? sanitizedText.bulletPoints : input.generatedPack.bullet_points,
      verified_description: sanitizedText.description || input.generatedPack.description,
      verified_item_specifics: sanitizedSpecifics.itemSpecifics,
      removed_claims: removedClaims,
      corrected_fields: correctedFields,
      risk_flags: Array.from(new Set(riskFlags)),
      verification_confidence: verificationConfidence,
      review_required: reviewRequired,
    },
  };
}

function buildFallbackVerifiedPack(input: VerifyListingPackInput) {
  return applyEvidenceBackedListingCorrections(
    {
      verified_title: input.generatedPack.optimized_title,
      verified_category_id: input.generatedPack.category_id,
      verified_category_name: input.generatedPack.category_name,
      verified_bullet_points: input.generatedPack.bullet_points,
      verified_description: input.generatedPack.description,
      verified_item_specifics: input.generatedPack.item_specifics,
      removed_claims: [],
      corrected_fields: [],
      risk_flags: ["VERIFICATION_FALLBACK_APPLIED"],
      verification_confidence: Math.min(0.79, input.generatedPack.confidence.overall),
      review_required: true,
    },
    input
  );
}

async function callOpenAi(prompt: string): Promise<unknown> {
  const apiKey = normalizeApiKey();
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is missing while listing verification is enabled");
  }

  const model = String(process.env.OPENAI_LISTING_VERIFY_MODEL ?? process.env.OPENAI_LISTING_MODEL ?? DEFAULT_MODEL).trim() ||
    DEFAULT_MODEL;

  const response = await fetch(OPENAI_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      input: [
        {
          role: "system",
          content: [{ type: "input_text", text: "You verify AI-generated eBay listing packs against source evidence." }],
        },
        {
          role: "user",
          content: [{ type: "input_text", text: prompt }],
        },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "verified_ebay_listing_pack",
          strict: true,
          schema: {
            type: "object",
            additionalProperties: false,
            required: [
              "verified_title",
              "verified_category_id",
              "verified_category_name",
              "verified_bullet_points",
              "verified_description",
              "verified_item_specifics",
              "removed_claims",
              "corrected_fields",
              "risk_flags",
              "verification_confidence",
              "review_required",
            ],
            properties: {
              verified_title: { type: "string" },
              verified_category_id: { type: "string" },
              verified_category_name: { type: "string" },
              verified_bullet_points: { type: "array", items: { type: "string" } },
              verified_description: { type: "string" },
              verified_item_specifics: {
                type: "object",
                additionalProperties: false,
                required: LISTING_SPECIFIC_KEYS,
                properties: Object.fromEntries(
                  LISTING_SPECIFIC_KEYS.map((key) => [key, { type: ["string", "null"] }])
                ),
              },
              removed_claims: { type: "array", items: { type: "string" } },
              corrected_fields: { type: "array", items: { type: "string" } },
              risk_flags: { type: "array", items: { type: "string" } },
              verification_confidence: { type: "number" },
              review_required: { type: "boolean" },
            },
          },
        },
      },
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`OpenAI listing verification failed (${response.status}): ${body.slice(0, 400)}`);
  }

  const parsed = (await response.json()) as Record<string, unknown>;
  const outputText =
    typeof parsed.output_text === "string" && parsed.output_text.trim().length > 0
      ? parsed.output_text
      : Array.isArray(parsed.output)
        ? (() => {
            for (const output of parsed.output) {
              if (!output || typeof output !== "object") continue;
              const content = (output as { content?: unknown }).content;
              if (!Array.isArray(content)) continue;
              for (const part of content) {
                if (!part || typeof part !== "object") continue;
                const textPart = (part as { text?: unknown }).text;
                if (typeof textPart === "string" && textPart.trim().length > 0) return textPart;
              }
            }
            return null;
          })()
        : null;

  if (!outputText) {
    throw new Error("OpenAI listing verification returned no parseable JSON text");
  }

  return JSON.parse(outputText);
}

export async function verifyListingPack(input: VerifyListingPackInput): Promise<VerifyListingPackResult> {
  const evidence = buildEvidenceCorpus(input);
  try {
    const prompt = buildVerifyEbayListingPrompt({
      generatedPack: input.generatedPack,
      supplierTitle: input.supplierTitle,
      supplierFeatures: input.supplierFeatures,
      supplierRawPayload: input.supplierRawPayload,
      supplierMediaMetadata: input.supplierMediaMetadata,
      matchedMarketplaceEvidence: input.matchedMarketplaceEvidence,
      pricingEconomicsSummary: input.pricingEconomicsSummary,
      heuristicCategory: input.heuristicCategory,
      evidenceSummary: evidence.summary,
    });
    const raw = await callOpenAi(prompt);
    const reconciled = applyEvidenceBackedListingCorrections(raw, input);
    if (!reconciled.ok) {
      return {
        ok: false,
        reviewRequired: true,
        reason: `LISTING_VERIFICATION_SCHEMA_FAILED: ${reconciled.errors.join("; ")}`,
        diagnostics: {
          schemaPassed: false,
          evidenceCount: evidence.summary.length,
        },
      };
    }

    return {
      ok: true,
      pack: reconciled.data,
      diagnostics: {
        schemaPassed: true,
        correctedFields: reconciled.data.corrected_fields,
        removedClaims: reconciled.data.removed_claims,
        riskFlags: reconciled.data.risk_flags,
        evidenceCount: evidence.summary.length,
      },
    };
  } catch (error) {
    const fallback = buildFallbackVerifiedPack(input);
    if (!fallback.ok) {
      return {
        ok: false,
        reviewRequired: true,
        reason: error instanceof Error ? error.message : "LISTING_VERIFICATION_FAILED",
        diagnostics: {
          schemaPassed: false,
          evidenceCount: evidence.summary.length,
        },
      };
    }

    return {
      ok: true,
      pack: fallback.data,
      diagnostics: {
        schemaPassed: true,
        fallbackApplied: true,
        fallbackReason: error instanceof Error ? error.message : "LISTING_VERIFICATION_FAILED",
        correctedFields: fallback.data.corrected_fields,
        removedClaims: fallback.data.removed_claims,
        riskFlags: fallback.data.risk_flags,
        evidenceCount: evidence.summary.length,
      },
    };
  }
}
