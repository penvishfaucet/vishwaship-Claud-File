CREATE TABLE "store_expenses" (
	"id" text PRIMARY KEY NOT NULL,
	"store_id" text NOT NULL,
	"org_id" text NOT NULL,
	"spent_on" text NOT NULL,
	"category" text NOT NULL,
	"amount_paise" bigint NOT NULL,
	"gst_paise" bigint DEFAULT 0 NOT NULL,
	"gst_recoverable" boolean DEFAULT false NOT NULL,
	"note" text,
	"store_order_id" text,
	"receipt_key" text,
	"receipt_mime" text,
	"recurring" boolean DEFAULT false NOT NULL,
	"recurring_of" text,
	"recurring_month" text,
	"created_by" text,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "store_expenses_store_day" ON "store_expenses" USING btree ("store_id","spent_on");--> statement-breakpoint
CREATE UNIQUE INDEX "store_expenses_recurring" ON "store_expenses" USING btree ("recurring_of","recurring_month");