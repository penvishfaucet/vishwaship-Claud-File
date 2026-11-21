CREATE TABLE "franchise_areas" (
	"id" text PRIMARY KEY NOT NULL,
	"franchise_id" text NOT NULL,
	"kind" text NOT NULL,
	"state" text NOT NULL,
	"district" text,
	"pincode" text,
	"area_key" text NOT NULL,
	"assigned_by" text,
	"released_at" timestamp with time zone,
	"released_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "franchise_deposits" (
	"id" text PRIMARY KEY NOT NULL,
	"franchise_id" text NOT NULL,
	"receipt_number" text NOT NULL,
	"amount_paise" bigint NOT NULL,
	"method" text NOT NULL,
	"reference" text,
	"received_on" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'held' NOT NULL,
	"refund_paise" bigint DEFAULT 0 NOT NULL,
	"forfeit_paise" bigint DEFAULT 0 NOT NULL,
	"refund_reference" text,
	"decision_note" text,
	"decided_by" text,
	"decided_at" timestamp with time zone,
	"recorded_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "franchise_terms" (
	"version" integer PRIMARY KEY NOT NULL,
	"body" text NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "franchises" (
	"id" text PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"business_name" text NOT NULL,
	"owner_name" text NOT NULL,
	"mobile" text NOT NULL,
	"email" text NOT NULL,
	"gstin" text,
	"pan" text,
	"address" jsonb,
	"status" text DEFAULT 'draft' NOT NULL,
	"status_reason" text,
	"deposit_required_paise" bigint DEFAULT 0 NOT NULL,
	"monthly_target_shipments" integer DEFAULT 0 NOT NULL,
	"term_start" timestamp with time zone,
	"term_end" timestamp with time zone,
	"terms_version" integer,
	"agreement_signed_at" timestamp with time zone,
	"kyc_verified_at" timestamp with time zone,
	"notes" text,
	"created_by" text,
	"activated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "franchise_areas" ADD CONSTRAINT "franchise_areas_franchise_id_franchises_id_fk" FOREIGN KEY ("franchise_id") REFERENCES "public"."franchises"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "franchise_deposits" ADD CONSTRAINT "franchise_deposits_franchise_id_franchises_id_fk" FOREIGN KEY ("franchise_id") REFERENCES "public"."franchises"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "franchise_areas_live_key" ON "franchise_areas" USING btree ("area_key") WHERE released_at is null;--> statement-breakpoint
CREATE INDEX "franchise_areas_franchise" ON "franchise_areas" USING btree ("franchise_id");--> statement-breakpoint
CREATE INDEX "franchise_areas_state" ON "franchise_areas" USING btree ("state");--> statement-breakpoint
CREATE UNIQUE INDEX "franchise_deposits_receipt" ON "franchise_deposits" USING btree ("receipt_number");--> statement-breakpoint
CREATE INDEX "franchise_deposits_franchise" ON "franchise_deposits" USING btree ("franchise_id");--> statement-breakpoint
CREATE UNIQUE INDEX "franchises_code" ON "franchises" USING btree ("code");--> statement-breakpoint
CREATE INDEX "franchises_status" ON "franchises" USING btree ("status");