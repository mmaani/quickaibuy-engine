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
import { sql } from "drizzle-orm";

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

    supplierKey: text("supplier_key"),
    supplierProductId: text("supplier_product_id"),
    linkageSource: text("linkage_source"),
    linkageVerifiedAt: timestamp("linkage_verified_at"),
    linkageDeterministic: boolean("linkage_deterministic").notNull().default(false),
    supplierLinkLocked: boolean("supplier_link_locked").notNull().default(false),

    supplierStockStatus: text("supplier_stock_status"),
    supplierStockQty: integer("supplier_stock_qty"),
    stockVerifiedAt: timestamp("stock_verified_at"),
    stockSource: text("stock_source"),
    stockCheckRequired: boolean("stock_check_required").notNull().default(true),
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

export const supplierShippingQuotes = pgTable(
  "supplier_shipping_quotes",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    supplierKey: text("supplier_key").notNull(),
    supplierProductId: text("supplier_product_id").notNull(),
    originCountry: text("origin_country"),
    destinationCountry: text("destination_country").notNull(),
    destinationRegion: text("destination_region"),
    serviceLevel: text("service_level").notNull().default("STANDARD"),
    shippingCost: numeric("shipping_cost", { precision: 12, scale: 2 }).notNull(),
    currency: text("currency").notNull().default("USD"),
    estimatedMinDays: integer("estimated_min_days"),
    estimatedMaxDays: integer("estimated_max_days"),
    confidence: numeric("confidence", { precision: 5, scale: 4 }),
    sourceType: text("source_type").notNull().default("supplier_snapshot"),
    weightTier: text("weight_tier"),
    sizeTier: text("size_tier"),
    lastVerifiedAt: timestamp("last_verified_at").notNull().defaultNow(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => ({
    supplierShippingQuotesLookupIdx: index("supplier_shipping_quotes_lookup_idx").on(
      t.supplierKey,
      t.supplierProductId,
      t.destinationCountry,
      t.serviceLevel
    ),
    supplierShippingQuotesDestinationIdx: index("supplier_shipping_quotes_destination_idx").on(
      t.destinationCountry,
      t.lastVerifiedAt
    ),
    supplierShippingQuotesUnique: uniqueIndex("supplier_shipping_quotes_unique").on(
      t.supplierKey,
      t.supplierProductId,
      t.destinationCountry,
      t.serviceLevel
    ),
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

export const sellerAccountMetrics = pgTable(
  "seller_account_metrics",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    marketplaceKey: text("marketplace_key").notNull(),
    feedbackScore: integer("feedback_score"),
    source: text("source"),
    rawPayload: jsonb("raw_payload").$type<unknown>(),
    fetchedAt: timestamp("fetched_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => ({
    sellerAccountMetricsMarketplaceUnique: uniqueIndex("seller_account_metrics_marketplace_unique").on(
      t.marketplaceKey
    ),
  })
);

export const ebayImageNormalizations = pgTable(
  "ebay_image_normalizations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    sourceUrl: text("source_url").notNull(),
    sourceHash: text("source_hash"),
    epsUrl: text("eps_url"),
    provider: text("provider").notNull(),
    status: text("status").notNull(),
    failureCode: text("failure_code"),
    failureReason: text("failure_reason"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => ({
    ebayImageNormalizationsSourceProviderUnique: uniqueIndex(
      "ebay_image_normalizations_source_provider_unique"
    ).on(t.sourceUrl, t.provider),
    ebayImageNormalizationsStatusIdx: index("ebay_image_normalizations_status_idx").on(
      t.status,
      t.updatedAt
    ),
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

export const leadSubmissions = pgTable(
  "lead_submissions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    fullName: text("full_name").notNull(),
    company: text("company"),
    email: text("email").notNull(),
    interest: text("interest").notNull(),
    message: text("message").notNull(),
    sourcePage: text("source_page").notNull().default("/"),
    status: text("status").notNull().default("NEW"),
    emailNotificationStatus: text("email_notification_status").notNull().default("PENDING"),
    whatsappNotificationStatus: text("whatsapp_notification_status").notNull().default("PENDING"),
    emailNotificationError: text("email_notification_error"),
    whatsappNotificationError: text("whatsapp_notification_error"),
    notifiedAt: timestamp("notified_at"),
    metadata: jsonb("metadata").$type<unknown>(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => ({
    leadSubmissionsCreatedIdx: index("lead_submissions_created_idx").on(t.createdAt),
    leadSubmissionsStatusIdx: index("lead_submissions_status_idx").on(t.status, t.createdAt),
    leadSubmissionsEmailIdx: index("lead_submissions_email_idx").on(t.email),
  })
);

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
    legacyListingId: uuid("listing_id"),
    legacyMarketplaceKey: text("marketplace_key"),
    legacyOrderId: text("order_id"),
    marketplace: text("marketplace").notNull(),
    marketplaceOrderId: text("marketplace_order_id").notNull(),
    buyerName: text("buyer_name"),
    buyerCountry: text("buyer_country"),
    legacyQuantity: integer("quantity"),
    legacyTotalAmount: numeric("total_amount", { precision: 12, scale: 2 }),
    legacyRawPayload: jsonb("raw_payload").$type<unknown>(),
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

export const customers = pgTable(
  "customers",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    marketplace: text("marketplace").notNull(),
    customerExternalId: text("customer_external_id"),
    buyerName: text("buyer_name"),
    buyerEmailNormalized: text("buyer_email_normalized"),
    city: text("city"),
    state: text("state"),
    country: text("country"),
    firstOrderAt: timestamp("first_order_at").notNull(),
    lastOrderAt: timestamp("last_order_at").notNull(),
    orderCount: integer("order_count").notNull().default(0),
    totalSpent: numeric("total_spent", { precision: 14, scale: 2 }).notNull().default("0"),
    currency: text("currency"),
    revenuePolicy: text("revenue_policy").notNull().default("ORDER_NATIVE_UNNORMALIZED"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => ({
    customersMarketplaceIdx: index("customers_marketplace_idx").on(t.marketplace),
    customersCountryCityIdx: index("customers_country_city_idx").on(t.country, t.city),
    customersEmailUnique: uniqueIndex("customers_marketplace_email_unique")
      .on(t.marketplace, t.buyerEmailNormalized)
      .where(sql`${t.buyerEmailNormalized} is not null`),
    customersExternalUnique: uniqueIndex("customers_marketplace_external_unique")
      .on(t.marketplace, t.customerExternalId)
      .where(sql`${t.customerExternalId} is not null`),
  })
);

export const customerOrders = pgTable(
  "customer_orders",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "cascade" }),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    marketplace: text("marketplace").notNull(),
    mergeSource: text("merge_source").notNull(),
    identityConfidence: text("identity_confidence").notNull(),
    resolutionMethod: text("resolution_method").notNull(),
    buyerEmailNormalized: text("buyer_email_normalized"),
    customerExternalId: text("customer_external_id"),
    buyerNameSnapshot: text("buyer_name_snapshot"),
    citySnapshot: text("city_snapshot"),
    stateSnapshot: text("state_snapshot"),
    countrySnapshot: text("country_snapshot"),
    orderCreatedAt: timestamp("order_created_at").notNull(),
    orderTotal: numeric("order_total", { precision: 12, scale: 2 }),
    orderCurrency: text("order_currency"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => ({
    customerOrdersCustomerIdx: index("customer_orders_customer_idx").on(t.customerId),
    customerOrdersOrderUnique: uniqueIndex("customer_orders_order_unique").on(t.orderId),
    customerOrdersMarketplaceCountryIdx: index("customer_orders_marketplace_country_idx").on(
      t.marketplace,
      t.countrySnapshot
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
    linkageSource: text("linkage_source"),
    linkageVerifiedAt: timestamp("linkage_verified_at"),
    linkageDeterministic: boolean("linkage_deterministic").notNull().default(false),
    supplierLinkLocked: boolean("supplier_link_locked").notNull().default(false),
    supplierStockStatus: text("supplier_stock_status"),
    supplierStockQty: integer("supplier_stock_qty"),
    stockVerifiedAt: timestamp("stock_verified_at"),
    stockSource: text("stock_source"),
    stockCheckRequired: boolean("stock_check_required").notNull().default(true),
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
    trackingCarrier: text("tracking_carrier"),
    trackingStatus: text("tracking_status").notNull().default("NOT_AVAILABLE"),
    manualNote: text("manual_note"),
    purchaseRecordedAt: timestamp("purchase_recorded_at"),
    trackingRecordedAt: timestamp("tracking_recorded_at"),
    trackingSyncLastAttemptAt: timestamp("tracking_sync_last_attempt_at"),
    trackingSyncedAt: timestamp("tracking_synced_at"),
    trackingSyncError: text("tracking_sync_error"),
    trackingSyncLastResponse: jsonb("tracking_sync_last_response").$type<unknown>(),
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

export const manualOverrides = pgTable(
  "manual_overrides",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    controlKey: text("control_key").notNull(),
    isEnabled: boolean("is_enabled").notNull().default(false),
    note: text("note"),
    changedBy: text("changed_by"),
    changedAt: timestamp("changed_at").notNull().defaultNow(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    manualOverridesControlKeyUnique: uniqueIndex("manual_overrides_control_key_unique").on(
      t.controlKey
    ),
    manualOverridesChangedAtIdx: index("manual_overrides_changed_at_idx").on(t.changedAt),
  })
);

export type OrderRow = typeof orders.$inferSelect;
export type OrderInsert = typeof orders.$inferInsert;
export type CustomerRow = typeof customers.$inferSelect;
export type CustomerInsert = typeof customers.$inferInsert;
export type CustomerOrderRow = typeof customerOrders.$inferSelect;
export type CustomerOrderInsert = typeof customerOrders.$inferInsert;
export type OrderItemRow = typeof orderItems.$inferSelect;
export type OrderItemInsert = typeof orderItems.$inferInsert;
export type OrderEventRow = typeof orderEvents.$inferSelect;
export type OrderEventInsert = typeof orderEvents.$inferInsert;
export type SupplierOrderRow = typeof supplierOrders.$inferSelect;
export type SupplierOrderInsert = typeof supplierOrders.$inferInsert;
export type ManualOverrideRow = typeof manualOverrides.$inferSelect;
export type ManualOverrideInsert = typeof manualOverrides.$inferInsert;
export const learningEvidenceEvents = pgTable(
  "learning_evidence_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    evidenceType: text("evidence_type").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    supplierKey: text("supplier_key"),
    marketplaceKey: text("marketplace_key"),
    source: text("source").notNull(),
    parserVersion: text("parser_version"),
    confidence: numeric("confidence", { precision: 6, scale: 4 }),
    freshnessSeconds: integer("freshness_seconds"),
    validationStatus: text("validation_status").notNull(),
    blockedReasons: text("blocked_reasons").array().notNull().default(sql`'{}'::text[]`),
    downstreamOutcome: text("downstream_outcome"),
    diagnostics: jsonb("diagnostics").$type<unknown>(),
    observedAt: timestamp("observed_at").notNull().defaultNow(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    learningEvidenceTypeTimeIdx: index("learning_evidence_events_type_time_idx").on(
      t.evidenceType,
      t.observedAt
    ),
    learningEvidenceEntityIdx: index("learning_evidence_events_entity_idx").on(
      t.entityType,
      t.entityId,
      t.observedAt
    ),
    learningEvidenceSupplierIdx: index("learning_evidence_events_supplier_idx").on(
      t.supplierKey,
      t.observedAt
    ),
  })
);

export const learningFeatures = pgTable(
  "learning_features",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    featureKey: text("feature_key").notNull(),
    subjectType: text("subject_type").notNull(),
    subjectKey: text("subject_key").notNull(),
    featureValue: numeric("feature_value", { precision: 12, scale: 6 }),
    confidence: numeric("confidence", { precision: 6, scale: 4 }),
    sampleSize: integer("sample_size").notNull().default(0),
    trendDirection: text("trend_direction"),
    evidenceWindowStart: timestamp("evidence_window_start"),
    evidenceWindowEnd: timestamp("evidence_window_end"),
    metadata: jsonb("metadata").$type<unknown>(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    learningFeaturesUnique: uniqueIndex("learning_features_feature_key_subject_type_subject_key_key").on(
      t.featureKey,
      t.subjectType,
      t.subjectKey
    ),
    learningFeaturesSubjectIdx: index("learning_features_subject_idx").on(
      t.subjectType,
      t.subjectKey,
      t.updatedAt
    ),
  })
);

export const learningMetricSnapshots = pgTable(
  "learning_metric_snapshots",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    metricKey: text("metric_key").notNull(),
    segmentKey: text("segment_key").notNull().default("global"),
    metricValue: numeric("metric_value", { precision: 12, scale: 6 }).notNull(),
    sampleSize: integer("sample_size").notNull().default(0),
    snapshotTs: timestamp("snapshot_ts").notNull().defaultNow(),
    metadata: jsonb("metadata").$type<unknown>(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    learningMetricSnapshotsLookupIdx: index("learning_metric_snapshots_lookup_idx").on(
      t.metricKey,
      t.segmentKey,
      t.snapshotTs
    ),
  })
);

export const learningDriftEvents = pgTable(
  "learning_drift_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    metricKey: text("metric_key").notNull(),
    segmentKey: text("segment_key").notNull().default("global"),
    category: text("category").notNull(),
    severity: text("severity").notNull(),
    baselineValue: numeric("baseline_value", { precision: 12, scale: 6 }),
    observedValue: numeric("observed_value", { precision: 12, scale: 6 }),
    deltaValue: numeric("delta_value", { precision: 12, scale: 6 }),
    reasonCode: text("reason_code").notNull(),
    actionHint: text("action_hint"),
    status: text("status").notNull().default("OPEN"),
    diagnostics: jsonb("diagnostics").$type<unknown>(),
    observedAt: timestamp("observed_at").notNull().defaultNow(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    learningDriftEventsOpenIdx: index("learning_drift_events_open_idx").on(t.status, t.severity, t.observedAt),
  })
);

export const learningEvalLabels = pgTable(
  "learning_eval_labels",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    labelType: text("label_type").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    predictedLabel: text("predicted_label"),
    predictedConfidence: numeric("predicted_confidence", { precision: 6, scale: 4 }),
    observedLabel: text("observed_label"),
    observedConfidence: numeric("observed_confidence", { precision: 6, scale: 4 }),
    qualityGap: numeric("quality_gap", { precision: 8, scale: 4 }),
    gradingStatus: text("grading_status").notNull().default("PENDING"),
    gradingNotes: text("grading_notes"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => ({
    learningEvalLabelsLookupIdx: index("learning_eval_labels_lookup_idx").on(
      t.labelType,
      t.gradingStatus,
      t.updatedAt
    ),
  })
);
