-- CRM WhatsApp (owner 2026-11-28): the business number on Meta's Cloud API sends the intro (photo / video) to leads from
-- Admin → CRM Leads and every reply lands on the lead. Call outcomes are kept per call.
ALTER TABLE "crm_leads" ADD COLUMN IF NOT EXISTS "last_wa_in_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "crm_leads" ADD COLUMN IF NOT EXISTS "last_wa_out_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "crm_leads" ADD COLUMN IF NOT EXISTS "wa_unread" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "crm_leads" ADD COLUMN IF NOT EXISTS "last_call_outcome" text;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "crm_activities_wa_msg" ON "crm_activities" ((meta->>'waMsgId'));
