CREATE TABLE "listings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"candidate_id" uuid NOT NULL,
	"marketplace_key" text NOT NULL,
	"status" text DEFAULT 'PREVIEW' NOT NULL,
	"title" text NOT NULL,
	"price" numeric(12, 2) NOT NULL,
	"quantity" integer DEFAULT 1 NOT NULL,
	"payload" jsonb NOT NULL,
	"response" jsonb,
	"idempotency_key" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"listing_id" uuid,
	"marketplace_key" text NOT NULL,
	"order_id" text NOT NULL,
	"status" text DEFAULT 'NEW' NOT NULL,
	"quantity" integer DEFAULT 1 NOT NULL,
	"total_amount" numeric(12, 2),
	"currency" text DEFAULT 'USD',
	"raw_payload" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "worker_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"worker" text NOT NULL,
	"job_name" text NOT NULL,
	"job_id" text NOT NULL,
	"status" text NOT NULL,
	"duration_ms" integer,
	"ok" boolean DEFAULT false NOT NULL,
	"error" text,
	"stats" jsonb,
	"started_at" timestamp DEFAULT now() NOT NULL,
	"finished_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "marketplace_prices" ALTER COLUMN "price" SET DATA TYPE numeric(12, 2);--> statement-breakpoint
ALTER TABLE "marketplace_prices" ALTER COLUMN "shipping_price" SET DATA TYPE numeric(12, 2);--> statement-breakpoint
ALTER TABLE "marketplace_prices" ADD COLUMN "product_raw_id" uuid;--> statement-breakpoint
ALTER TABLE "marketplace_prices" ADD COLUMN "supplier_key" text;--> statement-breakpoint
ALTER TABLE "marketplace_prices" ADD COLUMN "supplier_product_id" text;--> statement-breakpoint
ALTER TABLE "marketplace_prices" ADD COLUMN "trend_mode" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "marketplace_prices" ADD COLUMN "search_query" text;--> statement-breakpoint
ALTER TABLE "marketplace_prices" ADD COLUMN "matched_title" text;--> statement-breakpoint
ALTER TABLE "marketplace_prices" ADD COLUMN "image_url" text;--> statement-breakpoint
ALTER TABLE "marketplace_prices" ADD COLUMN "title_similarity_score" numeric(6, 4);--> statement-breakpoint
ALTER TABLE "marketplace_prices" ADD COLUMN "keyword_score" numeric(6, 4);--> statement-breakpoint
ALTER TABLE "marketplace_prices" ADD COLUMN "final_match_score" numeric(6, 4);--> statement-breakpoint
CREATE INDEX "listings_candidate_idx" ON "listings" USING btree ("candidate_id");--> statement-breakpoint
CREATE INDEX "listings_marketplace_status_idx" ON "listings" USING btree ("marketplace_key","status");--> statement-breakpoint
CREATE UNIQUE INDEX "listings_unique_idempotency_key" ON "listings" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "orders_marketplace_idx" ON "orders" USING btree ("marketplace_key");--> statement-breakpoint
CREATE INDEX "orders_status_idx" ON "orders" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "orders_unique_marketplace_order" ON "orders" USING btree ("marketplace_key","order_id");--> statement-breakpoint
CREATE INDEX "worker_runs_started_idx" ON "worker_runs" USING btree ("started_at");--> statement-breakpoint
CREATE INDEX "worker_runs_status_idx" ON "worker_runs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "worker_runs_job_idx" ON "worker_runs" USING btree ("job_name","job_id");--> statement-breakpoint
CREATE INDEX "marketplace_prices_listing_idx" ON "marketplace_prices" USING btree ("marketplace_key","marketplace_listing_id");--> statement-breakpoint
CREATE INDEX "marketplace_prices_product_idx" ON "marketplace_prices" USING btree ("product_raw_id");--> statement-breakpoint
CREATE INDEX "marketplace_prices_score_idx" ON "marketplace_prices" USING btree ("final_match_score");--> statement-breakpoint
CREATE INDEX "marketplace_prices_snapshot_idx" ON "marketplace_prices" USING btree ("snapshot_ts");