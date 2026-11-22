ALTER TABLE "store_orders" ADD COLUMN "fee_paise" bigint;--> statement-breakpoint
ALTER TABLE "store_orders" ADD COLUMN "fee_gst_paise" bigint;--> statement-breakpoint
ALTER TABLE "store_orders" ADD COLUMN "fee_charged_at" timestamp with time zone;--> statement-breakpoint
-- the 1.5% delivered-order fee applies to orders placed from now on: existing orders are marked as not charged
UPDATE "store_orders" SET "fee_charged_at" = now(), "fee_paise" = 0, "fee_gst_paise" = 0 WHERE "fee_charged_at" IS NULL;--> statement-breakpoint
-- Online Store plan (owner 2026-11-23): Rs 2,499 + GST a month; plan prices are now before GST. Yearly is off until it is re-priced.
UPDATE "store_plans" SET "price_paise" = 249900, "updated_at" = now() WHERE "id" = 'spl_monthly';--> statement-breakpoint
UPDATE "store_plans" SET "active" = false, "updated_at" = now() WHERE "id" = 'spl_yearly';
