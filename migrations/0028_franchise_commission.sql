CREATE TABLE "franchise_commissions" (
	"id" text PRIMARY KEY NOT NULL,
	"franchise_id" text NOT NULL,
	"org_id" text NOT NULL,
	"shipment_id" text NOT NULL,
	"eligible_paise" bigint NOT NULL,
	"customer_bps" integer NOT NULL,
	"base_bps" integer NOT NULL,
	"amount_paise" bigint NOT NULL,
	"status" text DEFAULT 'earned' NOT NULL,
	"payout_id" text,
	"delivered_at" timestamp with time zone NOT NULL,
	"period" text NOT NULL,
	"void_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "franchise_payouts" (
	"id" text PRIMARY KEY NOT NULL,
	"franchise_id" text NOT NULL,
	"period" text NOT NULL,
	"statement_number" text NOT NULL,
	"shipments" integer NOT NULL,
	"gross_paise" bigint NOT NULL,
	"tds_bps" integer NOT NULL,
	"tds_paise" bigint NOT NULL,
	"adjustment_paise" bigint DEFAULT 0 NOT NULL,
	"adjustment_note" text,
	"net_paise" bigint NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"utr" text,
	"paid_on" timestamp with time zone,
	"created_by" text NOT NULL,
	"approved_by" text,
	"approved_at" timestamp with time zone,
	"paid_by" text,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "franchises" ADD COLUMN "base_markup_bps" integer;--> statement-breakpoint
ALTER TABLE "franchises" ADD COLUMN "min_customer_bps" integer;--> statement-breakpoint
ALTER TABLE "franchises" ADD COLUMN "max_customer_bps" integer;--> statement-breakpoint
ALTER TABLE "franchises" ADD COLUMN "default_customer_bps" integer;--> statement-breakpoint
ALTER TABLE "franchises" ADD COLUMN "commission_from" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "franchises" ADD COLUMN "payout_account_name" text;--> statement-breakpoint
ALTER TABLE "franchises" ADD COLUMN "payout_account_last4" text;--> statement-breakpoint
ALTER TABLE "franchises" ADD COLUMN "payout_ifsc" text;--> statement-breakpoint
ALTER TABLE "franchise_commissions" ADD CONSTRAINT "franchise_commissions_franchise_id_franchises_id_fk" FOREIGN KEY ("franchise_id") REFERENCES "public"."franchises"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "franchise_payouts" ADD CONSTRAINT "franchise_payouts_franchise_id_franchises_id_fk" FOREIGN KEY ("franchise_id") REFERENCES "public"."franchises"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "franchise_commissions_shipment" ON "franchise_commissions" USING btree ("shipment_id");--> statement-breakpoint
CREATE INDEX "franchise_commissions_fr_period" ON "franchise_commissions" USING btree ("franchise_id","period","status");--> statement-breakpoint
CREATE UNIQUE INDEX "franchise_payouts_statement" ON "franchise_payouts" USING btree ("statement_number");--> statement-breakpoint
CREATE UNIQUE INDEX "franchise_payouts_live_period" ON "franchise_payouts" USING btree ("franchise_id","period") WHERE status <> 'cancelled';