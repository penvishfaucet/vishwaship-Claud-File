CREATE TYPE "public"."kyc_status" AS ENUM('not_started', 'pending', 'approved', 'changes_requested', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."staff_role" AS ENUM('owner', 'operations', 'finance', 'support', 'readonly');--> statement-breakpoint
CREATE TABLE "api_keys" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text,
	"label" text NOT NULL,
	"secret_hash" text NOT NULL,
	"scopes" jsonb NOT NULL,
	"expires_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"last_used_at" timestamp with time zone,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" text PRIMARY KEY NOT NULL,
	"actor_user_id" text,
	"actor_kind" text NOT NULL,
	"org_id" text,
	"action" text NOT NULL,
	"target_type" text,
	"target_id" text,
	"details" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cod_confirmations" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"order_id" text NOT NULL,
	"status" text NOT NULL,
	"sent_at" timestamp with time zone,
	"reminder_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"decided_at" timestamp with time zone,
	"reply_message_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cod_confirmations_order_id_unique" UNIQUE("order_id")
);
--> statement-breakpoint
CREATE TABLE "credit_balances" (
	"org_id" text PRIMARY KEY NOT NULL,
	"credits" integer DEFAULT 0 NOT NULL,
	"held" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "credit_entries" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"kind" text NOT NULL,
	"credits" integer NOT NULL,
	"idempotency_key" text NOT NULL,
	"ref_type" text,
	"ref_id" text,
	"price_paise" bigint,
	"gst_paise" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "credit_entries_idempotency_key_unique" UNIQUE("idempotency_key")
);
--> statement-breakpoint
CREATE TABLE "credit_packs" (
	"id" text PRIMARY KEY NOT NULL,
	"credits" integer NOT NULL,
	"unit_price_paise" integer NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "idempotency_records" (
	"key" text PRIMARY KEY NOT NULL,
	"request_hash" text NOT NULL,
	"response_status" integer,
	"response_body" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "in_app_alerts" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"href" text,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inbound_events" (
	"id" text PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"dedupe_key" text NOT NULL,
	"verified" boolean NOT NULL,
	"payload_redacted" jsonb NOT NULL,
	"processed_at" timestamp with time zone,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inbound_events_dedupe_key_unique" UNIQUE("dedupe_key")
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" text PRIMARY KEY NOT NULL,
	"queue" text NOT NULL,
	"payload" jsonb NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"run_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_error" text,
	"dedupe_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "jobs_dedupe_key_unique" UNIQUE("dedupe_key")
);
--> statement-breakpoint
CREATE TABLE "kyc_documents" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"doc_type" text NOT NULL,
	"storage_key" text NOT NULL,
	"mime" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"masked_number" text,
	"status" "kyc_status" DEFAULT 'pending' NOT NULL,
	"reviewer_id" text,
	"review_reason" text,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ledger_entries" (
	"id" text PRIMARY KEY NOT NULL,
	"wallet_id" text NOT NULL,
	"kind" text NOT NULL,
	"amount_paise" bigint NOT NULL,
	"hold_delta_paise" bigint DEFAULT 0 NOT NULL,
	"idempotency_key" text NOT NULL,
	"reservation_id" text,
	"ref_type" text,
	"ref_id" text,
	"balance_after_paise" bigint NOT NULL,
	"reserved_after_paise" bigint NOT NULL,
	"memo" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ledger_entries_idempotency_key_unique" UNIQUE("idempotency_key")
);
--> statement-breakpoint
CREATE TABLE "markup_rules" (
	"id" text PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"org_id" text,
	"bps" integer NOT NULL,
	"version" integer NOT NULL,
	"effective_from" timestamp with time zone NOT NULL,
	"cleared_at" timestamp with time zone,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ndr_cases" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"shipment_id" text NOT NULL,
	"kind" text NOT NULL,
	"reason" text,
	"attempt" integer DEFAULT 1 NOT NULL,
	"deadline_at" timestamp with time zone,
	"status" text DEFAULT 'open' NOT NULL,
	"requested_action" text,
	"request_payload" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notification_deliveries" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"channel" text NOT NULL,
	"event" text NOT NULL,
	"dedupe_key" text NOT NULL,
	"recipient_masked" text NOT NULL,
	"provider_account_id" text,
	"provider_message_id" text,
	"status" text NOT NULL,
	"credits_charged" integer DEFAULT 0 NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notification_deliveries_dedupe_key_unique" UNIQUE("dedupe_key")
);
--> statement-breakpoint
CREATE TABLE "notification_settings" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text,
	"channel" text NOT NULL,
	"event" text NOT NULL,
	"enabled" boolean NOT NULL,
	"template_id" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notification_templates" (
	"id" text PRIMARY KEY NOT NULL,
	"channel" text NOT NULL,
	"event" text NOT NULL,
	"language" text DEFAULT 'en' NOT NULL,
	"body" text NOT NULL,
	"provider_template_name" text,
	"approval_state" text DEFAULT 'draft' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "one_time_tokens" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"purpose" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"order_number" text NOT NULL,
	"source" text DEFAULT 'manual' NOT NULL,
	"external_store_id" text,
	"external_order_id" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"mode" text NOT NULL,
	"direction" text DEFAULT 'forward' NOT NULL,
	"payment_type" text NOT NULL,
	"cod_amount_paise" bigint DEFAULT 0 NOT NULL,
	"declared_value_paise" bigint NOT NULL,
	"warehouse_id" text,
	"consignee" jsonb NOT NULL,
	"products" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"invoice_number" text,
	"eway_bill" text,
	"buyer_gstin" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "orgs" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"business_name" text NOT NULL,
	"gstin" text,
	"expected_monthly_volume" text,
	"status" text DEFAULT 'active' NOT NULL,
	"kyc_status" "kyc_status" DEFAULT 'not_started' NOT NULL,
	"bank_account_masked" text,
	"bank_ifsc" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "otp_challenges" (
	"id" text PRIMARY KEY NOT NULL,
	"target" text NOT NULL,
	"purpose" text NOT NULL,
	"code_hash" text NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"verified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "packages" (
	"id" text PRIMARY KEY NOT NULL,
	"order_id" text NOT NULL,
	"count" integer NOT NULL,
	"length_mm" integer NOT NULL,
	"breadth_mm" integer NOT NULL,
	"height_mm" integer NOT NULL,
	"actual_weight_grams" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pricing_settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "provider_accounts" (
	"id" text PRIMARY KEY NOT NULL,
	"adapter" text NOT NULL,
	"category" text NOT NULL,
	"label" text NOT NULL,
	"mode" text DEFAULT 'test' NOT NULL,
	"status" text DEFAULT 'disabled' NOT NULL,
	"priority" integer DEFAULT 100 NOT NULL,
	"config_public" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"secrets_enc" text,
	"secrets_hint" jsonb,
	"capabilities" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"last_test_at" timestamp with time zone,
	"last_test_ok" boolean,
	"last_test_message" text,
	"last_success_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "public_rate_card" (
	"id" text PRIMARY KEY NOT NULL,
	"zone" text NOT NULL,
	"description" text NOT NULL,
	"first_slab_grams" integer NOT NULL,
	"first_slab_paise" bigint NOT NULL,
	"additional_slab_grams" integer NOT NULL,
	"additional_slab_paise" bigint NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "quotes" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text,
	"provider_account_id" text,
	"provider" text NOT NULL,
	"carrier_code" text NOT NULL,
	"service_name" text NOT NULL,
	"mode" text NOT NULL,
	"request" jsonb NOT NULL,
	"priced" jsonb NOT NULL,
	"total_paise" bigint NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rate_limits" (
	"key" text PRIMARY KEY NOT NULL,
	"count" integer NOT NULL,
	"window_start" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recharges" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"amount_paise" bigint NOT NULL,
	"currency" text DEFAULT 'INR' NOT NULL,
	"razorpay_order_id" text,
	"razorpay_payment_id" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "recharges_razorpay_order_id_unique" UNIQUE("razorpay_order_id"),
	CONSTRAINT "recharges_razorpay_payment_id_unique" UNIQUE("razorpay_payment_id")
);
--> statement-breakpoint
CREATE TABLE "reservations" (
	"id" text PRIMARY KEY NOT NULL,
	"wallet_id" text NOT NULL,
	"amount_paise" bigint NOT NULL,
	"status" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"mfa_passed" boolean DEFAULT false NOT NULL,
	"ip" text,
	"user_agent" text
);
--> statement-breakpoint
CREATE TABLE "shipment_events" (
	"id" text PRIMARY KEY NOT NULL,
	"shipment_id" text NOT NULL,
	"dedupe_key" text NOT NULL,
	"status" text NOT NULL,
	"raw_status" text,
	"location" text,
	"occurred_at" timestamp with time zone NOT NULL,
	"source" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shipments" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"order_id" text NOT NULL,
	"provider_account_id" text NOT NULL,
	"provider" text NOT NULL,
	"carrier_code" text NOT NULL,
	"carrier_name" text NOT NULL,
	"service_name" text NOT NULL,
	"provider_order_ref" text,
	"awb" text,
	"lr_number" text,
	"piece_ids" jsonb,
	"booking_status" text NOT NULL,
	"pickup_status" text DEFAULT 'not_scheduled' NOT NULL,
	"label_status" text DEFAULT 'not_generated' NOT NULL,
	"status" text DEFAULT 'booked' NOT NULL,
	"quote_id" text NOT NULL,
	"sell_paise" bigint NOT NULL,
	"cost_paise" bigint NOT NULL,
	"reservation_id" text,
	"chargeable_weight_grams" integer NOT NULL,
	"carrier_weight_grams" integer,
	"eta_date" timestamp with time zone,
	"last_event_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ticket_messages" (
	"id" text PRIMARY KEY NOT NULL,
	"ticket_id" text NOT NULL,
	"author_user_id" text NOT NULL,
	"author_kind" text NOT NULL,
	"body" text NOT NULL,
	"attachments" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tickets" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"number" text NOT NULL,
	"category" text NOT NULL,
	"subject" text NOT NULL,
	"shipment_id" text,
	"awb" text,
	"status" text DEFAULT 'open' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tickets_number_unique" UNIQUE("number")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"org_id" text,
	"name" text NOT NULL,
	"email" text,
	"mobile" text,
	"email_verified_at" timestamp with time zone,
	"mobile_verified_at" timestamp with time zone,
	"password_hash" text,
	"must_reset_password" boolean DEFAULT false NOT NULL,
	"staff_role" "staff_role",
	"mfa_secret_enc" text,
	"mfa_enabled" boolean DEFAULT false NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wallets" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"posted_paise" bigint DEFAULT 0 NOT NULL,
	"reserved_paise" bigint DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "wallets_org_id_unique" UNIQUE("org_id")
);
--> statement-breakpoint
CREATE TABLE "warehouse_provider_sync" (
	"id" text PRIMARY KEY NOT NULL,
	"warehouse_id" text NOT NULL,
	"provider_account_id" text NOT NULL,
	"provider_warehouse_ref" text,
	"status" text NOT NULL,
	"last_error" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "warehouses" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"label" text NOT NULL,
	"contact_name" text NOT NULL,
	"mobile" text NOT NULL,
	"mobile_verified_at" timestamp with time zone,
	"line1" text NOT NULL,
	"line2" text,
	"pincode" text NOT NULL,
	"city" text NOT NULL,
	"state" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webhook_deliveries" (
	"id" text PRIMARY KEY NOT NULL,
	"endpoint_id" text NOT NULL,
	"event_id" text NOT NULL,
	"event_type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"status" text NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_status_code" integer,
	"next_attempt_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webhook_endpoints" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"url" text NOT NULL,
	"secret_enc" text NOT NULL,
	"events" jsonb NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "weight_disputes" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"shipment_id" text NOT NULL,
	"declared_grams" integer NOT NULL,
	"carrier_grams" integer NOT NULL,
	"revised_chargeable_grams" integer NOT NULL,
	"charge_paise" bigint NOT NULL,
	"evidence" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"deadline_at" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"resolution" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "cod_confirmations" ADD CONSTRAINT "cod_confirmations_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_balances" ADD CONSTRAINT "credit_balances_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kyc_documents" ADD CONSTRAINT "kyc_documents_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_wallet_id_wallets_id_fk" FOREIGN KEY ("wallet_id") REFERENCES "public"."wallets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ndr_cases" ADD CONSTRAINT "ndr_cases_shipment_id_shipments_id_fk" FOREIGN KEY ("shipment_id") REFERENCES "public"."shipments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "one_time_tokens" ADD CONSTRAINT "one_time_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "packages" ADD CONSTRAINT "packages_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recharges" ADD CONSTRAINT "recharges_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_wallet_id_wallets_id_fk" FOREIGN KEY ("wallet_id") REFERENCES "public"."wallets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipment_events" ADD CONSTRAINT "shipment_events_shipment_id_shipments_id_fk" FOREIGN KEY ("shipment_id") REFERENCES "public"."shipments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_messages" ADD CONSTRAINT "ticket_messages_ticket_id_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."tickets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wallets" ADD CONSTRAINT "wallets_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "warehouse_provider_sync" ADD CONSTRAINT "warehouse_provider_sync_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "warehouses" ADD CONSTRAINT "warehouses_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_endpoint_id_webhook_endpoints_id_fk" FOREIGN KEY ("endpoint_id") REFERENCES "public"."webhook_endpoints"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "weight_disputes" ADD CONSTRAINT "weight_disputes_shipment_id_shipments_id_fk" FOREIGN KEY ("shipment_id") REFERENCES "public"."shipments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_org_created" ON "audit_log" USING btree ("org_id","created_at");--> statement-breakpoint
CREATE INDEX "ledger_wallet_created" ON "ledger_entries" USING btree ("wallet_id","created_at");--> statement-breakpoint
CREATE INDEX "markup_provider_org" ON "markup_rules" USING btree ("provider","org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "notif_org_chan_evt" ON "notification_settings" USING btree ("org_id","channel","event");--> statement-breakpoint
CREATE UNIQUE INDEX "orders_org_number" ON "orders" USING btree ("org_id","order_number");--> statement-breakpoint
CREATE UNIQUE INDEX "orders_store_ext" ON "orders" USING btree ("org_id","external_store_id","external_order_id");--> statement-breakpoint
CREATE INDEX "orders_org_created" ON "orders" USING btree ("org_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "shipment_events_dedupe" ON "shipment_events" USING btree ("dedupe_key");--> statement-breakpoint
CREATE UNIQUE INDEX "shipments_awb" ON "shipments" USING btree ("provider","awb");--> statement-breakpoint
CREATE INDEX "shipments_org_status" ON "shipments" USING btree ("org_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_kind" ON "users" USING btree ("kind","email");--> statement-breakpoint
CREATE UNIQUE INDEX "users_mobile_kind" ON "users" USING btree ("kind","mobile");--> statement-breakpoint
CREATE UNIQUE INDEX "wps_wh_acct" ON "warehouse_provider_sync" USING btree ("warehouse_id","provider_account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "wh_deliv_ep_evt" ON "webhook_deliveries" USING btree ("endpoint_id","event_id");