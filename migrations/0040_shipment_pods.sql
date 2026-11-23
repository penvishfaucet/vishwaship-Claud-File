CREATE TABLE "shipment_pods" (
	"shipment_id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"state" text DEFAULT 'pending' NOT NULL,
	"file_key" text,
	"file_mime" text,
	"signature_key" text,
	"signature_mime" text,
	"receiver_name" text,
	"receiver_relation" text,
	"delivery_mode" text,
	"delivered_at" timestamp with time zone,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone,
	"last_error" text,
	"fetched_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "shipment_pods" ADD CONSTRAINT "shipment_pods_shipment_id_shipments_id_fk" FOREIGN KEY ("shipment_id") REFERENCES "public"."shipments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "shipment_pods_org" ON "shipment_pods" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "shipment_pods_due" ON "shipment_pods" USING btree ("state","next_attempt_at");