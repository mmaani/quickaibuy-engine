CREATE TABLE "product_candidates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"candidate_id" uuid NOT NULL,
	"product_title" text NOT NULL,
	"marketplace" text NOT NULL,
	"marketplace_listing_id" text NOT NULL,
	"price" numeric(12, 2) NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"product_url" text,
	"source" text DEFAULT 'stub' NOT NULL,
	"status" text DEFAULT 'DISCOVERED' NOT NULL,
	"discovered_ts" timestamp DEFAULT now() NOT NULL,
	"meta" jsonb
);
--> statement-breakpoint
CREATE INDEX "product_candidates_candidate_idx" ON "product_candidates" USING btree ("candidate_id");--> statement-breakpoint
CREATE INDEX "product_candidates_marketplace_idx" ON "product_candidates" USING btree ("marketplace");--> statement-breakpoint
CREATE UNIQUE INDEX "product_candidates_unique_listing" ON "product_candidates" USING btree ("candidate_id","marketplace","marketplace_listing_id");