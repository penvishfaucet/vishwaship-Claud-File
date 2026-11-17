CREATE TABLE "assign_rules" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"name" text NOT NULL,
	"priority" integer DEFAULT 100 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"conditions" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"couriers" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "billing_documents" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"kind" text NOT NULL,
	"number" text NOT NULL,
	"doc_date" timestamp with time zone NOT NULL,
	"period_from" timestamp with time zone,
	"period_to" timestamp with time zone,
	"taxable_paise" bigint NOT NULL,
	"gst_paise" bigint NOT NULL,
	"total_paise" bigint NOT NULL,
	"reason" text,
	"ref_type" text,
	"ref_id" text,
	"lines" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "billing_documents_number_unique" UNIQUE("number")
);
--> statement-breakpoint
CREATE TABLE "buyers" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"name" text NOT NULL,
	"mobile" text NOT NULL,
	"email" text,
	"addresses" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cod_remittance_items" (
	"remittance_id" text NOT NULL,
	"shipment_id" text NOT NULL,
	"cod_paise" bigint NOT NULL,
	CONSTRAINT "cod_remittance_items_remittance_id_shipment_id_pk" PRIMARY KEY("remittance_id","shipment_id"),
	CONSTRAINT "cod_remittance_items_shipment_id_unique" UNIQUE("shipment_id")
);
--> statement-breakpoint
CREATE TABLE "cod_remittances" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"reference" text,
	"cycle_date" timestamp with time zone NOT NULL,
	"expected_payout_at" timestamp with time zone NOT NULL,
	"gross_paise" bigint NOT NULL,
	"deductions_paise" bigint DEFAULT 0 NOT NULL,
	"net_paise" bigint NOT NULL,
	"deduction_note" text,
	"status" text DEFAULT 'scheduled' NOT NULL,
	"early_cod" boolean DEFAULT false NOT NULL,
	"paid_at" timestamp with time zone,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "early_cod_subscriptions" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"status" text NOT NULL,
	"fee_bps" integer NOT NULL,
	"cycle_days" integer NOT NULL,
	"terms_version" integer NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"cancelled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "order_tag_links" (
	"order_id" text NOT NULL,
	"tag_id" text NOT NULL,
	CONSTRAINT "order_tag_links_order_id_tag_id_pk" PRIMARY KEY("order_id","tag_id")
);
--> statement-breakpoint
CREATE TABLE "order_tags" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"name" text NOT NULL,
	"color" text DEFAULT '#0b1f3a' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "org_settings" (
	"org_id" text NOT NULL,
	"key" text NOT NULL,
	"value" jsonb NOT NULL,
	"updated_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "org_settings_org_id_key_pk" PRIMARY KEY("org_id","key")
);
--> statement-breakpoint
CREATE TABLE "packaging_presets" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"name" text NOT NULL,
	"length_mm" integer NOT NULL,
	"breadth_mm" integer NOT NULL,
	"height_mm" integer NOT NULL,
	"tare_grams" integer DEFAULT 0 NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"name" text NOT NULL,
	"sku" text NOT NULL,
	"unit_price_paise" bigint DEFAULT 0 NOT NULL,
	"hsn" text,
	"weight_grams" integer DEFAULT 0 NOT NULL,
	"length_mm" integer DEFAULT 0 NOT NULL,
	"breadth_mm" integer DEFAULT 0 NOT NULL,
	"height_mm" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "report_exports" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"user_id" text,
	"report_key" text NOT NULL,
	"filters" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"format" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"row_count" integer,
	"file_b64" text,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"expires_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "assign_rules" ADD CONSTRAINT "assign_rules_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_documents" ADD CONSTRAINT "billing_documents_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "buyers" ADD CONSTRAINT "buyers_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cod_remittance_items" ADD CONSTRAINT "cod_remittance_items_remittance_id_cod_remittances_id_fk" FOREIGN KEY ("remittance_id") REFERENCES "public"."cod_remittances"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cod_remittance_items" ADD CONSTRAINT "cod_remittance_items_shipment_id_shipments_id_fk" FOREIGN KEY ("shipment_id") REFERENCES "public"."shipments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cod_remittances" ADD CONSTRAINT "cod_remittances_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "early_cod_subscriptions" ADD CONSTRAINT "early_cod_subscriptions_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_tag_links" ADD CONSTRAINT "order_tag_links_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_tag_links" ADD CONSTRAINT "order_tag_links_tag_id_order_tags_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."order_tags"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_tags" ADD CONSTRAINT "order_tags_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_settings" ADD CONSTRAINT "org_settings_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "packaging_presets" ADD CONSTRAINT "packaging_presets_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_exports" ADD CONSTRAINT "report_exports_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "assign_rules_org" ON "assign_rules" USING btree ("org_id","priority");--> statement-breakpoint
CREATE INDEX "billing_docs_org" ON "billing_documents" USING btree ("org_id","kind","doc_date");--> statement-breakpoint
CREATE UNIQUE INDEX "buyers_org_mobile" ON "buyers" USING btree ("org_id","mobile");--> statement-breakpoint
CREATE INDEX "cod_remit_org" ON "cod_remittances" USING btree ("org_id","cycle_date");--> statement-breakpoint
CREATE INDEX "early_cod_org" ON "early_cod_subscriptions" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "order_tags_org_name" ON "order_tags" USING btree ("org_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "packaging_org_name" ON "packaging_presets" USING btree ("org_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "products_org_sku" ON "products" USING btree ("org_id","sku");--> statement-breakpoint
CREATE INDEX "report_exports_org" ON "report_exports" USING btree ("org_id","created_at");