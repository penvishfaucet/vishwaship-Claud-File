CREATE TABLE "recharge_events" (
	"id" text PRIMARY KEY NOT NULL,
	"recharge_id" text NOT NULL,
	"action" text NOT NULL,
	"actor_kind" text NOT NULL,
	"actor_user_id" text,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "staff_alerts" (
	"id" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"href" text,
	"perm" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "recharges" ALTER COLUMN "status" SET DEFAULT 'payment_pending';--> statement-breakpoint
ALTER TABLE "recharges" ADD COLUMN "method" text DEFAULT 'razorpay' NOT NULL;--> statement-breakpoint
ALTER TABLE "recharges" ADD COLUMN "request_number" text;--> statement-breakpoint
ALTER TABLE "recharges" ADD COLUMN "provider_order_id" text;--> statement-breakpoint
ALTER TABLE "recharges" ADD COLUMN "provider_payment_id" text;--> statement-breakpoint
ALTER TABLE "recharges" ADD COLUMN "discount_bps" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "recharges" ADD COLUMN "discount_paise" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "recharges" ADD COLUMN "payable_paise" bigint;--> statement-breakpoint
ALTER TABLE "recharges" ADD COLUMN "paid_paise" bigint;--> statement-breakpoint
ALTER TABLE "recharges" ADD COLUMN "utr" text;--> statement-breakpoint
ALTER TABLE "recharges" ADD COLUMN "utr_duplicate" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "recharges" ADD COLUMN "paid_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "recharges" ADD COLUMN "proof_key" text;--> statement-breakpoint
ALTER TABLE "recharges" ADD COLUMN "proof_name" text;--> statement-breakpoint
ALTER TABLE "recharges" ADD COLUMN "proof_mime" text;--> statement-breakpoint
ALTER TABLE "recharges" ADD COLUMN "remarks" text;--> statement-breakpoint
ALTER TABLE "recharges" ADD COLUMN "ticket_id" text;--> statement-breakpoint
ALTER TABLE "recharges" ADD COLUMN "decided_by" text;--> statement-breakpoint
ALTER TABLE "recharges" ADD COLUMN "decided_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "recharges" ADD COLUMN "decision_note" text;--> statement-breakpoint
ALTER TABLE "recharge_events" ADD CONSTRAINT "recharge_events_recharge_id_recharges_id_fk" FOREIGN KEY ("recharge_id") REFERENCES "public"."recharges"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "recharge_events_rc" ON "recharge_events" USING btree ("recharge_id","created_at");--> statement-breakpoint
CREATE INDEX "staff_alerts_created" ON "staff_alerts" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "recharges_provider_order" ON "recharges" USING btree ("method","provider_order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "recharges_utr_credited" ON "recharges" USING btree ("utr") WHERE "recharges"."status" = 'credited' and "recharges"."method" = 'manual';--> statement-breakpoint
CREATE INDEX "recharges_org_created" ON "recharges" USING btree ("org_id","created_at");--> statement-breakpoint
CREATE INDEX "recharges_status" ON "recharges" USING btree ("status");--> statement-breakpoint
ALTER TABLE "recharges" ADD CONSTRAINT "recharges_request_number_unique" UNIQUE("request_number");--> statement-breakpoint
UPDATE "recharges" SET "status" = 'credited' WHERE "status" = 'captured';--> statement-breakpoint
UPDATE "recharges" SET "status" = 'payment_pending' WHERE "status" = 'pending';--> statement-breakpoint
UPDATE "recharges" SET "method" = 'demo' WHERE "razorpay_order_id" LIKE 'demo_%';--> statement-breakpoint
UPDATE "recharges" SET "paid_paise" = "amount_paise", "payable_paise" = "amount_paise" WHERE "status" = 'credited';