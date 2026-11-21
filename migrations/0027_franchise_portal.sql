ALTER TABLE "franchises" ADD COLUMN "user_id" text;--> statement-breakpoint
ALTER TABLE "orgs" ADD COLUMN "franchise_id" text;--> statement-breakpoint
ALTER TABLE "orgs" ADD COLUMN "franchise_linked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "orgs" ADD COLUMN "franchise_link_source" text;--> statement-breakpoint
CREATE UNIQUE INDEX "franchises_user" ON "franchises" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "orgs_franchise" ON "orgs" USING btree ("franchise_id");