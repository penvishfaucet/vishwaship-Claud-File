CREATE TABLE "account_deletion_requests" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text,
	"org_id" text,
	"email" text NOT NULL,
	"reason" text,
	"source" text NOT NULL,
	"status" text DEFAULT 'requested' NOT NULL,
	"note" text,
	"decided_by" text,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mobile_devices" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"org_id" text NOT NULL,
	"session_id" text NOT NULL,
	"install_id" text NOT NULL,
	"platform" text DEFAULT 'android' NOT NULL,
	"app_version" text,
	"push_token" text,
	"push_enabled" boolean DEFAULT false NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "in_app_alerts" ADD COLUMN "pushed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "account_deletion_requests" ADD CONSTRAINT "account_deletion_requests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mobile_devices" ADD CONSTRAINT "mobile_devices_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "account_deletion_status" ON "account_deletion_requests" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "mobile_devices_install" ON "mobile_devices" USING btree ("install_id");--> statement-breakpoint
CREATE INDEX "mobile_devices_org" ON "mobile_devices" USING btree ("org_id");