CREATE INDEX "shipments_provider_ref" ON "shipments" USING btree ("provider_order_ref");--> statement-breakpoint
CREATE INDEX "shipments_lr" ON "shipments" USING btree ("lr_number");--> statement-breakpoint
-- Markup priority: customer → provider/service default → global. The old Shipmozo-wide rows were the global
-- default and the customer overrides; they move to the "*" key with the same percentages.
INSERT INTO "markup_rules" ("id", "provider", "org_id", "bps", "version", "effective_from", "created_by")
  SELECT 'mkm_' || "id", '*', "org_id", "bps", 1, "effective_from", "created_by" FROM "markup_rules"
  WHERE "provider" = 'shipmozo' AND "cleared_at" IS NULL;--> statement-breakpoint
UPDATE "markup_rules" SET "cleared_at" = now() WHERE "provider" = 'shipmozo' AND "cleared_at" IS NULL;--> statement-breakpoint
-- Shipmozo accounts created before the adapter existed were never verified: back to setup as the B2C service.
UPDATE "provider_accounts" SET "status" = 'disabled', "config_public" = "config_public" || '{"service":"B2C"}'::jsonb
  WHERE "adapter" = 'shipmozo' AND NOT ("config_public" ? 'service');
