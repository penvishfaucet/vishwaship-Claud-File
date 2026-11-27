-- Admin → CRM Leads (owner 2026-11-28): Meta Lead Ads leads and staff-added enquiries, worked by staff with notes,
-- WhatsApp / call logs and follow-ups. New staff role "sales" sees only the CRM leads assigned to them.
ALTER TYPE "public"."staff_role" ADD VALUE IF NOT EXISTS 'sales';--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "crm_leads" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"mobile" text,
	"email" text,
	"city" text,
	"company" text,
	"source" text DEFAULT 'manual' NOT NULL,
	"campaign" text,
	"ad_name" text,
	"meta_lead_id" text,
	"interest" text,
	"volume" text,
	"current_courier" text,
	"answers" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text DEFAULT 'new' NOT NULL,
	"assigned_to" text,
	"next_follow_up_at" timestamp with time zone,
	"preferred_time" text,
	"last_activity_at" timestamp with time zone,
	"last_note" text,
	"org_id" text,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "crm_leads_assigned_to_users_id_fk" FOREIGN KEY ("assigned_to") REFERENCES "public"."users"("id")
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "crm_activities" (
	"id" text PRIMARY KEY NOT NULL,
	"lead_id" text NOT NULL,
	"kind" text NOT NULL,
	"body" text,
	"meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "crm_activities_lead_id_crm_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."crm_leads"("id")
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "crm_leads_meta" ON "crm_leads" USING btree ("meta_lead_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "crm_leads_status" ON "crm_leads" USING btree ("status","updated_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "crm_leads_assigned" ON "crm_leads" USING btree ("assigned_to","status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "crm_leads_follow_up" ON "crm_leads" USING btree ("next_follow_up_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "crm_leads_mobile" ON "crm_leads" USING btree ("mobile");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "crm_activities_lead" ON "crm_activities" USING btree ("lead_id","created_at");
