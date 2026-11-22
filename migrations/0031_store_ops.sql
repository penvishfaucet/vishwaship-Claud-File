CREATE TABLE "store_order_events" (
	"id" text PRIMARY KEY NOT NULL,
	"store_order_id" text NOT NULL,
	"org_id" text NOT NULL,
	"kind" text NOT NULL,
	"message" text NOT NULL,
	"actor_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "store_stock_moves" (
	"id" text PRIMARY KEY NOT NULL,
	"store_id" text NOT NULL,
	"org_id" text NOT NULL,
	"product_id" text NOT NULL,
	"variant_id" text,
	"kind" text NOT NULL,
	"available" integer DEFAULT 0 NOT NULL,
	"reserved" integer DEFAULT 0 NOT NULL,
	"damaged" integer DEFAULT 0 NOT NULL,
	"unit_cost_paise" bigint,
	"store_order_id" text,
	"reason" text,
	"actor_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "store_orders" ADD COLUMN "stock_state" text DEFAULT 'reserved' NOT NULL;--> statement-breakpoint
ALTER TABLE "store_orders" ADD COLUMN "acceptance" text DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE "store_orders" ADD COLUMN "accepted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "store_orders" ADD COLUMN "accepted_by" text;--> statement-breakpoint
ALTER TABLE "store_orders" ADD COLUMN "reject_reason" text;--> statement-breakpoint
ALTER TABLE "store_orders" ADD COLUMN "refund" jsonb;--> statement-breakpoint
ALTER TABLE "store_orders" ADD COLUMN "costs" jsonb;--> statement-breakpoint
ALTER TABLE "store_product_variants" ADD COLUMN "reserved" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "store_product_variants" ADD COLUMN "damaged" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "store_product_variants" ADD COLUMN "unit_cost_paise" bigint;--> statement-breakpoint
ALTER TABLE "store_products" ADD COLUMN "reserved" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "store_products" ADD COLUMN "damaged" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "store_products" ADD COLUMN "unit_cost_paise" bigint;--> statement-breakpoint
CREATE INDEX "store_order_events_order" ON "store_order_events" USING btree ("store_order_id","created_at");--> statement-breakpoint
CREATE INDEX "store_stock_moves_product" ON "store_stock_moves" USING btree ("product_id","created_at");--> statement-breakpoint
CREATE INDEX "store_stock_moves_store" ON "store_stock_moves" USING btree ("store_id","created_at");--> statement-breakpoint
-- orders from before acceptance and reservations: treat as accepted, and never touch the new reserved counts
UPDATE "store_orders" SET "stock_state" = 'legacy', "acceptance" = CASE WHEN "status" = 'pending_payment' THEN 'pending' ELSE 'accepted' END, "accepted_at" = CASE WHEN "status" = 'pending_payment' THEN NULL ELSE coalesce("placed_at", "created_at") END;