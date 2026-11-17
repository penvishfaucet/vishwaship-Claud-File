CREATE TABLE "content_blocks" (
	"key" text NOT NULL,
	"locale" text DEFAULT 'en' NOT NULL,
	"draft" text,
	"published" text,
	"updated_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_by" text,
	"published_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "feature_overrides" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text,
	"module" text NOT NULL,
	"enabled" boolean NOT NULL,
	"updated_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "org_subscriptions" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"plan_id" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"starts_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "plans" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"price_paise" bigint DEFAULT 0 NOT NULL,
	"billing_period_days" integer DEFAULT 30 NOT NULL,
	"modules" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"events" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tracking_pages" (
	"org_id" text PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"draft" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"published" jsonb,
	"is_published" boolean DEFAULT false NOT NULL,
	"published_at" timestamp with time zone,
	"disabled_by_admin" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tracking_pages_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "whatsapp_messages" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"order_id" text,
	"shipment_id" text,
	"event" text NOT NULL,
	"template_name" text,
	"recipient_masked" text NOT NULL,
	"dedupe_key" text NOT NULL,
	"provider_message_id" text,
	"status" text NOT NULL,
	"buyer_response" text,
	"responded_at" timestamp with time zone,
	"error" text,
	"credits_charged" integer DEFAULT 0 NOT NULL,
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "whatsapp_messages_dedupe_key_unique" UNIQUE("dedupe_key")
);
--> statement-breakpoint
ALTER TABLE "cod_confirmations" ADD COLUMN "buyer_response" text;--> statement-breakpoint
ALTER TABLE "cod_confirmations" ADD COLUMN "cancellation_status" text;--> statement-breakpoint
ALTER TABLE "cod_confirmations" ADD COLUMN "cancellation_reason" text;--> statement-breakpoint
ALTER TABLE "cod_confirmations" ADD COLUMN "cancellation_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "pickup_snapshot" jsonb;--> statement-breakpoint
ALTER TABLE "shipments" ADD COLUMN "public_ref" text;--> statement-breakpoint
ALTER TABLE "warehouses" ADD COLUMN "email" text;--> statement-breakpoint
ALTER TABLE "warehouses" ADD COLUMN "code" text;--> statement-breakpoint
ALTER TABLE "warehouses" ADD COLUMN "created_by" text;--> statement-breakpoint
ALTER TABLE "warehouses" ADD COLUMN "deactivated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "warehouses" ADD COLUMN "updated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "org_subscriptions" ADD CONSTRAINT "org_subscriptions_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_subscriptions" ADD CONSTRAINT "org_subscriptions_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tracking_pages" ADD CONSTRAINT "tracking_pages_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "content_key_locale" ON "content_blocks" USING btree ("key","locale");--> statement-breakpoint
CREATE UNIQUE INDEX "feature_override_scope" ON "feature_overrides" USING btree ("org_id","module");--> statement-breakpoint
CREATE INDEX "org_sub_org" ON "org_subscriptions" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "wa_org_created" ON "whatsapp_messages" USING btree ("org_id","created_at");--> statement-breakpoint
CREATE INDEX "wa_provider_msg" ON "whatsapp_messages" USING btree ("provider_message_id");--> statement-breakpoint
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_public_ref_unique" UNIQUE("public_ref");