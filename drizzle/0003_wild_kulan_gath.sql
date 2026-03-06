CREATE TABLE "query_budgets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source" text NOT NULL,
	"period" text NOT NULL,
	"max_queries" integer NOT NULL,
	"used_queries" integer DEFAULT 0 NOT NULL,
	"reset_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "query_cache" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"keyword" text NOT NULL,
	"marketplace" text NOT NULL,
	"last_run_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "query_tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"candidate_id" uuid NOT NULL,
	"marketplace" text NOT NULL,
	"priority_score" numeric(6, 4) NOT NULL,
	"status" text DEFAULT 'NEW' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"queued_at" timestamp,
	"started_at" timestamp,
	"finished_at" timestamp,
	"last_error" text
);
--> statement-breakpoint
ALTER TABLE "trend_candidates" ADD COLUMN "priority_score" numeric(6, 4) DEFAULT '0' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "query_budgets_source_period_unique" ON "query_budgets" USING btree ("source","period");--> statement-breakpoint
CREATE UNIQUE INDEX "query_cache_unique_keyword_marketplace" ON "query_cache" USING btree ("keyword","marketplace");--> statement-breakpoint
CREATE INDEX "query_cache_marketplace_last_run_idx" ON "query_cache" USING btree ("marketplace","last_run_at");--> statement-breakpoint
CREATE INDEX "query_tasks_status_priority_idx" ON "query_tasks" USING btree ("status","priority_score");--> statement-breakpoint
CREATE INDEX "query_tasks_marketplace_status_idx" ON "query_tasks" USING btree ("marketplace","status");--> statement-breakpoint
CREATE UNIQUE INDEX "query_tasks_unique_candidate_marketplace" ON "query_tasks" USING btree ("candidate_id","marketplace");