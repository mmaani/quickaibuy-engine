import { sql } from "drizzle-orm";
import { db } from "@/lib/db";

export type LearningFreshnessState = "fresh" | "warn" | "error";

export type LearningFreshnessDomainKey =
  | "supplier_intelligence"
  | "shipping_intelligence"
  | "category_intelligence"
  | "product_profile_intelligence"
  | "marketplace_fit_intelligence"
  | "opportunity_scores"
  | "control_plane_scorecards";

export type LearningFreshnessDomain = {
  key: LearningFreshnessDomainKey;
  label: string;
  warnAfterHours: number;
  errorAfterHours: number;
  lastUpdatedAt: string | null;
  ageHours: number | null;
  state: LearningFreshnessState;
  visibleWarning: string;
  autonomyImpact: "allow" | "degrade" | "pause";
  staleMarksScorecards: boolean;
};

export type LearningFreshnessOverview = {
  generatedAt: string;
  domains: LearningFreshnessDomain[];
  staleDomainCount: number;
  warningDomainCount: number;
  staleScorecardsVisible: boolean;
  autonomyPauseReasons: string[];
};

type FreshnessPolicy = {
  key: LearningFreshnessDomainKey;
  label: string;
  warnAfterHours: number;
  errorAfterHours: number;
  lookup: { table: "learning_evidence_events" | "learning_features"; filterSql: string };
  visibleWarning: string;
  autonomyImpact: "allow" | "degrade" | "pause";
  staleMarksScorecards: boolean;
};

const FRESHNESS_POLICIES: FreshnessPolicy[] = [
  {
    key: "supplier_intelligence",
    label: "Supplier intelligence",
    warnAfterHours: 12,
    errorAfterHours: 24,
    lookup: {
      table: "learning_features",
      filterSql: "subject_type = 'supplier' and feature_key = 'supplier_reliability_score'",
    },
    visibleWarning: "Supplier scorecards are aging out of SLA and should not silently steer automation.",
    autonomyImpact: "pause",
    staleMarksScorecards: true,
  },
  {
    key: "shipping_intelligence",
    label: "Shipping intelligence",
    warnAfterHours: 8,
    errorAfterHours: 18,
    lookup: {
      table: "learning_evidence_events",
      filterSql: "evidence_type = 'shipping_quote'",
    },
    visibleWarning: "Shipping truth is stale; publish and purchase decisions must remain fail-closed.",
    autonomyImpact: "pause",
    staleMarksScorecards: true,
  },
  {
    key: "category_intelligence",
    label: "Category intelligence",
    warnAfterHours: 12,
    errorAfterHours: 30,
    lookup: {
      table: "learning_features",
      filterSql: "subject_type = 'category' and feature_key = 'category_opportunity_score'",
    },
    visibleWarning: "Category opportunity rankings are stale and should be visibly marked.",
    autonomyImpact: "degrade",
    staleMarksScorecards: true,
  },
  {
    key: "product_profile_intelligence",
    label: "Product profile intelligence",
    warnAfterHours: 12,
    errorAfterHours: 30,
    lookup: {
      table: "learning_features",
      filterSql: "subject_type = 'product_profile' and feature_key = 'product_profile_opportunity_score'",
    },
    visibleWarning: "Product-profile intelligence has drifted beyond SLA.",
    autonomyImpact: "degrade",
    staleMarksScorecards: true,
  },
  {
    key: "marketplace_fit_intelligence",
    label: "Marketplace-fit intelligence",
    warnAfterHours: 12,
    errorAfterHours: 30,
    lookup: {
      table: "learning_features",
      filterSql: "subject_type = 'marketplace_fit' and feature_key = 'marketplace_fit_score'",
    },
    visibleWarning: "Marketplace-fit recommendations are stale and should not look current in the control plane.",
    autonomyImpact: "degrade",
    staleMarksScorecards: true,
  },
  {
    key: "opportunity_scores",
    label: "Opportunity scores",
    warnAfterHours: 6,
    errorAfterHours: 18,
    lookup: {
      table: "learning_features",
      filterSql: "subject_type = 'opportunity_candidate' and feature_key = 'opportunity_score'",
    },
    visibleWarning: "Opportunity rankings are stale; review prioritization should react defensively.",
    autonomyImpact: "pause",
    staleMarksScorecards: true,
  },
  {
    key: "control_plane_scorecards",
    label: "Control-plane scorecards",
    warnAfterHours: 4,
    errorAfterHours: 12,
    lookup: {
      table: "learning_features",
      filterSql: "subject_type = 'control_plane' and feature_key = 'scorecard_freshness_health'",
    },
    visibleWarning: "Control-plane scorecards are stale and should be marked before operators trust them.",
    autonomyImpact: "degrade",
    staleMarksScorecards: true,
  },
];

function computeAgeHours(lastUpdatedAt: string | null): number | null {
  if (!lastUpdatedAt) return null;
  const ts = new Date(lastUpdatedAt).getTime();
  if (!Number.isFinite(ts)) return null;
  return (Date.now() - ts) / (60 * 60 * 1000);
}

function classifyFreshness(ageHours: number | null, policy: FreshnessPolicy): LearningFreshnessState {
  if (ageHours == null) return "error";
  if (ageHours >= policy.errorAfterHours) return "error";
  if (ageHours >= policy.warnAfterHours) return "warn";
  return "fresh";
}

async function getLatestUpdatedAt(policy: FreshnessPolicy): Promise<string | null> {
  const column = policy.lookup.table === "learning_features" ? "updated_at" : "observed_at";
  const result = await db.execute<{ ts: string | null }>(sql.raw(`
    select max(${column}) as ts
    from ${policy.lookup.table}
    where ${policy.lookup.filterSql}
  `));
  const raw = result.rows?.[0]?.ts;
  return raw ? String(raw) : null;
}

export async function getLearningFreshnessOverview(): Promise<LearningFreshnessOverview> {
  const domains: LearningFreshnessDomain[] = [];

  for (const policy of FRESHNESS_POLICIES) {
    const lastUpdatedAt = await getLatestUpdatedAt(policy);
    const ageHours = computeAgeHours(lastUpdatedAt);
    const state = classifyFreshness(ageHours, policy);
    domains.push({
      key: policy.key,
      label: policy.label,
      warnAfterHours: policy.warnAfterHours,
      errorAfterHours: policy.errorAfterHours,
      lastUpdatedAt,
      ageHours,
      state,
      visibleWarning: policy.visibleWarning,
      autonomyImpact: state === "error" ? policy.autonomyImpact : state === "warn" ? "degrade" : "allow",
      staleMarksScorecards: policy.staleMarksScorecards,
    });
  }

  const staleDomains = domains.filter((domain) => domain.state === "error");
  const warningDomains = domains.filter((domain) => domain.state === "warn");

  return {
    generatedAt: new Date().toISOString(),
    domains,
    staleDomainCount: staleDomains.length,
    warningDomainCount: warningDomains.length,
    staleScorecardsVisible: domains.some((domain) => domain.state !== "fresh" && domain.staleMarksScorecards),
    autonomyPauseReasons: staleDomains
      .filter((domain) => domain.autonomyImpact === "pause")
      .map((domain) => `STALE_${domain.key.toUpperCase()}`),
  };
}
