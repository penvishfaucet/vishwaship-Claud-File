-- COD payouts (owner 2026-11-24): what the couriers paid us per AWB, the client payout bank account, and per payout the
-- client dues settled from it. Clients are paid only COD a courier has paid in (or under Early COD).
CREATE TABLE "cod_receipt_imports" (
	"id" text PRIMARY KEY NOT NULL,
	"source" text NOT NULL,
	"file_name" text,
	"rows" integer DEFAULT 0 NOT NULL,
	"matched" integer DEFAULT 0 NOT NULL,
	"flagged" integer DEFAULT 0 NOT NULL,
	"total_paise" bigint DEFAULT 0 NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cod_receipts" (
	"id" text PRIMARY KEY NOT NULL,
	"awb" text NOT NULL,
	"shipment_id" text,
	"org_id" text,
	"amount_paise" bigint NOT NULL,
	"expected_paise" bigint,
	"utr" text,
	"remitted_on" timestamp with time zone,
	"status" text NOT NULL,
	"note" text,
	"import_id" text,
	"resolved_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone,
	CONSTRAINT "cod_receipts_awb_unique" UNIQUE("awb")
);
--> statement-breakpoint
CREATE TABLE "org_payout_accounts" (
	"org_id" text PRIMARY KEY NOT NULL,
	"holder_name" text NOT NULL,
	"account_enc" text NOT NULL,
	"account_last4" text NOT NULL,
	"ifsc" text NOT NULL,
	"bank_name" text,
	"updated_by" text,
	"updated_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "cod_remittances" ADD COLUMN "wallet_offset_paise" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "cod_remittances" ADD COLUMN "run_id" text;--> statement-breakpoint
ALTER TABLE "cod_receipts" ADD CONSTRAINT "cod_receipts_shipment_id_shipments_id_fk" FOREIGN KEY ("shipment_id") REFERENCES "public"."shipments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cod_receipts" ADD CONSTRAINT "cod_receipts_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cod_receipts" ADD CONSTRAINT "cod_receipts_import_id_cod_receipt_imports_id_fk" FOREIGN KEY ("import_id") REFERENCES "public"."cod_receipt_imports"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_payout_accounts" ADD CONSTRAINT "org_payout_accounts_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cod_receipts_shipment" ON "cod_receipts" USING btree ("shipment_id");--> statement-breakpoint
CREATE INDEX "cod_receipts_status" ON "cod_receipts" USING btree ("status");