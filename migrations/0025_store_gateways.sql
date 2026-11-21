ALTER TABLE "store_orders" ADD COLUMN "pg_order_id" text;--> statement-breakpoint
ALTER TABLE "store_orders" ADD COLUMN "pg_payment_id" text;--> statement-breakpoint
ALTER TABLE "store_orders" ADD COLUMN "pg_session" jsonb;--> statement-breakpoint
CREATE UNIQUE INDEX "store_orders_pg_order" ON "store_orders" USING btree ("pg_order_id");