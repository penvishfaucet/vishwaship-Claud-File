CREATE TABLE "pickup_requests" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"warehouse_id" text NOT NULL,
	"provider_account_id" text NOT NULL,
	"pickup_date" text NOT NULL,
	"provider_ref" text,
	"status" text NOT NULL,
	"shipment_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"package_count" integer DEFAULT 0 NOT NULL,
	"agent_name" text,
	"agent_phone" text,
	"last_error" text,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "shipments" ADD COLUMN "pickup_request_id" text;--> statement-breakpoint
ALTER TABLE "shipments" ADD COLUMN "pickup_agent_name" text;--> statement-breakpoint
ALTER TABLE "shipments" ADD COLUMN "pickup_agent_phone" text;--> statement-breakpoint
ALTER TABLE "pickup_requests" ADD CONSTRAINT "pickup_requests_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pickup_requests" ADD CONSTRAINT "pickup_requests_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "pickup_requests_org" ON "pickup_requests" USING btree ("org_id","pickup_date");
