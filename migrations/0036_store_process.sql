ALTER TABLE "store_orders" ADD COLUMN "label_printed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "store_orders" ADD COLUMN "handed_over_at" timestamp with time zone;--> statement-breakpoint
-- orders packed before the Process Orders steps existed: their label was made at the same time
UPDATE "store_orders" SET "label_printed_at" = "packed_at" WHERE "packed_at" IS NOT NULL AND "label_printed_at" IS NULL;