ALTER TABLE "store_product_variants" ADD COLUMN "image" text;--> statement-breakpoint
ALTER TABLE "store_products" ADD COLUMN "attributes" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "store_products" ADD COLUMN "details" jsonb DEFAULT '{}'::jsonb NOT NULL;