CREATE TABLE "store_categories" (
	"id" text PRIMARY KEY NOT NULL,
	"store_id" text NOT NULL,
	"org_id" text NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "store_domains" (
	"id" text PRIMARY KEY NOT NULL,
	"store_id" text NOT NULL,
	"org_id" text NOT NULL,
	"hostname" text NOT NULL,
	"verify_token" text NOT NULL,
	"status" text DEFAULT 'pending_dns' NOT NULL,
	"ssl_status" text DEFAULT 'pending_setup' NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL,
	"last_checked_at" timestamp with time zone,
	"last_check_message" text,
	"verified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "store_help_requests" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"mobile" text NOT NULL,
	"email" text,
	"message" text,
	"org_id" text,
	"status" text DEFAULT 'new' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "store_media" (
	"id" text PRIMARY KEY NOT NULL,
	"store_id" text NOT NULL,
	"org_id" text NOT NULL,
	"mime" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"data" "bytea" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "store_products" (
	"id" text PRIMARY KEY NOT NULL,
	"store_id" text NOT NULL,
	"org_id" text NOT NULL,
	"title" text NOT NULL,
	"slug" text NOT NULL,
	"description" text,
	"price_paise" bigint NOT NULL,
	"compare_paise" bigint,
	"category_id" text,
	"images" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"stock" integer DEFAULT 0 NOT NULL,
	"weight_grams" integer DEFAULT 500 NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"featured" boolean DEFAULT false NOT NULL,
	"seo" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "store_theme_versions" (
	"id" text PRIMARY KEY NOT NULL,
	"store_id" text NOT NULL,
	"org_id" text NOT NULL,
	"version" integer NOT NULL,
	"theme_key" text NOT NULL,
	"config" jsonb NOT NULL,
	"published_by" text,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stores" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"onboarding_step" integer DEFAULT 1 NOT NULL,
	"steps_done" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"theme_key" text DEFAULT 'bazaar' NOT NULL,
	"draft_theme" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"published_theme" jsonb,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"custom_design" boolean DEFAULT false NOT NULL,
	"suspended_reason" text,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "store_categories" ADD CONSTRAINT "store_categories_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_domains" ADD CONSTRAINT "store_domains_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_media" ADD CONSTRAINT "store_media_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_products" ADD CONSTRAINT "store_products_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_products" ADD CONSTRAINT "store_products_category_id_store_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."store_categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_theme_versions" ADD CONSTRAINT "store_theme_versions_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stores" ADD CONSTRAINT "stores_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "store_categories_slug" ON "store_categories" USING btree ("store_id","slug");--> statement-breakpoint
CREATE UNIQUE INDEX "store_domains_host" ON "store_domains" USING btree ("hostname");--> statement-breakpoint
CREATE INDEX "store_domains_store" ON "store_domains" USING btree ("store_id");--> statement-breakpoint
CREATE INDEX "store_media_store" ON "store_media" USING btree ("store_id");--> statement-breakpoint
CREATE UNIQUE INDEX "store_products_slug" ON "store_products" USING btree ("store_id","slug");--> statement-breakpoint
CREATE INDEX "store_products_store" ON "store_products" USING btree ("store_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "store_theme_versions_v" ON "store_theme_versions" USING btree ("store_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "stores_slug" ON "stores" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "stores_org" ON "stores" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "stores_status" ON "stores" USING btree ("status");