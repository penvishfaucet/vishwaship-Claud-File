ALTER TABLE "store_orders" ADD COLUMN "return_inspection" jsonb;--> statement-breakpoint
ALTER TABLE "store_orders" ADD COLUMN "return_inspected_at" timestamp with time zone;