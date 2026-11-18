ALTER TABLE "ticket_messages" ADD COLUMN "client_id" text;--> statement-breakpoint
ALTER TABLE "tickets" ADD COLUMN "order_id" text;--> statement-breakpoint
ALTER TABLE "tickets" ADD COLUMN "order_number" text;--> statement-breakpoint
ALTER TABLE "tickets" ADD COLUMN "idem_key" text;--> statement-breakpoint
ALTER TABLE "tickets" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
UPDATE "tickets" t SET "updated_at" = COALESCE((SELECT max(m."created_at") FROM "ticket_messages" m WHERE m."ticket_id" = t."id"), t."created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "ticket_messages_client" ON "ticket_messages" USING btree ("ticket_id","client_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tickets_org_idem" ON "tickets" USING btree ("org_id","idem_key");--> statement-breakpoint
CREATE INDEX "tickets_org_status" ON "tickets" USING btree ("org_id","status");
