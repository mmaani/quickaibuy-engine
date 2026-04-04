import fs from "fs";
import path from "path";
import dotenv from "dotenv";

export type EnvBucket =
  | "required_startup"
  | "required_execution"
  | "optional_override"
  | "must_not_set"
  | "safe_alias";

export type EnvGroup = {
  id: string;
  bucket: EnvBucket;
  description: string;
  keys: string[];
};

export const PROD_BULL_PREFIX = "qaib-prod";
export const PROD_JOBS_QUEUE_NAME = "jobs-prod";

export const WORKER_REQUIRED_STARTUP_GROUPS: EnvGroup[] = [
  {
    id: "app_env",
    bucket: "required_startup",
    description: "Explicit production runtime classification for queue namespace safety.",
    keys: ["APP_ENV"],
  },
  {
    id: "node_env",
    bucket: "required_startup",
    description: "Production runtime mode for hosted worker execution.",
    keys: ["NODE_ENV"],
  },
  {
    id: "redis_url",
    bucket: "required_startup",
    description: "BullMQ Redis connection.",
    keys: ["REDIS_URL"],
  },
  {
    id: "database_url",
    bucket: "required_startup",
    description: "Worker database connection; either pooled or direct URL is accepted.",
    keys: ["DATABASE_URL", "DATABASE_URL_DIRECT"],
  },
  {
    id: "bull_prefix",
    bucket: "required_startup",
    description: "Explicit production Bull prefix required by queue namespace guardrails.",
    keys: ["BULL_PREFIX"],
  },
  {
    id: "jobs_queue_name",
    bucket: "required_startup",
    description: "Explicit production jobs queue name required by queue namespace guardrails.",
    keys: ["JOBS_QUEUE_NAME"],
  },
];

export const WORKER_REQUIRED_EXECUTION_GROUPS: EnvGroup[] = [
  {
    id: "website_url",
    bucket: "required_execution",
    description: "Required by LISTING_OPTIMIZE validation and image-hosting checks.",
    keys: ["WEBSITE_URL"],
  },
  {
    id: "ebay_client_id",
    bucket: "required_execution",
    description: "Required for eBay browse, analytics, recommendation, and listing APIs.",
    keys: ["EBAY_CLIENT_ID"],
  },
  {
    id: "ebay_client_secret",
    bucket: "required_execution",
    description: "Required for eBay OAuth token exchange.",
    keys: ["EBAY_CLIENT_SECRET"],
  },
  {
    id: "ebay_refresh_token",
    bucket: "required_execution",
    description: "Required for LISTING_OPTIMIZE sell-scope refresh flow.",
    keys: ["EBAY_REFRESH_TOKEN", "EBAY_USER_REFRESH_TOKEN"],
  },
  {
    id: "ebay_marketplace_id",
    bucket: "required_execution",
    description: "Pinned eBay marketplace target for search and listing performance APIs.",
    keys: ["EBAY_MARKETPLACE_ID"],
  },
  {
    id: "ebay_merchant_location_key",
    bucket: "required_execution",
    description: "Required by eBay publish/listing validation used by LISTING_OPTIMIZE.",
    keys: ["EBAY_MERCHANT_LOCATION_KEY", "EBAY_LOCATION_KEY"],
  },
  {
    id: "ebay_payment_policy_id",
    bucket: "required_execution",
    description: "Required by eBay listing validation used by LISTING_OPTIMIZE.",
    keys: ["EBAY_PAYMENT_POLICY_ID", "EBAY_POLICY_PAYMENT_ID"],
  },
  {
    id: "ebay_return_policy_id",
    bucket: "required_execution",
    description: "Required by eBay listing validation used by LISTING_OPTIMIZE.",
    keys: ["EBAY_RETURN_POLICY_ID", "EBAY_POLICY_RETURN_ID"],
  },
  {
    id: "ebay_fulfillment_policy_id",
    bucket: "required_execution",
    description: "Required by eBay listing validation used by LISTING_OPTIMIZE.",
    keys: [
      "EBAY_FULFILLMENT_POLICY_ID",
      "EBAY_POLICY_FULFILLMENT_ID",
      "EBAY_SHIPPING_POLICY_ID",
    ],
  },
  {
    id: "ebay_default_category_id",
    bucket: "required_execution",
    description: "Required by eBay listing validation used by LISTING_OPTIMIZE.",
    keys: ["EBAY_DEFAULT_CATEGORY_ID", "EBAY_CATEGORY_ID"],
  },
];

export const WORKER_OPTIONAL_OVERRIDE_GROUPS: EnvGroup[] = [
  {
    id: "inventory_risk_limit",
    bucket: "optional_override",
    description: "Recurring inventory-risk schedule batch size.",
    keys: ["INVENTORY_RISK_SCAN_LIMIT"],
  },
  {
    id: "order_sync_window",
    bucket: "optional_override",
    description: "Order sync batch size and lookback tuning.",
    keys: ["ORDER_SYNC_FETCH_LIMIT", "ORDER_SYNC_LOOKBACK_HOURS", "ORDER_SYNC_DEBUG"],
  },
  {
    id: "supplier_discover_limit",
    bucket: "optional_override",
    description: "Supplier discovery candidate batch sizing.",
    keys: ["SUPPLIER_DISCOVER_CANDIDATE_LIMIT"],
  },
  {
    id: "supplier_fetch_provider",
    bucket: "optional_override",
    description: "Optional provider-backed supplier crawl path for harder pages.",
    keys: ["SUPPLIER_FETCH_PROXY_URL", "SUPPLIER_FETCH_PROXY_TOKEN"],
  },
  {
    id: "supplier_scraping_provider",
    bucket: "optional_override",
    description: "Optional scraping provider credentials for supplier crawl fallback.",
    keys: ["ZENROWS_API_KEY", "SCRAPINGBEE_API_KEY"],
  },
  {
    id: "cj_provider",
    bucket: "optional_override",
    description: "CJ source coverage and discover tuning.",
    keys: ["CJ_API_KEY", "CJ_PLATFORM_TOKEN", "CJ_DISCOVER_COUNTRY_CODE", "CJ_DISCOVER_MIN_INVENTORY"],
  },
  {
    id: "marketplace_scan",
    bucket: "optional_override",
    description: "Marketplace scan thresholds, retry, and pacing.",
    keys: [
      "MARKETPLACE_MIN_PRICE_RATIO",
      "MARKETPLACE_MAX_PRICE_RATIO",
      "MARKETPLACE_QUERY_TIMEOUT_MS",
      "MARKETPLACE_QUERY_RETRIES",
      "MARKETPLACE_QUERY_BACKOFF_MS",
      "MARKETPLACE_MIN_MATCH_SCORE",
      "MARKETPLACE_QUERY_LIMIT",
      "MARKETPLACE_SCAN_DELAY_MS",
      "MARKETPLACE_ALLOW_TOP_RESULT_FALLBACK",
    ],
  },
  {
    id: "match_thresholds",
    bucket: "optional_override",
    description: "Product match scoring thresholds.",
    keys: [
      "MATCH_MIN_CONFIDENCE",
      "MATCH_MIN_MARKETPLACE_SCORE",
      "MATCH_MIN_OVERLAP",
      "PROFIT_MIN_MATCH_CONFIDENCE",
    ],
  },
  {
    id: "profit_thresholds",
    bucket: "optional_override",
    description: "Profit engine thresholds and eBay economics assumptions.",
    keys: [
      "MIN_ROI_PCT",
      "PROFIT_MIN_MARGIN_PCT",
      "PROFIT_EBAY_FEE_RATE_PCT",
      "PROFIT_PAYOUT_RESERVE_PCT",
      "PROFIT_PAYMENT_RESERVE_PCT",
      "PROFIT_FX_RESERVE_PCT",
      "PROFIT_SHIPPING_VARIANCE_PCT",
      "PROFIT_FIXED_COST_USD",
    ],
  },
  {
    id: "price_guard",
    bucket: "optional_override",
    description: "Price-guard thresholds for profitability and freshness.",
    keys: [
      "PRICE_GUARD_MAX_MARKETPLACE_SNAPSHOT_AGE_HOURS",
      "PRICE_GUARD_MAX_MARKET_SNAPSHOT_AGE_HOURS",
      "PRICE_GUARD_MIN_PROFIT_USD",
      "PRICE_GUARD_MIN_MARGIN_PCT",
      "PRICE_GUARD_MIN_ROI_PCT",
      "PRICE_GUARD_REVIEW_PROFIT_BUFFER_USD",
      "PRICE_GUARD_REVIEW_MARGIN_BUFFER_PCT",
      "PRICE_GUARD_REVIEW_ROI_BUFFER_PCT",
      "PRICE_GUARD_MAX_SUPPLIER_DRIFT_PCT",
      "PRICE_GUARD_MAX_SUPPLIER_SNAPSHOT_AGE_HOURS",
      "PRICE_GUARD_REQUIRE_SHIPPING_DATA",
      "PRICE_GUARD_REQUIRE_SUPPLIER_DRIFT_DATA",
    ],
  },
  {
    id: "listing_performance",
    bucket: "optional_override",
    description: "LISTING_OPTIMIZE tuning and rate-control knobs.",
    keys: [
      "LISTING_PERF_WINDOW_DAYS",
      "LISTING_PERF_MAX_ATTEMPTS",
      "LISTING_PERF_APPLY_LIVE_EDITS",
      "LISTING_LOW_TRAFFIC_VIEWS_THRESHOLD",
      "LISTING_PROMOTED_MAX_BID_PCT",
      "LISTING_PROMOTED_MAX_DELTA_PCT",
      "EBAY_SELLER_FEEDBACK_SCORE",
    ],
  },
  {
    id: "ai_listing",
    bucket: "optional_override",
    description: "AI preview generation stays opt-in and is only needed when preview generation runs on the worker.",
    keys: [
      "ENABLE_AI_LISTING_ENGINE",
      "OPENAI_API_KEY",
      "OPENAI_LISTING_MODEL",
      "EBAY_SELLER_ACCOUNT_TIER",
    ],
  },
  {
    id: "listing_media",
    bucket: "optional_override",
    description: "Image-hosting provider and API override settings.",
    keys: [
      "MEDIA_STORAGE_MODE",
      "EBAY_IMAGE_PROVIDER_DEFAULT",
      "EBAY_IMAGE_HOSTING_PROVIDER",
      "EBAY_IMAGE_PROVIDER_ALLOW_TRADING_FALLBACK",
      "EBAY_API_ROOT",
      "EBAY_TRADING_COMPATIBILITY_LEVEL",
      "EBAY_TRADING_SITE_ID",
    ],
  },
  {
    id: "safety_flags",
    bucket: "optional_override",
    description: "Safety flags that should remain explicitly fail-closed for this worker env.",
    keys: ["ENABLE_EBAY_LIVE_PUBLISH", "ENABLE_EBAY_TRACKING_SYNC"],
  },
  {
    id: "lead_notifications",
    bucket: "optional_override",
    description: "Optional lead notification sender/recipient overrides used by worker-side notifications.",
    keys: [
      "LEAD_NOTIFICATION_EMAIL_FROM",
      "LEAD_NOTIFICATION_EMAIL_TO",
      "LEAD_NOTIFICATION_WHATSAPP_TO",
      "RESEND_FROM_EMAIL",
    ],
  },
];

export const WORKER_SAFE_ALIAS_GROUPS: EnvGroup[] = [
  {
    id: "database_alias",
    bucket: "safe_alias",
    description: "Direct database URL may stand in for pooled database URL.",
    keys: ["DATABASE_URL_DIRECT"],
  },
  {
    id: "refresh_token_alias",
    bucket: "safe_alias",
    description: "Legacy eBay user refresh token alias.",
    keys: ["EBAY_USER_REFRESH_TOKEN"],
  },
  {
    id: "merchant_location_alias",
    bucket: "safe_alias",
    description: "Legacy merchant location alias.",
    keys: ["EBAY_LOCATION_KEY"],
  },
  {
    id: "payment_policy_alias",
    bucket: "safe_alias",
    description: "Legacy payment policy alias.",
    keys: ["EBAY_POLICY_PAYMENT_ID"],
  },
  {
    id: "return_policy_alias",
    bucket: "safe_alias",
    description: "Legacy return policy alias.",
    keys: ["EBAY_POLICY_RETURN_ID"],
  },
  {
    id: "fulfillment_policy_alias",
    bucket: "safe_alias",
    description: "Legacy fulfillment policy aliases.",
    keys: ["EBAY_POLICY_FULFILLMENT_ID", "EBAY_SHIPPING_POLICY_ID"],
  },
  {
    id: "default_category_alias",
    bucket: "safe_alias",
    description: "Legacy default category alias.",
    keys: ["EBAY_CATEGORY_ID"],
  },
  {
    id: "market_snapshot_alias",
    bucket: "safe_alias",
    description: "Legacy market snapshot age alias.",
    keys: ["PRICE_GUARD_MAX_MARKET_SNAPSHOT_AGE_HOURS"],
  },
];

export const WORKER_FORBIDDEN_KEYS = [
  "APP_URL",
  "NEXT_PUBLIC_APP_URL",
  "NX_DAEMON",
  "TURBO_CACHE",
  "TURBO_DOWNLOAD_LOCAL_ENABLED",
  "TURBO_REMOTE_ONLY",
  "TURBO_RUN_SUMMARY",
  "VERCEL",
  "VERCEL_GIT_COMMIT_AUTHOR_LOGIN",
  "VERCEL_GIT_COMMIT_AUTHOR_NAME",
  "VERCEL_GIT_COMMIT_MESSAGE",
  "VERCEL_GIT_COMMIT_REF",
  "VERCEL_GIT_COMMIT_SHA",
  "VERCEL_GIT_PREVIOUS_SHA",
  "VERCEL_GIT_PROVIDER",
  "VERCEL_GIT_PULL_REQUEST_ID",
  "VERCEL_GIT_REPO_ID",
  "VERCEL_GIT_REPO_OWNER",
  "VERCEL_GIT_REPO_SLUG",
  "VERCEL_OIDC_TOKEN",
  "VERCEL_TARGET_ENV",
  "VERCEL_URL",
];

export const WORKER_SUSPICIOUS_KEY_PATTERNS = [
  /^NEXT_PUBLIC_/,
  /^VERCEL(?:_|$)/,
  /^TURBO_/,
  /^NX_/,
];

export const WORKER_EXCLUDED_EXTRA_KEYS = [
  "ENGINE_QUEUE_NAME",
  "UPSTASH_REDIS_REST_TOKEN",
  "UPSTASH_REDIS_REST_URL",
  "REVIEW_CONSOLE_USERNAME",
  "REVIEW_CONSOLE_PASSWORD",
  "REVIEW_CONSOLE_TOKEN",
  "MARKETPLACE_FEE_PCT",
  "OTHER_COST_USD",
];

export const ALL_WORKER_GROUPS = [
  ...WORKER_REQUIRED_STARTUP_GROUPS,
  ...WORKER_REQUIRED_EXECUTION_GROUPS,
  ...WORKER_OPTIONAL_OVERRIDE_GROUPS,
  ...WORKER_SAFE_ALIAS_GROUPS,
];

export const APPROVED_WORKER_KEYS = Array.from(
  new Set(ALL_WORKER_GROUPS.flatMap((group) => group.keys))
);

export type BuildOptions = {
  sources: string[];
  outputPath: string;
};

export type ValidateIssue = {
  severity: "error" | "warning";
  code: string;
  message: string;
};

export type ValidationResult = {
  ok: boolean;
  issues: ValidateIssue[];
  parsed: Record<string, string>;
};

function fileExists(filePath: string): boolean {
  try {
    return fs.existsSync(filePath);
  } catch {
    return false;
  }
}

export function parseEnvFile(filePath: string): Record<string, string> {
  const abs = path.resolve(filePath);
  if (!fileExists(abs)) return {};
  return dotenv.parse(fs.readFileSync(abs, "utf8"));
}

export function readMergedEnv(files: string[]): Record<string, string> {
  const merged: Record<string, string> = {};
  for (const file of files) {
    const parsed = parseEnvFile(file);
    for (const [key, value] of Object.entries(parsed)) {
      if (!(key in merged)) {
        merged[key] = value;
      }
    }
  }
  return merged;
}

function hasNonEmpty(parsed: Record<string, string>, key: string): boolean {
  return String(parsed[key] ?? "").trim().length > 0;
}

function resolvePresentKey(parsed: Record<string, string>, keys: string[]): string | null {
  for (const key of keys) {
    if (hasNonEmpty(parsed, key)) return key;
  }
  return null;
}

function pushIssue(
  issues: ValidateIssue[],
  severity: "error" | "warning",
  code: string,
  message: string
) {
  issues.push({ severity, code, message });
}

export function validateWorkerEnv(parsed: Record<string, string>): ValidationResult {
  const issues: ValidateIssue[] = [];

  for (const group of [...WORKER_REQUIRED_STARTUP_GROUPS, ...WORKER_REQUIRED_EXECUTION_GROUPS]) {
    if (!resolvePresentKey(parsed, group.keys)) {
      pushIssue(
        issues,
        "error",
        "MISSING_REQUIRED",
        `Missing ${group.id}: expected ${group.keys.join(" or ")}. ${group.description}`
      );
    }
  }

  for (const key of WORKER_FORBIDDEN_KEYS) {
    if (key in parsed) {
      pushIssue(
        issues,
        "error",
        "FORBIDDEN_KEY",
        `Forbidden worker env key '${key}' is present. Do not copy platform/build/frontend vars into Railway worker env.`
      );
    }
  }

  for (const key of Object.keys(parsed)) {
    if (WORKER_SUSPICIOUS_KEY_PATTERNS.some((pattern) => pattern.test(key))) {
      pushIssue(
        issues,
        "warning",
        "SUSPICIOUS_KEY",
        `Suspicious worker env key '${key}' looks frontend/platform/build-only.`
      );
    }
  }

  const extras = Object.keys(parsed).filter(
    (key) =>
      !APPROVED_WORKER_KEYS.includes(key) &&
      !WORKER_FORBIDDEN_KEYS.includes(key) &&
      !WORKER_EXCLUDED_EXTRA_KEYS.includes(key) &&
      !WORKER_SUSPICIOUS_KEY_PATTERNS.some((pattern) => pattern.test(key))
  );
  for (const key of extras.sort()) {
    pushIssue(
      issues,
      "warning",
      "UNSCOPED_KEY",
      `Unscoped worker env key '${key}' is not in the approved Railway jobs worker allowlist.`
    );
  }

  const appEnv = String(parsed.APP_ENV ?? "").trim().toLowerCase();
  const nodeEnv = String(parsed.NODE_ENV ?? "").trim().toLowerCase();
  const bullPrefix = String(parsed.BULL_PREFIX ?? "").trim();
  const jobsQueueName = String(parsed.JOBS_QUEUE_NAME ?? "").trim();

  if (appEnv && appEnv !== "production" && appEnv !== "prod") {
    pushIssue(
      issues,
      "error",
      "APP_ENV_MISMATCH",
      `APP_ENV must be production for the Railway jobs worker, got '${parsed.APP_ENV}'.`
    );
  }
  if (nodeEnv && nodeEnv !== "production") {
    pushIssue(
      issues,
      "error",
      "NODE_ENV_MISMATCH",
      `NODE_ENV must be production for the Railway jobs worker, got '${parsed.NODE_ENV}'.`
    );
  }
  if (bullPrefix && bullPrefix !== PROD_BULL_PREFIX) {
    pushIssue(
      issues,
      "error",
      "QUEUE_NAMESPACE_MISMATCH",
      `BULL_PREFIX must be '${PROD_BULL_PREFIX}' for production worker isolation, got '${bullPrefix}'.`
    );
  }
  if (jobsQueueName && jobsQueueName !== PROD_JOBS_QUEUE_NAME) {
    pushIssue(
      issues,
      "error",
      "QUEUE_NAMESPACE_MISMATCH",
      `JOBS_QUEUE_NAME must be '${PROD_JOBS_QUEUE_NAME}' for production worker isolation, got '${jobsQueueName}'.`
    );
  }

  if (hasNonEmpty(parsed, "SUPPLIER_FETCH_PROXY_TOKEN") && !hasNonEmpty(parsed, "SUPPLIER_FETCH_PROXY_URL")) {
    pushIssue(
      issues,
      "warning",
      "INCOMPLETE_PROXY_CONFIG",
      "SUPPLIER_FETCH_PROXY_TOKEN is set but SUPPLIER_FETCH_PROXY_URL is missing."
    );
  }

  const livePublish = String(parsed.ENABLE_EBAY_LIVE_PUBLISH ?? "").trim().toLowerCase();
  if (livePublish === "true") {
    pushIssue(
      issues,
      "error",
      "UNSAFE_LIVE_PUBLISH",
      "ENABLE_EBAY_LIVE_PUBLISH must remain false for this Railway jobs worker workflow."
    );
  }

  const hasSupplierAcceleration = [
    "CJ_API_KEY",
    "SUPPLIER_FETCH_PROXY_URL",
    "ZENROWS_API_KEY",
    "SCRAPINGBEE_API_KEY",
  ].some((key) => hasNonEmpty(parsed, key));
  if (!hasSupplierAcceleration) {
    pushIssue(
      issues,
      "warning",
      "SUPPLIER_COVERAGE_REDUCED",
      "No supplier provider credentials are set. Worker startup is still valid, but supplier discovery coverage may be reduced."
    );
  }

  return {
    ok: !issues.some((issue) => issue.severity === "error"),
    issues,
    parsed,
  };
}

function renderSection(title: string, keys: string[]): string[] {
  return [`# ${title}`, ...keys.map((key) => `${key}=`), ""];
}

export function renderWorkerEnvExample(): string {
  return [
    "# Railway jobs worker environment template",
    "# Keys only. Fill values in Railway Variables RAW editor or generate a candidate file locally.",
    "",
    ...renderSection(
      "Required for Railway jobs worker startup",
      WORKER_REQUIRED_STARTUP_GROUPS.flatMap((group) => group.keys)
    ),
    ...renderSection(
      "Required for scheduled production job execution",
      WORKER_REQUIRED_EXECUTION_GROUPS.flatMap((group) => group.keys)
    ),
    ...renderSection(
      "Optional worker overrides and source credentials",
      WORKER_OPTIONAL_OVERRIDE_GROUPS.flatMap((group) => group.keys)
    ),
  ].join("\n");
}

export function buildWorkerEnvCandidate(options: BuildOptions): {
  outputPath: string;
  selectedKeys: string[];
  missingRequiredGroups: string[];
} {
  const merged = readMergedEnv(options.sources);
  const selectedKeys = APPROVED_WORKER_KEYS.filter((key) => hasNonEmpty(merged, key)).sort();
  const lines = [
    `# Generated from: ${options.sources.join(", ")}`,
    "# Worker-scoped env only. Review before pasting into Railway.",
    "",
    ...selectedKeys.map((key) => `${key}=${merged[key]}`),
    "",
  ];
  const outputPath = path.resolve(options.outputPath);
  fs.writeFileSync(outputPath, lines.join("\n"));

  const missingRequiredGroups = [...WORKER_REQUIRED_STARTUP_GROUPS, ...WORKER_REQUIRED_EXECUTION_GROUPS]
    .filter((group) => !resolvePresentKey(merged, group.keys))
    .map((group) => group.id);

  return {
    outputPath,
    selectedKeys,
    missingRequiredGroups,
  };
}
