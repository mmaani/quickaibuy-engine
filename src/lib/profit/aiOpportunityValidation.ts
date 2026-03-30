const OPENAI_API_URL = "https://api.openai.com/v1/responses";
const DEFAULT_MODEL = "gpt-4.1-mini";
const MAX_AI_VALIDATIONS_PER_RUN = 3;
const AMBIGUITY_MIN = 0.45;
const AMBIGUITY_MAX = 0.72;

type ValidationRequest = {
  candidateKey: string;
  supplierTitle: string;
  marketplaceTitle: string;
  ambiguityScore: number;
  estimatedProfitUsd: number;
};

export type AiOpportunityValidation = {
  used: boolean;
  sameProduct: boolean | null;
  brandAligned: boolean | null;
  productFormAligned: boolean | null;
  packSpecMismatch: boolean | null;
  confidence: number | null;
  explanation: string;
  source: "cache" | "openai" | "skipped";
};

type CachedValidation = {
  normalizedKey: string;
  result: AiOpportunityValidation;
  createdAt: number;
};

const productUnderstandingCache = new Map<string, string>();
const validationCache = new Map<string, CachedValidation>();

function normalize(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");
}

function normalizeKey(input: ValidationRequest): string {
  return `${normalize(input.supplierTitle)}|${normalize(input.marketplaceTitle)}`;
}

function aiEnabled(): boolean {
  return Boolean(String(process.env.OPENAI_API_KEY ?? "").trim());
}

function shouldValidate(input: ValidationRequest): boolean {
  return (
    input.ambiguityScore >= AMBIGUITY_MIN &&
    input.ambiguityScore <= AMBIGUITY_MAX &&
    input.estimatedProfitUsd >= 12
  );
}

export async function validateAmbiguousTopCandidates(
  inputs: ValidationRequest[]
): Promise<Record<string, AiOpportunityValidation>> {
  const results: Record<string, AiOpportunityValidation> = {};

  const queued = inputs
    .filter((entry) => shouldValidate(entry))
    .sort((a, b) => b.estimatedProfitUsd - a.estimatedProfitUsd)
    .slice(0, MAX_AI_VALIDATIONS_PER_RUN);

  for (const input of inputs) {
    if (!queued.some((entry) => entry.candidateKey === input.candidateKey)) {
      results[input.candidateKey] = {
        used: false,
        sameProduct: null,
        brandAligned: null,
        productFormAligned: null,
        packSpecMismatch: null,
        confidence: null,
        explanation: "Skipped AI validation: deterministic confidence not ambiguous/high-value enough.",
        source: "skipped",
      };
    }
  }

  for (const input of queued) {
    const normalizedKey = normalizeKey(input);
    const cached = validationCache.get(normalizedKey);
    if (cached) {
      results[input.candidateKey] = {
        ...cached.result,
        source: "cache",
      };
      continue;
    }

    if (!aiEnabled()) {
      results[input.candidateKey] = {
        used: false,
        sameProduct: null,
        brandAligned: null,
        productFormAligned: null,
        packSpecMismatch: null,
        confidence: null,
        explanation: "AI unavailable: OPENAI_API_KEY missing.",
        source: "skipped",
      };
      continue;
    }

    const supplierNormalized = productUnderstandingCache.get(normalize(input.supplierTitle)) ?? normalize(input.supplierTitle);
    productUnderstandingCache.set(normalize(input.supplierTitle), supplierNormalized);

    try {
      const response = await fetch(OPENAI_API_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${String(process.env.OPENAI_API_KEY ?? "").trim()}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: DEFAULT_MODEL,
          input: [
            {
              role: "system",
              content:
                "Return strict JSON only with: sameProduct, brandAligned, productFormAligned, packSpecMismatch, confidence, explanation.",
            },
            {
              role: "user",
              content: JSON.stringify({
                supplierTitle: supplierNormalized,
                marketplaceTitle: input.marketplaceTitle,
              }),
            },
          ],
          text: {
            format: {
              type: "json_schema",
              name: "candidate_validation",
              schema: {
                type: "object",
                additionalProperties: false,
                required: [
                  "sameProduct",
                  "brandAligned",
                  "productFormAligned",
                  "packSpecMismatch",
                  "confidence",
                  "explanation",
                ],
                properties: {
                  sameProduct: { type: "boolean" },
                  brandAligned: { type: "boolean" },
                  productFormAligned: { type: "boolean" },
                  packSpecMismatch: { type: "boolean" },
                  confidence: { type: "number", minimum: 0, maximum: 1 },
                  explanation: { type: "string", minLength: 3, maxLength: 220 },
                },
              },
            },
          },
        }),
      });

      if (!response.ok) throw new Error(`openai_status_${response.status}`);
      const data = (await response.json()) as {
        output_text?: string;
      };
      const parsed = JSON.parse(data.output_text ?? "{}");
      const result: AiOpportunityValidation = {
        used: true,
        sameProduct: Boolean(parsed.sameProduct),
        brandAligned: Boolean(parsed.brandAligned),
        productFormAligned: Boolean(parsed.productFormAligned),
        packSpecMismatch: Boolean(parsed.packSpecMismatch),
        confidence: typeof parsed.confidence === "number" ? parsed.confidence : null,
        explanation: typeof parsed.explanation === "string" ? parsed.explanation : "Validation completed.",
        source: "openai",
      };
      validationCache.set(normalizedKey, {
        normalizedKey,
        result,
        createdAt: Date.now(),
      });
      results[input.candidateKey] = result;
    } catch (error) {
      results[input.candidateKey] = {
        used: false,
        sameProduct: null,
        brandAligned: null,
        productFormAligned: null,
        packSpecMismatch: null,
        confidence: null,
        explanation: `AI validation skipped after error: ${error instanceof Error ? error.message : "unknown"}`,
        source: "skipped",
      };
    }
  }

  return results;
}
