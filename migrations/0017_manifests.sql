CREATE TABLE "manifests" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"manifest_no" text NOT NULL,
	"scope" text NOT NULL,
	"booking_date" text NOT NULL,
	"filters" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"groups" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"awb_count" integer NOT NULL,
	"box_count" integer NOT NULL,
	"pdf_key" text NOT NULL,
	"signed_copy" jsonb,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "manifests_manifest_no_unique" UNIQUE("manifest_no")
);
--> statement-breakpoint
ALTER TABLE "manifests" ADD CONSTRAINT "manifests_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "manifests_org_created" ON "manifests" USING btree ("org_id","created_at");