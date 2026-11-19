CREATE TABLE "email_logs" (
	"id" text PRIMARY KEY NOT NULL,
	"event" text NOT NULL,
	"dedupe_key" text,
	"org_id" text,
	"shipment_id" text,
	"to_email" text NOT NULL,
	"to_kind" text NOT NULL,
	"sender_email" text NOT NULL,
	"subject" text NOT NULL,
	"vars" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"error" text,
	"provider_id" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"retryable" boolean DEFAULT true NOT NULL,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "email_logs_dedupe_key_unique" UNIQUE("dedupe_key")
);
--> statement-breakpoint
CREATE TABLE "email_rules" (
	"event" text PRIMARY KEY NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"sender_id" text,
	"to_client" boolean DEFAULT true NOT NULL,
	"to_recipient" boolean DEFAULT false NOT NULL,
	"updated_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "email_senders" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"display_name" text NOT NULL,
	"reply_to" text,
	"is_default" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"status_detail" text,
	"checked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "email_senders_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "email_templates" (
	"event" text PRIMARY KEY NOT NULL,
	"subject" text NOT NULL,
	"body" text NOT NULL,
	"updated_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "orgs" ADD COLUMN "address" jsonb;--> statement-breakpoint
ALTER TABLE "orgs" ADD COLUMN "profile_completed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "google_sub" text;--> statement-breakpoint
CREATE INDEX "email_logs_created" ON "email_logs" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "users_google_sub" ON "users" USING btree ("google_sub");--> statement-breakpoint
-- customers who signed up with the full form before onboarding existed already gave name, business and mobile
UPDATE "orgs" SET "profile_completed_at" = "created_at" WHERE "profile_completed_at" IS NULL;
