import {
  pgTable,
  uuid,
  text,
  timestamp,
  date,
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

export const listings = pgTable(
  "listings",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    candidateId: uuid("candidate_id").notNull(),
    marketplaceKey: text("marketplace_key").notNull(),
    status: text("status").notNull().default("PREVIEW"),

    title: text("title").notNull(),
    price: numeric("price", { precision: 12, scale: 2 }).notNull(),
    quantity: integer("quantity").notNull().default(1),

    payload: jsonb("payload").notNull(),
    response: jsonb("response").$type<unknown>(),
    publishMarketplace: text("publish_marketplace"),
    publishStartedTs: timestamp("publish_started_ts"),
    publishFinishedTs: timestamp("publish_finished_ts"),
    publishedExternalId: text("published_external_id"),
    publishAttemptCount: integer("publish_attempt_count").notNull().default(0),
    lastPublishError: text("last_publish_error"),
    listingDate: date("listing_date"),

    idempotencyKey: text("idempotency_key").notNull(),

    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => ({
    listingsCandidateIdx: index("listings_candidate_idx").on(t.candidateId),
    listingsMarketplaceStatusIdx: index("listings_marketplace_status_idx").on(
      t.marketplaceKey,
      t.status
    ),
    listingsUniqueIdempotencyKey: uniqueIndex("listings_unique_idempotency_key").on(
      t.idempotencyKey
    ),
  })
);

export const marketplacePrices = pgTable(
  "marketplace_prices",
  {
    id: uuid("id").defaultRandom().primaryKey(),

    marketplaceKey: text("marketplace_key").notNull(),
    marketplaceListingId: text("marketplace_listing_id").notNull(),

    productRawId: uuid("product_raw_id"),
    supplierKey: text("supplier_key"),
    supplierProductId: text("supplier_product_id"),

    trendMode: boolean("trend_mode").notNull().default(true),
    searchQuery: text("search_query"),
    matchedTitle: text("matched_title"),

    productPageUrl: text("product_page_url"),
    imageUrl: text("image_url"),
    currency: text("currency").notNull(),
    price: numeric("price", { precision: 12, scale: 2 }).notNull(),
    shippingPrice: numeric("shipping_price", { precision: 12, scale: 2 }),
    isPrime: boolean("is_prime"),
    availabilityStatus: text("availability_status"),
    sellerId: text("seller_id"),
    sellerName: text("seller_name"),

    titleSimilarityScore: numeric("title_similarity_score", { precision: 6, scale: 4 }),
    keywordScore: numeric("keyword_score", { precision: 6, scale: 4 }),
    finalMatchScore: numeric("final_match_score", { precision: 6, scale: 4 }),

    rawPayload: jsonb("raw_payload").notNull(),
    snapshotTs: timestamp("snapshot_ts").notNull().defaultNow(),
  },
  (t) => ({
    marketplacePricesListingIdx: index("marketplace_prices_listing_idx").on(
      t.marketplaceKey,
      t.marketplaceListingId
    ),
    marketplacePricesProductIdx: index("marketplace_prices_product_idx").on(t.productRawId),
    marketplacePricesScoreIdx: index("marketplace_prices_score_idx").on(t.finalMatchScore),
    marketplacePricesSnapshotIdx: index("marketplace_prices_snapshot_idx").on(t.snapshotTs),
  })
);

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
  approvedTs: timestamp("approved_ts"),
  approvedBy: text("approved_by"),
  listingEligible: boolean("listing_eligible").notNull().default(false),
  listingEligibleTs: timestamp("listing_eligible_ts"),
  listingBlockReason: text("listing_block_reason"),
});

export const listingDailyCaps = pgTable(
  "listing_daily_caps",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    marketplaceKey: text("marketplace_key").notNull(),
    capDate: timestamp("cap_date").notNull(),
    capLimit: integer("cap_limit").notNull(),
    capUsed: integer("cap_used").notNull().default(0),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => ({
    listingDailyCapsMarketplaceDateUnique: uniqueIndex("listing_daily_caps_marketplace_date_unique").on(
      t.marketplaceKey,
      t.capDate
    ),
    listingDailyCapsMarketplaceIdx: index("listing_daily_caps_marketplace_idx").on(t.marketplaceKey),
  })
);

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
  priorityScore: numeric("priority_score", { precision: 6, scale: 4 }).notNull().default("0"),
  status: text("status").notNull().default("NEW"),
  createdTs: timestamp("created_ts").notNull().defaultNow(),
  meta: jsonb("meta").$type<unknown>(),
});

export const productCandidates = pgTable(
  "product_candidates",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    candidateId: uuid("candidate_id").notNull(),
    productTitle: text("product_title").notNull(),
    marketplace: text("marketplace").notNull(),
    marketplaceListingId: text("marketplace_listing_id").notNull(),
    price: numeric("price", { precision: 12, scale: 2 }).notNull(),
    currency: text("currency").notNull().default("USD"),
    productUrl: text("product_url"),
    source: text("source").notNull().default("stub"),
    status: text("status").notNull().default("DISCOVERED"),
    discoveredTs: timestamp("discovered_ts").notNull().defaultNow(),
    meta: jsonb("meta").$type<unknown>(),
  },
  (t) => ({
    productCandidatesCandidateIdx: index("product_candidates_candidate_idx").on(t.candidateId),
    productCandidatesMarketplaceIdx: index("product_candidates_marketplace_idx").on(t.marketplace),
    productCandidatesUniqueListing: uniqueIndex("product_candidates_unique_listing").on(
      t.candidateId,
      t.marketplace,
      t.marketplaceListingId
    ),
  })
);

export const queryBudgets = pgTable(
  "query_budgets",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    source: text("source").notNull(),
    period: text("period").notNull(),
    maxQueries: integer("max_queries").notNull(),
    usedQueries: integer("used_queries").notNull().default(0),
    resetAt: timestamp("reset_at").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    queryBudgetsSourcePeriodUnique: uniqueIndex("query_budgets_source_period_unique").on(t.source, t.period),
  })
);

export const queryTasks = pgTable(
  "query_tasks",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    candidateId: uuid("candidate_id").notNull(),
    marketplace: text("marketplace").notNull(),
    priorityScore: numeric("priority_score", { precision: 6, scale: 4 }).notNull(),
    status: text("status").notNull().default("NEW"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    queuedAt: timestamp("queued_at"),
    startedAt: timestamp("started_at"),
    finishedAt: timestamp("finished_at"),
    lastError: text("last_error"),
  },
  (t) => ({
    queryTasksStatusPriorityIdx: index("query_tasks_status_priority_idx").on(t.status, t.priorityScore),
    queryTasksMarketplaceStatusIdx: index("query_tasks_marketplace_status_idx").on(t.marketplace, t.status),
    queryTasksUniqueCandidateMarketplace: uniqueIndex("query_tasks_unique_candidate_marketplace").on(
      t.candidateId,
      t.marketplace
    ),
  })
);

export const queryCache = pgTable(
  "query_cache",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    keyword: text("keyword").notNull(),
    marketplace: text("marketplace").notNull(),
    lastRunAt: timestamp("last_run_at").notNull().defaultNow(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    queryCacheUniqueKeywordMarketplace: uniqueIndex("query_cache_unique_keyword_marketplace").on(
      t.keyword,
      t.marketplace
    ),
    queryCacheMarketplaceLastRunIdx: index("query_cache_marketplace_last_run_idx").on(t.marketplace, t.lastRunAt),
  })
);

export const workerRuns = pgTable(
  "worker_runs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    worker: text("worker").notNull(),
    jobName: text("job_name").notNull(),
    jobId: text("job_id").notNull(),
    status: text("status").notNull(),
    durationMs: integer("duration_ms"),
    ok: boolean("ok").notNull().default(false),
    error: text("error"),
    stats: jsonb("stats").$type<unknown>(),
    startedAt: timestamp("started_at").notNull().defaultNow(),
    finishedAt: timestamp("finished_at"),
  },
  (t) => ({
    workerRunsStartedIdx: index("worker_runs_started_idx").on(t.startedAt),
    workerRunsStatusIdx: index("worker_runs_status_idx").on(t.status),
    workerRunsJobIdx: index("worker_runs_job_idx").on(t.jobName, t.jobId),
  })
);

export const orders = pgTable(
  "orders",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    marketplace: text("marketplace").notNull(),
    marketplaceOrderId: text("marketplace_order_id").notNull(),
    buyerName: text("buyer_name"),
    buyerCountry: text("buyer_country"),
    totalPrice: numeric("total_price", { precision: 12, scale: 2 }),
    currency: text("currency").notNull().default("USD"),
    status: text("status").notNull().default("NEW"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => ({
    ordersMarketplaceIdx: index("orders_marketplace_idx").on(t.marketplace),
    ordersStatusIdx: index("orders_status_idx").on(t.status),
    ordersUniqueMarketplaceOrder: uniqueIndex("orders_marketplace_marketplace_order_unique").on(
      t.marketplace,
      t.marketplaceOrderId
    ),
    ordersMarketplaceOrderIdx: index("orders_marketplace_marketplace_order_idx").on(
      t.marketplace,
      t.marketplaceOrderId
    ),
  })
);

export const orderItems = pgTable(
  "order_items",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    listingId: uuid("listing_id").references(() => listings.id, { onDelete: "set null" }),
    supplierKey: text("supplier_key"),
    supplierProductId: text("supplier_product_id"),
    quantity: integer("quantity").notNull(),
    itemPrice: numeric("item_price", { precision: 12, scale: 2 }).notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    orderItemsOrderIdIdx: index("order_items_order_id_idx").on(t.orderId),
    orderItemsListingIdIdx: index("order_items_listing_id_idx").on(t.listingId),
  })
);

export const orderEvents = pgTable(
  "order_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    eventType: text("event_type").notNull(),
    eventTs: timestamp("event_ts").notNull().defaultNow(),
    details: jsonb("details").$type<unknown>(),
  },
  (t) => ({
    orderEventsOrderIdIdx: index("order_events_order_id_idx").on(t.orderId),
    orderEventsEventTypeIdx: index("order_events_event_type_idx").on(t.eventType),
  })
);

export const supplierOrders = pgTable(
  "supplier_orders",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    supplierKey: text("supplier_key").notNull(),
    attemptNo: integer("attempt_no").notNull().default(1),
    supplierOrderRef: text("supplier_order_ref"),
    purchaseStatus: text("purchase_status").notNull(),
    trackingNumber: text("tracking_number"),
    trackingStatus: text("tracking_status").notNull().default("NOT_AVAILABLE"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => ({
    supplierOrdersOrderIdIdx: index("supplier_orders_order_id_idx").on(t.orderId),
    supplierOrdersPurchaseStatusIdx: index("supplier_orders_purchase_status_idx").on(
      t.purchaseStatus
    ),
    supplierOrdersTrackingStatusIdx: index("supplier_orders_tracking_status_idx").on(
      t.trackingStatus
    ),
    supplierOrdersOrderSupplierAttemptUnique: uniqueIndex(
      "supplier_orders_order_supplier_attempt_unique"
    ).on(t.orderId, t.supplierKey, t.attemptNo),
  })
);

export type OrderRow = typeof orders.$inferSelect;
export type OrderInsert = typeof orders.$inferInsert;
export type OrderItemRow = typeof orderItems.$inferSelect;
export type OrderItemInsert = typeof orderItems.$inferInsert;
export type OrderEventRow = typeof orderEvents.$inferSelect;
export type OrderEventInsert = typeof orderEvents.$inferInsert;
export type SupplierOrderRow = typeof supplierOrders.$inferSelect;
export type SupplierOrderInsert = typeof supplierOrders.$inferInsert;
