import {
  pgTable,
  serial,
  text,
  integer,
  timestamp,
  jsonb,
  numeric,
  index,
} from "drizzle-orm/pg-core";

export const productsRaw = pgTable(
  "products_raw",
  {
    id: serial("id").primaryKey(),
    source: text("source").notNull(), // supplier/site identifier
    sourceUrl: text("source_url").notNull(),
    externalId: text("external_id"), // supplier SKU/id if available
    raw: jsonb("raw").notNull(),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    sourceIdx: index("products_raw_source_idx").on(t.source),
    sourceUrlIdx: index("products_raw_source_url_idx").on(t.sourceUrl),
    externalIdIdx: index("products_raw_external_id_idx").on(t.externalId),
  })
);

export const marketplacePrices = pgTable(
  "marketplace_prices",
  {
    id: serial("id").primaryKey(),
    marketplace: text("marketplace").notNull(), // amazon/ebay/etc
    productKey: text("product_key").notNull(), // internal key or normalized id
    listingUrl: text("listing_url").notNull(),
    price: numeric("price", { precision: 12, scale: 2 }).notNull(),
    currency: text("currency").notNull().default("USD"),
    raw: jsonb("raw").notNull(),
    observedAt: timestamp("observed_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    mpIdx: index("marketplace_prices_marketplace_idx").on(t.marketplace),
    keyIdx: index("marketplace_prices_product_key_idx").on(t.productKey),
  })
);

export const matches = pgTable(
  "matches",
  {
    id: serial("id").primaryKey(),
    rawProductId: integer("raw_product_id").notNull(), // products_raw.id
    marketplaceProductKey: text("marketplace_product_key").notNull(),
    score: numeric("score", { precision: 5, scale: 2 }).notNull(), // 0..100
    method: text("method").notNull().default("ai"),
    meta: jsonb("meta").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    rawIdx: index("matches_raw_product_id_idx").on(t.rawProductId),
    mpIdx: index("matches_marketplace_key_idx").on(t.marketplaceProductKey),
  })
);

export const profitableCandidates = pgTable(
  "profitable_candidates",
  {
    id: serial("id").primaryKey(),
    matchId: integer("match_id").notNull(), // matches.id
    buyPrice: numeric("buy_price", { precision: 12, scale: 2 }).notNull(),
    sellPrice: numeric("sell_price", { precision: 12, scale: 2 }).notNull(),
    fees: numeric("fees", { precision: 12, scale: 2 }).notNull().default("0"),
    shipping: numeric("shipping", { precision: 12, scale: 2 }).notNull().default("0"),
    profit: numeric("profit", { precision: 12, scale: 2 }).notNull(),
    marginPct: numeric("margin_pct", { precision: 7, scale: 2 }).notNull(),
    decision: text("decision").notNull().default("PENDING"), // PENDING/APPROVED/REJECTED
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    matchIdx: index("profitable_candidates_match_id_idx").on(t.matchId),
    decisionIdx: index("profitable_candidates_decision_idx").on(t.decision),
  })
);

export const trendSignals = pgTable(
  "trend_signals",
  {
    id: serial("id").primaryKey(),
    source: text("source").notNull(), // google_trends/tiktok/etc
    query: text("query").notNull(),
    score: numeric("score", { precision: 12, scale: 2 }).notNull(),
    raw: jsonb("raw").notNull(),
    observedAt: timestamp("observed_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    sourceIdx: index("trend_signals_source_idx").on(t.source),
    queryIdx: index("trend_signals_query_idx").on(t.query),
  })
);

export const trendCandidates = pgTable(
  "trend_candidates",
  {
    id: text("id").primaryKey(),
    trendSignalId: text("trend_signal_id").notNull(),
    candidateType: text("candidate_type").notNull(),
    candidateValue: text("candidate_value").notNull(),
    region: text("region"),
    status: text("status").notNull(),
    createdTs: timestamp("created_ts", { withTimezone: false }).notNull(),
    meta: jsonb("meta"),
    priorityScore: numeric("priority_score", { precision: 12, scale: 4 }).notNull(),
  },
  (t) => ({
    signalIdx: index("trend_candidates_trend_signal_id_idx").on(t.trendSignalId),
    typeIdx: index("trend_candidates_candidate_type_idx").on(t.candidateType),
    statusIdx: index("trend_candidates_status_idx").on(t.status),
  })
);

export const jobs = pgTable(
  "jobs",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull(),
    input: jsonb("input").notNull().default({}),
    status: text("status").notNull().default("QUEUED"), // QUEUED/RUNNING/SUCCEEDED/FAILED
    attempt: integer("attempt").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(3),
    lastError: text("last_error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    nameIdx: index("jobs_name_idx").on(t.name),
    statusIdx: index("jobs_status_idx").on(t.status),
  })
);

export const workerRuns = pgTable(
  "worker_runs",
  {
    id: serial("id").primaryKey(),
    worker: text("worker").notNull(), // engine.worker
    jobName: text("job_name").notNull(),
    jobId: text("job_id").notNull(),
    status: text("status").notNull(), // STARTED/SUCCEEDED/FAILED
    durationMs: integer("duration_ms"),
    error: text("error"),
    meta: jsonb("meta").notNull().default({}),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (t) => ({
    workerIdx: index("worker_runs_worker_idx").on(t.worker),
    jobNameIdx: index("worker_runs_job_name_idx").on(t.jobName),
  })
);

export const auditLog = pgTable(
  "audit_log",
  {
    id: serial("id").primaryKey(),
    actor: text("actor").notNull().default("system"),
    action: text("action").notNull(),
    entity: text("entity").notNull(),
    entityId: text("entity_id"),
    detail: jsonb("detail").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    actionIdx: index("audit_log_action_idx").on(t.action),
    entityIdx: index("audit_log_entity_idx").on(t.entity),
  })
);

export const listings = pgTable(
  "listings",
  {
    id: serial("id").primaryKey(),
    marketplace: text("marketplace").notNull(),
    marketplaceListingId: text("marketplace_listing_id"),
    candidateId: integer("candidate_id").notNull(), // profitable_candidates.id
    status: text("status").notNull().default("DRAFT"), // DRAFT/LISTED/FAILED
    url: text("url"),
    raw: jsonb("raw").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    mpIdx: index("listings_marketplace_idx").on(t.marketplace),
    statusIdx: index("listings_status_idx").on(t.status),
  })
);

export const orders = pgTable(
  "orders",
  {
    id: serial("id").primaryKey(),
    marketplace: text("marketplace").notNull(),
    marketplaceOrderId: text("marketplace_order_id").notNull(),
    status: text("status").notNull().default("NEW"),
    raw: jsonb("raw").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    mpIdx: index("orders_marketplace_idx").on(t.marketplace),
    mpOrderIdx: index("orders_marketplace_order_id_idx").on(t.marketplaceOrderId),
    statusIdx: index("orders_status_idx").on(t.status),
  })
);
