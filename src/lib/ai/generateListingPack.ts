import { buildEbayListingPrompt } from "./prompts/ebayListing";
import {
  LISTING_PACK_LOW_CONFIDENCE_THRESHOLD,
  LISTING_SPECIFIC_KEYS,
  validateListingPackOutput,
  type ListingPackOutput,
} from "./schemas";

const OPENAI_API_URL = "https://api.openai.com/v1/responses";
const DEFAULT_MODEL = "gpt-4.1-mini";

type GenerateListingPackInput = {
  supplierTitle: string | null;
  supplierRawPayload: unknown;
  supplierFeatures: string[];
  supplierMediaMetadata: Record<string, unknown>;
  supplierVariants: Array<Record<string, unknown>>;
  matchedMarketplaceEvidence: Record<string, unknown>;
  pricingEconomicsSummary: Record<string, unknown>;
  sellerAccountTrustProfile: Record<string, unknown>;
  heuristicCategory: {
    categoryId: string | null;
    categoryName: string | null;
    confidence: number | null;
  };
};

export type GenerateListingPackResult =
  | {
      ok: true;
      pack: ListingPackOutput;
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

export function isAiListingEngineEnabled(): boolean {
  return String(process.env.ENABLE_AI_LISTING_ENGINE ?? "false").trim().toLowerCase() === "true";
}

async function callOpenAi(prompt: string): Promise<unknown> {
  const apiKey = normalizeApiKey();
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is missing while ENABLE_AI_LISTING_ENGINE=true");
  }

  const model = String(process.env.OPENAI_LISTING_MODEL ?? DEFAULT_MODEL).trim() || DEFAULT_MODEL;

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
          content: [{ type: "input_text", text: "You are an eBay listing pack generator." }],
        },
        {
          role: "user",
          content: [{ type: "input_text", text: prompt }],
        },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "ebay_listing_pack",
          strict: true,
          schema: {
            type: "object",
            additionalProperties: false,
            required: [
              "optimized_title",
              "category_id",
              "category_name",
              "bullet_points",
              "description",
              "item_specifics",
              "pricing_hint",
              "trust_flags",
              "review_required",
              "confidence",
            ],
            properties: {
              optimized_title: { type: "string" },
              category_id: { type: "string" },
              category_name: { type: "string" },
              bullet_points: { type: "array", items: { type: "string" } },
              description: { type: "string" },
              item_specifics: {
                type: "object",
                additionalProperties: false,
                required: LISTING_SPECIFIC_KEYS,
                properties: Object.fromEntries(
                  LISTING_SPECIFIC_KEYS.map((key) => [key, { type: ["string", "null"] }])
                ),
              },
              pricing_hint: { type: "string" },
              trust_flags: { type: "array", items: { type: "string" } },
              review_required: { type: "boolean" },
              confidence: {
                type: "object",
                additionalProperties: false,
                required: ["title", "category", "specifics", "overall"],
                properties: {
                  title: { type: "number" },
                  category: { type: "number" },
                  specifics: { type: "number" },
                  overall: { type: "number" },
                },
              },
            },
          },
        },
      },
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`OpenAI listing request failed (${response.status}): ${body.slice(0, 400)}`);
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
    throw new Error("OpenAI listing request returned no parseable JSON text");
  }

  return JSON.parse(outputText);
}

export async function generateListingPack(input: GenerateListingPackInput): Promise<GenerateListingPackResult> {
  try {
    const prompt = buildEbayListingPrompt(input);
    const raw = await callOpenAi(prompt);
    const validation = validateListingPackOutput(raw);

    if (!validation.ok) {
      return {
        ok: false,
        reviewRequired: true,
        reason: `LISTING_PACK_SCHEMA_FAILED: ${validation.errors.join("; ")}`,
        diagnostics: {
          schemaErrors: validation.errors,
          schemaPassed: false,
        },
      };
    }

    const confidence = validation.data.confidence;
    const lowConfidence =
      confidence.overall < LISTING_PACK_LOW_CONFIDENCE_THRESHOLD ||
      confidence.category < LISTING_PACK_LOW_CONFIDENCE_THRESHOLD ||
      confidence.title < LISTING_PACK_LOW_CONFIDENCE_THRESHOLD;

    if (lowConfidence) {
      return {
        ok: false,
        reviewRequired: true,
        reason: "LISTING_PACK_LOW_CONFIDENCE",
        diagnostics: {
          schemaPassed: true,
          lowConfidence: true,
          confidence,
        },
      };
    }

    return {
      ok: true,
      pack: validation.data,
      diagnostics: {
        schemaPassed: true,
        lowConfidence: false,
        confidence,
      },
    };
  } catch (error) {
    return {
      ok: false,
      reviewRequired: true,
      reason: error instanceof Error ? error.message : "LISTING_PACK_AI_FAILURE",
      diagnostics: {
        schemaPassed: false,
        lowConfidence: null,
      },
    };
  }
}
