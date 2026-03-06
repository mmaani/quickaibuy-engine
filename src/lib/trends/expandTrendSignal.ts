import { sql } from "drizzle-orm";
import { db } from "../db/index";

export type TrendSignalRow = {
  id: string;
  source: string;
  signal_type: string;
  signal_value: string;
  region: string | null;
  score: string | number | null;
  raw_payload: unknown;
  captured_ts: string;
};

export type ExpandTrendSignalResult = {
  trendSignalId: string;
  normalizedKeyword: string;
  region: string | null;
  generatedCount: number;
  insertedCount: number;
  candidates: string[];
};

type CandidatePlan = {
  keyword: string;
  score: number;
  category: string;
  subcategory: string;
  reasons: string[];
};

const MAX_CANDIDATES_PER_SIGNAL = 15;

const SOURCE_WEIGHT: Record<string, number> = {
  google_trends: 0.9,
  youtube: 0.85,
  tiktok: 0.8,
  manual: 0.7,
};

const SUFFIXES = ["usb", "rechargeable", "travel", "mini", "compact", "wireless", "best"];

const SYNONYM_MAP: Record<string, string[]> = {
  blender: ["smoothie blender", "smoothie maker", "personal blender", "juice blender"],
  portable: ["travel", "compact", "small"],
};

export function normalizeKeyword(input: string): string {
  return String(input ?? "")
    .toLowerCase()
    .trim()
    .replace(/[’']/g, "")
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function uniqKeepOrder(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];

  for (const value of values) {
    const normalized = normalizeKeyword(value);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }

  return out;
}

function hasWord(haystack: string, word: string): boolean {
  const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`\\b${escaped}\\b`).test(haystack);
}

function maybeAddSuffix(keyword: string, suffix: string): string | null {
  if (hasWord(keyword, suffix)) return null;
  return `${keyword} ${suffix}`;
}

function hasAnySuffixKeyword(keyword: string): boolean {
  return SUFFIXES.some((suffix) => hasWord(keyword, suffix));
}

function inferCategory(keyword: string): { category: string; subcategory: string } {
  if (/\b(blender|smoothie|juice)\b/.test(keyword)) {
    return { category: "kitchen appliance", subcategory: "blender" };
  }
  return { category: "general merchandise", subcategory: "unknown" };
}

function buildSynonymVariants(base: string): string[] {
  const variants: string[] = [base];

  for (const [token, synonyms] of Object.entries(SYNONYM_MAP)) {
    if (!hasWord(base, token)) continue;
    for (const synonym of synonyms) {
      variants.push(base.replace(new RegExp(`\\b${token}\\b`, "g"), synonym));
    }
  }

  if (base === "portable blender") {
    variants.push("mini smoothie blender");
    variants.push("usb smoothie blender");
  }

  return uniqKeepOrder(variants);
}

function parseNumericScore(input: string | number | null): number {
  if (typeof input === "number") return Number.isFinite(input) ? input : 0;
  if (typeof input === "string") {
    const n = Number(input);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

function rankCandidate(candidate: string, row: TrendSignalRow, base: string): number {
  const sourceWeight = SOURCE_WEIGHT[row.source] ?? 0.6;
  const trendScoreRaw = parseNumericScore(row.score);
  const trendScore = Math.max(0, Math.min(1, trendScoreRaw > 1 ? trendScoreRaw / 100 : trendScoreRaw));

  const exactBaseBoost = candidate === base ? 0.22 : 0;
  const startsWithBase = candidate.startsWith(base) ? 0.15 : 0;
  const semanticBoost = /\b(smoothie|personal|juice)\b/.test(candidate) ? 0.12 : 0;
  const commercialBoost = /\b(usb|rechargeable)\b/.test(candidate) ? 0.08 : 0;
  const noisyPenalty = /\bbest\b/.test(candidate) ? -0.08 : 0;

  const score =
    0.25 +
    sourceWeight * 0.35 +
    trendScore * 0.2 +
    exactBaseBoost +
    startsWithBase +
    semanticBoost +
    commercialBoost +
    noisyPenalty;
  return Math.max(0, Math.min(1, Number(score.toFixed(4))));
}

function buildCandidatePlan(base: string, row: TrendSignalRow): CandidatePlan[] {
  const variants = buildSynonymVariants(base);
  const candidateReasons = new Map<string, Set<string>>();

  const add = (keyword: string, reason: string) => {
    const normalized = normalizeKeyword(keyword);
    if (!normalized) return;
    if (!candidateReasons.has(normalized)) {
      candidateReasons.set(normalized, new Set());
    }
    candidateReasons.get(normalized)?.add(reason);
  };

  add(base, "base");

  for (const variant of variants) {
    add(variant, variant === base ? "base" : "synonym");

    if (hasAnySuffixKeyword(variant)) continue;

    for (const suffix of SUFFIXES) {
      const expanded = maybeAddSuffix(variant, suffix);
      if (expanded) add(expanded, `suffix:${suffix}`);
    }
  }

  const planned: CandidatePlan[] = [];
  for (const [keyword, reasons] of candidateReasons.entries()) {
    const { category, subcategory } = inferCategory(keyword);
    planned.push({
      keyword,
      score: rankCandidate(keyword, row, base),
      category,
      subcategory,
      reasons: [...reasons],
    });
  }

  planned.sort((a, b) => b.score - a.score || a.keyword.localeCompare(b.keyword));
  const top = planned.slice(0, MAX_CANDIDATES_PER_SIGNAL);
  if (!top.some((p) => p.keyword === base)) {
    const baseCandidate = planned.find((p) => p.keyword === base);
    if (baseCandidate) {
      top[top.length - 1] = baseCandidate;
    }
  }
  return uniqKeepOrder(top.map((p) => p.keyword))
    .map((keyword) => top.find((p) => p.keyword === keyword))
    .filter((p): p is CandidatePlan => Boolean(p));
}

export function generateCandidateKeywords(normalized: string): string[] {
  const fakeRow: TrendSignalRow = {
    id: "",
    source: "manual",
    signal_type: "keyword",
    signal_value: normalized,
    region: null,
    score: null,
    raw_payload: null,
    captured_ts: "",
  };
  return buildCandidatePlan(normalized, fakeRow).map((c) => c.keyword);
}

async function getTrendSignalById(trendSignalId: string): Promise<TrendSignalRow | null> {
  const result = await db.execute(sql<TrendSignalRow>`
    SELECT
      id,
      source,
      signal_type,
      signal_value,
      region,
      score,
      raw_payload,
      captured_ts
    FROM trend_signals
    WHERE id = ${trendSignalId}
    LIMIT 1
  `);

  const rows = ((result as unknown as { rows?: TrendSignalRow[] }).rows ?? []);
  return rows[0] ?? null;
}

export async function expandTrendSignal(trendSignalId: string): Promise<ExpandTrendSignalResult> {
  const row = await getTrendSignalById(trendSignalId);

  if (!row) {
    throw new Error(`trend_signal not found: ${trendSignalId}`);
  }

  const normalizedKeyword = normalizeKeyword(row.signal_value);

  if (!normalizedKeyword) {
    throw new Error(`trend_signal ${trendSignalId} has empty signal_value`);
  }

  const region = row.region ?? null;
  const candidatePlan = buildCandidatePlan(normalizedKeyword, row);

  let insertedCount = 0;

  for (const candidate of candidatePlan) {
    const insertResult = await db.execute(sql<{ id: string }>`
      INSERT INTO trend_candidates (
        id,
        trend_signal_id,
        candidate_type,
        candidate_value,
        region,
        status,
        created_ts,
        meta
      )
      SELECT
        gen_random_uuid(),
        ${trendSignalId},
        'keyword',
        ${candidate.keyword},
        ${region},
        'NEW',
        NOW(),
        ${JSON.stringify({
          source: "trend-expansion",
          category: candidate.category,
          subcategory: candidate.subcategory,
          priorityScore: candidate.score,
          reasons: candidate.reasons,
        })}::jsonb
      WHERE NOT EXISTS (
        SELECT 1
        FROM trend_candidates tc
        WHERE tc.trend_signal_id = ${trendSignalId}
          AND tc.candidate_type = 'keyword'
          AND lower(trim(tc.candidate_value)) = lower(trim(${candidate.keyword}))
          AND coalesce(tc.region, '') = coalesce(${region}, '')
      )
      RETURNING id
    `);

    const insertedRows = ((insertResult as unknown as { rows?: Array<{ id: string }> }).rows ?? []);
    insertedCount += insertedRows.length;
  }

  return {
    trendSignalId,
    normalizedKeyword,
    region,
    generatedCount: candidatePlan.length,
    insertedCount,
    candidates: candidatePlan.map((c) => c.keyword),
  };
}
