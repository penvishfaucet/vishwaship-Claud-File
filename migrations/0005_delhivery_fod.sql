ALTER TABLE "shipments" ADD COLUMN "freight_payer" text DEFAULT 'sender' NOT NULL;--> statement-breakpoint
ALTER TABLE "shipments" ADD COLUMN "receiver_freight_paise" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "shipments" ADD COLUMN "fod_status" text;--> statement-breakpoint
ALTER TABLE "shipments" ADD COLUMN "pickup_ref" text;--> statement-breakpoint
ALTER TABLE "shipments" ADD COLUMN "pickup_date" timestamp with time zone;