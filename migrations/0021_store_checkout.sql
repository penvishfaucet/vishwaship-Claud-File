CREATE TABLE "store_coupons" (
	"id" text PRIMARY KEY NOT NULL,
	"store_id" text NOT NULL,
	"org_id" text NOT NULL,
	"code" text NOT NULL,
	"kind" text NOT NULL,
	"value" integer DEFAULT 0 NOT NULL,
	"max_discount_paise" bigint,
	"min_subtotal_paise" bigint DEFAULT 0 NOT NULL,
	"max_uses" integer,
	"used" integer DEFAULT 0 NOT NULL,
	"starts_at" timestamp with time zone,
	"ends_at" timestamp with time zone,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "store_orders" (
	"id" text PRIMARY KEY NOT NULL,
	"store_id" text NOT NULL,
	"org_id" text NOT NULL,
	"number" text NOT NULL,
	"checkout_key" text NOT NULL,
	"buyer_token" text NOT NULL,
	"status" text NOT NULL,
	"payment_method" text NOT NULL,
	"payment_status" text NOT NULL,
	"buyer" jsonb NOT NULL,
	"lines" jsonb NOT NULL,
	"subtotal_paise" bigint NOT NULL,
	"discount_paise" bigint DEFAULT 0 NOT NULL,
	"shipping_paise" bigint DEFAULT 0 NOT NULL,
	"cod_fee_paise" bigint DEFAULT 0 NOT NULL,
	"total_paise" bigint NOT NULL,
	"coupon_code" text,
	"razorpay_order_id" text,
	"razorpay_payment_id" text,
	"shipping_order_id" text,
	"stock_released" boolean DEFAULT false NOT NULL,
	"attribution" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"note" text,
	"paid_at" timestamp with time zone,
	"placed_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "store_product_variants" (
	"id" text PRIMARY KEY NOT NULL,
	"product_id" text NOT NULL,
	"store_id" text NOT NULL,
	"org_id" text NOT NULL,
	"title" text NOT NULL,
	"option_values" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"sku" text,
	"price_paise" bigint NOT NULL,
	"compare_paise" bigint,
	"stock" integer DEFAULT 0 NOT NULL,
	"weight_grams" integer,
	"sort" integer DEFAULT 0 NOT NULL,
	"archived" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "store_products" ADD COLUMN "sku" text;--> statement-breakpoint
ALTER TABLE "store_products" ADD COLUMN "hsn" text;--> statement-breakpoint
ALTER TABLE "store_products" ADD COLUMN "tax_bps" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "store_products" ADD COLUMN "low_stock_at" integer DEFAULT 5 NOT NULL;--> statement-breakpoint
ALTER TABLE "store_products" ADD COLUMN "length_mm" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "store_products" ADD COLUMN "breadth_mm" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "store_products" ADD COLUMN "height_mm" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "store_products" ADD COLUMN "options" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "store_coupons" ADD CONSTRAINT "store_coupons_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_orders" ADD CONSTRAINT "store_orders_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_product_variants" ADD CONSTRAINT "store_product_variants_product_id_store_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."store_products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "store_coupons_code" ON "store_coupons" USING btree ("store_id","code");--> statement-breakpoint
CREATE UNIQUE INDEX "store_orders_number" ON "store_orders" USING btree ("store_id","number");--> statement-breakpoint
CREATE UNIQUE INDEX "store_orders_checkout" ON "store_orders" USING btree ("store_id","checkout_key");--> statement-breakpoint
CREATE UNIQUE INDEX "store_orders_rzp_order" ON "store_orders" USING btree ("razorpay_order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "store_orders_rzp_payment" ON "store_orders" USING btree ("razorpay_payment_id");--> statement-breakpoint
CREATE INDEX "store_orders_store_created" ON "store_orders" USING btree ("store_id","created_at");--> statement-breakpoint
CREATE INDEX "store_variants_product" ON "store_product_variants" USING btree ("product_id");