CREATE TABLE "store_connections" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"platform" text NOT NULL,
	"store_url" text NOT NULL,
	"credentials_enc" text NOT NULL,
	"credentials_hint" text,
	"status" text DEFAULT 'connected' NOT NULL,
	"warehouse_id" text,
	"default_package" jsonb DEFAULT '{"lengthCm":20,"breadthCm":15,"heightCm":10,"weightKg":0.5}'::jsonb NOT NULL,
	"auto_sync" boolean DEFAULT false NOT NULL,
	"push_tracking" boolean DEFAULT true NOT NULL,
	"last_sync_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "store_import_log" (
	"id" text PRIMARY KEY NOT NULL,
	"connection_id" text NOT NULL,
	"run_id" text NOT NULL,
	"external_order_id" text NOT NULL,
	"external_order_name" text,
	"outcome" text NOT NULL,
	"message" text,
	"order_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "store_connections" ADD CONSTRAINT "store_connections_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_connections" ADD CONSTRAINT "store_connections_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_import_log" ADD CONSTRAINT "store_import_log_connection_id_store_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."store_connections"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "store_conn_org_url" ON "store_connections" USING btree ("org_id","store_url");--> statement-breakpoint
CREATE INDEX "store_import_conn" ON "store_import_log" USING btree ("connection_id","created_at");