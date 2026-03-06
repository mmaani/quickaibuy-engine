import {
  pgTable,
  uuid,
  text,
  timestamp,
  jsonb,
  numeric,
  boolean,
  integer,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export const productsRaw = pgTable("products_raw", {
  id: uuid("id").defaultRandom().primaryKey(),
  supplierKey: text("supplier_key").notNull(),
  supplierProductId: text("supplier_product_id").notNull(),
  sourceUrl: text("source_url"),
  title: text("title"),
  images: jsonb("images").$type<unknown[]>(),
  variants: jsonb("variants").$type<unknown[]>(),
  currency: text("currency"),
  priceMin: numeric("price_min"),
  priceMax: numeric("price_max"),
  availabilityStatus: text("availability_status"),
  shippingEstimates: jsonb("shipping_estimates").$type<unknown>(),
  rawPayload: jsonb("raw_payload").notNull(),
  snapshotTs: timestamp("snapshot_ts").notNull().defaultNow(),
});

export const marketplacePrices = pgTable("marketplace_prices", {
  id: uuid("id").defaultRandom().primaryKey(),
  marketplaceKey: text("marketplace_key").notNull(),
  marketplaceListingId: text("marketplace_listing_id").notNull(),
  productPageUrl: text("product_page_url"),
  currency: text("currency").notNull(),
  price: numeric("price").notNull(),
  shippingPrice: numeric("shipping_price"),
  isPrime: boolean("is_prime"),
  availabilityStatus: text("availability_status"),
  sellerId: text("seller_id"),
  sellerName: text("seller_name"),
  rawPayload: jsonb("raw_payload").notNull(),
  snapshotTs: timestamp("snapshot_ts").notNull().defaultNow(),
});

export const matches = pgTable("matches", {
  id: uuid("id").defaultRandom().primaryKey(),
  supplierKey: text("supplier_key").notNull(),
  supplierProductId: text("supplier_product_id").notNull(),
  marketplaceKey: text("marketplace_key").notNull(),
  marketplaceListingId: text("marketplace_listing_id").notNull(),
  matchType: text("match_type").notNull(),
  confidence: numeric("confidence").notNull(),
  evidence: jsonb("evidence").$type<unknown>(),
  status: text("status").notNull().default("ACTIVE"),
  firstSeenTs: timestamp("first_seen_ts").notNull().defaultNow(),
  lastSeenTs: timestamp("last_seen_ts").notNull().defaultNow(),
});

export const profitableCandidates = pgTable("profitable_candidates", {
  id: uuid("id").defaultRandom().primaryKey(),
  supplierKey: text("supplier_key").notNull(),
  supplierProductId: text("supplier_product_id").notNull(),
  marketplaceKey: text("marketplace_key").notNull(),
  marketplaceListingId: text("marketplace_listing_id").notNull(),
  calcTs: timestamp("calc_ts").notNull().defaultNow(),
  supplierSnapshotId: uuid("supplier_snapshot_id").notNull(),
  marketPriceSnapshotId: uuid("market_price_snapshot_id").notNull(),
  estimatedFees: jsonb("estimated_fees").$type<unknown>(),
  estimatedShipping: numeric("estimated_shipping"),
  estimatedCogs: numeric("estimated_cogs"),
  estimatedProfit: numeric("estimated_profit"),
  marginPct: numeric("margin_pct"),
  roiPct: numeric("roi_pct"),
  riskFlags: text("risk_flags").array(),
  decisionStatus: text("decision_status").notNull().default("PENDING"),
  reason: text("reason"),
});

export const auditLog = pgTable("audit_log", {
  id: uuid("id").defaultRandom().primaryKey(),
  eventTs: timestamp("event_ts").notNull().defaultNow(),
  actorType: text("actor_type").notNull(),
  actorId: text("actor_id"),
  entityType: text("entity_type").notNull(),
  entityId: text("entity_id").notNull(),
  eventType: text("event_type").notNull(),
  details: jsonb("details").$type<unknown>(),
});

export const jobs = pgTable(
  "jobs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    jobType: text("job_type").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    payload: jsonb("payload").notNull(),
    status: text("status").notNull(),
    priority: integer("priority").default(0),
    attempt: integer("attempt").default(0),
    maxAttempts: integer("max_attempts").default(5),
    scheduledTs: timestamp("scheduled_ts").defaultNow(),
    startedTs: timestamp("started_ts"),
    finishedTs: timestamp("finished_ts"),
    lastError: text("last_error"),
  },
  (t) => ({
    jobsUniqueTypeKey: uniqueIndex("jobs_unique_type_key").on(t.jobType, t.idempotencyKey),
  })
);

export const trendSignals = pgTable(
  "trend_signals",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    source: text("source").notNull(),
    signalType: text("signal_type").notNull(),
    signalValue: text("signal_value").notNull(),
    region: text("region"),
    score: numeric("score"),
    rawPayload: jsonb("raw_payload").$type<unknown>(),
    capturedTs: timestamp("captured_ts").notNull().defaultNow(),
  },
  (t) => ({
    trendSignalsSourceTs: index("trend_signals_source_ts").on(t.source, t.capturedTs),
  })
);

export const trendCandidates = pgTable("trend_candidates", {
  id: uuid("id").defaultRandom().primaryKey(),
  trendSignalId: uuid("trend_signal_id").notNull(),
  candidateType: text("candidate_type").notNull(),
  candidateValue: text("candidate_value").notNull(),
  region: text("region"),
  status: text("status").notNull().default("NEW"),
  createdTs: timestamp("created_ts").notNull().defaultNow(),
  meta: jsonb("meta").$type<unknown>(),
});
