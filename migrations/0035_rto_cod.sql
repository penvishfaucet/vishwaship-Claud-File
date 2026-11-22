CREATE TABLE "cod_disputes" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"shipment_id" text NOT NULL,
	"note" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"resolution" text,
	"created_by" text,
	"resolved_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "rto_charges" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"shipment_id" text NOT NULL,
	"state" text DEFAULT 'awaiting' NOT NULL,
	"estimate_paise" bigint DEFAULT 0 NOT NULL,
	"estimate_basis" text,
	"final_paise" bigint,
	"gst_paise" bigint,
	"other_paise" bigint DEFAULT 0 NOT NULL,
	"credits_paise" bigint DEFAULT 0 NOT NULL,
	"source" text,
	"reference" text,
	"charged_paise" bigint DEFAULT 0 NOT NULL,
	"history" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "cod_disputes_org" ON "cod_disputes" USING btree ("org_id","status");--> statement-breakpoint
CREATE INDEX "cod_disputes_ship" ON "cod_disputes" USING btree ("shipment_id");--> statement-breakpoint
CREATE UNIQUE INDEX "rto_charges_shipment" ON "rto_charges" USING btree ("shipment_id");--> statement-breakpoint
CREATE INDEX "rto_charges_org" ON "rto_charges" USING btree ("org_id","state");