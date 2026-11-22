ALTER TABLE "weight_disputes" ADD COLUMN "source" text DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE "weight_disputes" ADD COLUMN "booked_chargeable_grams" integer;--> statement-breakpoint
ALTER TABLE "weight_disputes" ADD COLUMN "courier_extra_paise" bigint;--> statement-breakpoint
ALTER TABLE "weight_disputes" ADD COLUMN "calc" jsonb;--> statement-breakpoint
ALTER TABLE "weight_disputes" ADD COLUMN "charged_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "weight_disputes_shipment" ON "weight_disputes" USING btree ("shipment_id");--> statement-breakpoint
CREATE INDEX "weight_disputes_status_deadline" ON "weight_disputes" USING btree ("status","deadline_at");