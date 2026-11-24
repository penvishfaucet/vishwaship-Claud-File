CREATE TABLE "store_buyers" (
	"id" text PRIMARY KEY NOT NULL,
	"store_id" text NOT NULL,
	"org_id" text NOT NULL,
	"mobile" text,
	"email" text,
	"name" text DEFAULT '' NOT NULL,
	"addresses" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "store_orders" ADD COLUMN "buyer_id" text;--> statement-breakpoint
ALTER TABLE "store_orders" ADD COLUMN "return_request" jsonb;--> statement-breakpoint
ALTER TABLE "store_buyers" ADD CONSTRAINT "store_buyers_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "store_buyers_mobile" ON "store_buyers" USING btree ("store_id","mobile");--> statement-breakpoint
CREATE UNIQUE INDEX "store_buyers_email" ON "store_buyers" USING btree ("store_id","email");