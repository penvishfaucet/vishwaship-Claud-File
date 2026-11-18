CREATE TABLE "destination_amendments" (
	"id" text PRIMARY KEY NOT NULL,
	"order_id" text NOT NULL,
	"shipment_id" text NOT NULL,
	"previous" jsonb NOT NULL,
	"next" jsonb NOT NULL,
	"source" text NOT NULL,
	"dedupe_key" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "destination_amendments_dedupe_key_unique" UNIQUE("dedupe_key")
);
--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "archived_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "shipment_events" ADD COLUMN "remark" text;--> statement-breakpoint
ALTER TABLE "shipments" ADD COLUMN "last_location" text;--> statement-breakpoint
ALTER TABLE "shipments" ADD COLUMN "delivered_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "shipments" ADD COLUMN "last_sync_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "shipments" ADD COLUMN "last_sync_error" text;--> statement-breakpoint
ALTER TABLE "shipments" ADD COLUMN "sync_failures" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "prefs" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "destination_amendments" ADD CONSTRAINT "destination_amendments_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;