CREATE TABLE "store_ad_changes" (
	"id" text PRIMARY KEY NOT NULL,
	"store_id" text NOT NULL,
	"org_id" text NOT NULL,
	"kind" text NOT NULL,
	"campaign_name" text NOT NULL,
	"daily_budget_paise" bigint,
	"total_budget_paise" bigint,
	"start_date" text,
	"end_date" text,
	"details" text,
	"status" text NOT NULL,
	"needs_approval" boolean NOT NULL,
	"proposed_by" text NOT NULL,
	"decided_by" text,
	"decided_at" timestamp with time zone,
	"decision_note" text,
	"applied_by" text,
	"applied_at" timestamp with time zone,
	"meta_campaign_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "store_deposits" (
	"id" text PRIMARY KEY NOT NULL,
	"store_id" text NOT NULL,
	"org_id" text NOT NULL,
	"amount_paise" bigint NOT NULL,
	"status" text DEFAULT 'held' NOT NULL,
	"receipt_number" text NOT NULL,
	"ledger_entry_id" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"terms_version" integer NOT NULL,
	"paid_by" text,
	"refund_requested_at" timestamp with time zone,
	"refund_reason" text,
	"refund_paise" bigint,
	"refund_ledger_entry_id" text,
	"decided_by" text,
	"decided_at" timestamp with time zone,
	"decision_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "store_managed_ads" (
	"id" text PRIMARY KEY NOT NULL,
	"store_id" text NOT NULL,
	"org_id" text NOT NULL,
	"status" text DEFAULT 'onboarding' NOT NULL,
	"checklist" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"terms_version" integer,
	"terms_accepted_at" timestamp with time zone,
	"terms_accepted_by" text,
	"monthly_cap_paise" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "store_plans" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"interval" text NOT NULL,
	"price_paise" bigint NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "store_subscriptions" (
	"id" text PRIMARY KEY NOT NULL,
	"store_id" text NOT NULL,
	"org_id" text NOT NULL,
	"plan_id" text NOT NULL,
	"plan_name" text NOT NULL,
	"interval" text NOT NULL,
	"amount_paise" bigint NOT NULL,
	"base_paise" bigint NOT NULL,
	"gst_paise" bigint NOT NULL,
	"period_start" timestamp with time zone NOT NULL,
	"period_end" timestamp with time zone NOT NULL,
	"receipt_number" text NOT NULL,
	"ledger_entry_id" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "stores" ADD COLUMN "trial_ends_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "stores" ADD COLUMN "paid_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "stores" ADD COLUMN "plan_id" text;--> statement-breakpoint
ALTER TABLE "stores" ADD COLUMN "assigned_staff_id" text;--> statement-breakpoint
ALTER TABLE "store_ad_changes" ADD CONSTRAINT "store_ad_changes_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_deposits" ADD CONSTRAINT "store_deposits_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_managed_ads" ADD CONSTRAINT "store_managed_ads_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_subscriptions" ADD CONSTRAINT "store_subscriptions_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "store_ad_changes_store" ON "store_ad_changes" USING btree ("store_id","created_at");--> statement-breakpoint
CREATE INDEX "store_ad_changes_status" ON "store_ad_changes" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "store_deposits_receipt" ON "store_deposits" USING btree ("receipt_number");--> statement-breakpoint
CREATE UNIQUE INDEX "store_deposits_idem" ON "store_deposits" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "store_deposits_store" ON "store_deposits" USING btree ("store_id");--> statement-breakpoint
CREATE INDEX "store_deposits_status" ON "store_deposits" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "store_managed_ads_store" ON "store_managed_ads" USING btree ("store_id");--> statement-breakpoint
CREATE INDEX "store_managed_ads_status" ON "store_managed_ads" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "store_subscriptions_receipt" ON "store_subscriptions" USING btree ("receipt_number");--> statement-breakpoint
CREATE UNIQUE INDEX "store_subscriptions_idem" ON "store_subscriptions" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "store_subscriptions_store" ON "store_subscriptions" USING btree ("store_id","created_at");--> statement-breakpoint
UPDATE "stores" SET "trial_ends_at" = now() + interval '15 days' WHERE "trial_ends_at" IS NULL;--> statement-breakpoint
INSERT INTO "store_plans" ("id", "name", "interval", "price_paise", "active", "sort") VALUES ('spl_monthly', 'Monthly', 'month', 99900, true, 1), ('spl_yearly', 'Yearly', 'year', 999900, true, 2) ON CONFLICT DO NOTHING;
