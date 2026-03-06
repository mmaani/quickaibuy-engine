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

export function generateCandidateKeywords(normalized: string): string[] {
  if (!normalized) return [];

  const out: string[] = [];
  const base = normalized;

  const commonSuffixes = [
    "usb",
    "rechargeable",
    "travel",
    "mini",
    "compact",
    "wireless",
    "portable",
    "best",
  ];

  const variants: string[] = [base];

  if (base.includes("blender")) {
    variants.push(base.replace(/\bblender\b/g, "smoothie blender"));
    variants.push(base.replace(/\bblender\b/g, "mini blender"));
  }

  if (base.startsWith("portable ")) {
    variants.push(base.replace(/^portable\s+/, "travel "));
    variants.push(base.replace(/^portable\s+/, "mini "));
  }

  for (const variant of uniqKeepOrder(variants)) {
    out.push(variant);

    for (const suffix of commonSuffixes) {
      out.push(`${variant} ${suffix}`);
    }
  }

  if (base === "portable blender") {
    out.push("portable blender usb");
    out.push("portable blender rechargeable");
    out.push("portable blender travel");
    out.push("mini smoothie blender");
    out.push("usb smoothie blender");
  }

  return uniqKeepOrder(out);
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
  const candidates = generateCandidateKeywords(normalizedKeyword);

  let insertedCount = 0;

  for (const candidate of candidates) {
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
        ${candidate},
        ${region},
        'NEW',
        NOW(),
        ${JSON.stringify({ source: "trend-expansion" })}::jsonb
      WHERE NOT EXISTS (
        SELECT 1
        FROM trend_candidates tc
        WHERE tc.trend_signal_id = ${trendSignalId}
          AND tc.candidate_type = 'keyword'
          AND lower(trim(tc.candidate_value)) = lower(trim(${candidate}))
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
    generatedCount: candidates.length,
    insertedCount,
    candidates,
  };
}
