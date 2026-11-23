CREATE TABLE "courier_bill_lines" (
	"id" text PRIMARY KEY NOT NULL,
	"bill_id" text NOT NULL,
	"awb" text,
	"shipment_id" text,
	"org_id" text,
	"charge_type" text DEFAULT 'forward' NOT NULL,
	"taxable_paise" bigint NOT NULL,
	"gst_paise" bigint DEFAULT 0 NOT NULL,
	"total_paise" bigint NOT NULL,
	"match_status" text DEFAULT 'unmatched' NOT NULL,
	"note" text
);
--> statement-breakpoint
CREATE TABLE "courier_bills" (
	"id" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"supplier_name" text NOT NULL,
	"supplier_gstin" text,
	"billed_gstin" text,
	"number" text NOT NULL,
	"doc_date" timestamp with time zone NOT NULL,
	"original_bill_id" text,
	"place_of_supply" text,
	"taxable_paise" bigint NOT NULL,
	"cgst_paise" bigint DEFAULT 0 NOT NULL,
	"sgst_paise" bigint DEFAULT 0 NOT NULL,
	"utgst_paise" bigint DEFAULT 0 NOT NULL,
	"igst_paise" bigint DEFAULT 0 NOT NULL,
	"total_paise" bigint NOT NULL,
	"tax_period" text NOT NULL,
	"file_key" text,
	"itc_status" text DEFAULT 'pending_review' NOT NULL,
	"gstr2b_status" text DEFAULT 'not_checked' NOT NULL,
	"source" text DEFAULT 'manual' NOT NULL,
	"import_batch" text,
	"notes" text,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "courier_payment_allocations" (
	"id" text PRIMARY KEY NOT NULL,
	"payment_id" text NOT NULL,
	"bill_id" text NOT NULL,
	"amount_paise" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "courier_payments" (
	"id" text PRIMARY KEY NOT NULL,
	"supplier_name" text NOT NULL,
	"amount_paise" bigint NOT NULL,
	"paid_at" timestamp with time zone NOT NULL,
	"reference" text NOT NULL,
	"method" text,
	"notes" text,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "billing_documents" ADD COLUMN "supplier_gstin" text;--> statement-breakpoint
ALTER TABLE "billing_documents" ADD COLUMN "supplier_state" text;--> statement-breakpoint
ALTER TABLE "billing_documents" ADD COLUMN "recipient_name" text;--> statement-breakpoint
ALTER TABLE "billing_documents" ADD COLUMN "recipient_gstin" text;--> statement-breakpoint
ALTER TABLE "billing_documents" ADD COLUMN "place_of_supply" text;--> statement-breakpoint
ALTER TABLE "billing_documents" ADD COLUMN "sac" text;--> statement-breakpoint
ALTER TABLE "billing_documents" ADD COLUMN "rate_bps" integer;--> statement-breakpoint
ALTER TABLE "billing_documents" ADD COLUMN "cgst_paise" bigint;--> statement-breakpoint
ALTER TABLE "billing_documents" ADD COLUMN "sgst_paise" bigint;--> statement-breakpoint
ALTER TABLE "billing_documents" ADD COLUMN "utgst_paise" bigint;--> statement-breakpoint
ALTER TABLE "billing_documents" ADD COLUMN "igst_paise" bigint;--> statement-breakpoint
ALTER TABLE "billing_documents" ADD COLUMN "original_doc_id" text;--> statement-breakpoint
ALTER TABLE "billing_documents" ADD COLUMN "tax_period" text;--> statement-breakpoint
ALTER TABLE "billing_documents" ADD COLUMN "tax_snapshot_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "courier_bill_lines" ADD CONSTRAINT "courier_bill_lines_bill_id_courier_bills_id_fk" FOREIGN KEY ("bill_id") REFERENCES "public"."courier_bills"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "courier_payment_allocations" ADD CONSTRAINT "courier_payment_allocations_payment_id_courier_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."courier_payments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "courier_payment_allocations" ADD CONSTRAINT "courier_payment_allocations_bill_id_courier_bills_id_fk" FOREIGN KEY ("bill_id") REFERENCES "public"."courier_bills"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "courier_bill_lines_bill" ON "courier_bill_lines" USING btree ("bill_id");--> statement-breakpoint
CREATE INDEX "courier_bill_lines_ship" ON "courier_bill_lines" USING btree ("shipment_id");--> statement-breakpoint
CREATE INDEX "courier_bill_lines_awb" ON "courier_bill_lines" USING btree ("awb");--> statement-breakpoint
CREATE UNIQUE INDEX "courier_bills_doc" ON "courier_bills" USING btree ("supplier_name","kind","number");--> statement-breakpoint
CREATE INDEX "courier_bills_period" ON "courier_bills" USING btree ("tax_period");--> statement-breakpoint
CREATE UNIQUE INDEX "courier_payment_alloc" ON "courier_payment_allocations" USING btree ("payment_id","bill_id");--> statement-breakpoint
CREATE UNIQUE INDEX "courier_payments_ref" ON "courier_payments" USING btree ("supplier_name","reference");