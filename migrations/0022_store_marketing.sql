CREATE TABLE "store_ad_stats" (
	"id" text PRIMARY KEY NOT NULL,
	"store_id" text NOT NULL,
	"org_id" text NOT NULL,
	"platform" text NOT NULL,
	"day" text NOT NULL,
	"campaign_id" text DEFAULT '' NOT NULL,
	"campaign_name" text,
	"spend_paise" bigint DEFAULT 0 NOT NULL,
	"impressions" integer DEFAULT 0 NOT NULL,
	"clicks" integer DEFAULT 0 NOT NULL,
	"platform_purchases" integer DEFAULT 0 NOT NULL,
	"platform_value_paise" bigint DEFAULT 0 NOT NULL,
	"source" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "store_conversions" (
	"id" text PRIMARY KEY NOT NULL,
	"store_order_id" text NOT NULL,
	"org_id" text NOT NULL,
	"platform" text NOT NULL,
	"event_id" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"reason" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "store_visitors" (
	"store_id" text NOT NULL,
	"day" text NOT NULL,
	"visitor_hash" text NOT NULL,
	CONSTRAINT "store_visitors_store_id_day_visitor_hash_pk" PRIMARY KEY("store_id","day","visitor_hash")
);
--> statement-breakpoint
CREATE TABLE "store_visits_daily" (
	"store_id" text NOT NULL,
	"day" text NOT NULL,
	"views" integer DEFAULT 0 NOT NULL,
	"visitors" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "store_visits_daily_store_id_day_pk" PRIMARY KEY("store_id","day")
);
--> statement-breakpoint
ALTER TABLE "store_ad_stats" ADD CONSTRAINT "store_ad_stats_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_conversions" ADD CONSTRAINT "store_conversions_store_order_id_store_orders_id_fk" FOREIGN KEY ("store_order_id") REFERENCES "public"."store_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_visits_daily" ADD CONSTRAINT "store_visits_daily_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "store_ad_stats_day" ON "store_ad_stats" USING btree ("store_id","platform","day","campaign_id");--> statement-breakpoint
CREATE UNIQUE INDEX "store_conversions_once" ON "store_conversions" USING btree ("store_order_id","platform");