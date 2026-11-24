-- Online Store self-serve plan (owner 2026-11-24): 1 month free trial, then Rs 2,499 + GST a month. The Growth Package
-- (refundable deposit, managed service) stays available next to it.
UPDATE "store_plans" SET "name" = 'Monthly (self-serve)', "price_paise" = 249900, "active" = true, "updated_at" = now() WHERE "id" = 'spl_monthly';--> statement-breakpoint
INSERT INTO "store_plans" ("id", "name", "interval", "price_paise", "active", "sort") VALUES ('spl_monthly', 'Monthly (self-serve)', 'month', 249900, true, 1) ON CONFLICT DO NOTHING;--> statement-breakpoint
UPDATE "pricing_settings" SET "value" = jsonb_set("value", '{trialDays}', '30'::jsonb), "version" = "version" + 1, "updated_at" = now() WHERE "key" = 'store_billing';
