CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_ts" timestamp DEFAULT now() NOT NULL,
	"actor_type" text NOT NULL,
	"actor_id" text,
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"event_type" text NOT NULL,
	"details" jsonb
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_type" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"payload" jsonb NOT NULL,
	"status" text NOT NULL,
	"priority" integer DEFAULT 0,
	"attempt" integer DEFAULT 0,
	"max_attempts" integer DEFAULT 5,
	"scheduled_ts" timestamp DEFAULT now(),
	"started_ts" timestamp,
	"finished_ts" timestamp,
	"last_error" text
);
--> statement-breakpoint
CREATE TABLE "marketplace_prices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"marketplace_key" text NOT NULL,
	"marketplace_listing_id" text NOT NULL,
	"product_page_url" text,
	"currency" text NOT NULL,
	"price" numeric NOT NULL,
	"shipping_price" numeric,
	"is_prime" boolean,
	"availability_status" text,
	"seller_id" text,
	"seller_name" text,
	"raw_payload" jsonb NOT NULL,
	"snapshot_ts" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "matches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"supplier_key" text NOT NULL,
	"supplier_product_id" text NOT NULL,
	"marketplace_key" text NOT NULL,
	"marketplace_listing_id" text NOT NULL,
	"match_type" text NOT NULL,
	"confidence" numeric NOT NULL,
	"evidence" jsonb,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"first_seen_ts" timestamp DEFAULT now() NOT NULL,
	"last_seen_ts" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "products_raw" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"supplier_key" text NOT NULL,
	"supplier_product_id" text NOT NULL,
	"source_url" text,
	"title" text,
	"images" jsonb,
	"variants" jsonb,
	"currency" text,
	"price_min" numeric,
	"price_max" numeric,
	"availability_status" text,
	"shipping_estimates" jsonb,
	"raw_payload" jsonb NOT NULL,
	"snapshot_ts" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "profitable_candidates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"supplier_key" text NOT NULL,
	"supplier_product_id" text NOT NULL,
	"marketplace_key" text NOT NULL,
	"marketplace_listing_id" text NOT NULL,
	"calc_ts" timestamp DEFAULT now() NOT NULL,
	"supplier_snapshot_id" uuid NOT NULL,
	"market_price_snapshot_id" uuid NOT NULL,
	"estimated_fees" jsonb,
	"estimated_shipping" numeric,
	"estimated_cogs" numeric,
	"estimated_profit" numeric,
	"margin_pct" numeric,
	"roi_pct" numeric,
	"risk_flags" text[],
	"decision_status" text DEFAULT 'PENDING' NOT NULL,
	"reason" text
);
--> statement-breakpoint
CREATE TABLE "trend_candidates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"trend_signal_id" uuid NOT NULL,
	"candidate_type" text NOT NULL,
	"candidate_value" text NOT NULL,
	"region" text,
	"status" text DEFAULT 'NEW' NOT NULL,
	"created_ts" timestamp DEFAULT now() NOT NULL,
	"meta" jsonb
);
--> statement-breakpoint
CREATE TABLE "trend_signals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source" text NOT NULL,
	"signal_type" text NOT NULL,
	"signal_value" text NOT NULL,
	"region" text,
	"score" numeric,
	"raw_payload" jsonb,
	"captured_ts" timestamp DEFAULT now() NOT NULL
);
