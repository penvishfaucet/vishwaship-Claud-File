-- Orders the courier accepted (a confirmed, not-cancelled shipment exists) but a wrong reconcile marked failed
-- (bug found 2026-11-19 on VSMWN3MT67). Status only; no wallet entries are touched here.
UPDATE "orders" o SET "status" = 'booked'
WHERE o."status" IN ('booking_failed', 'needs_reconcile')
  AND EXISTS (SELECT 1 FROM "shipments" s WHERE s."order_id" = o."id" AND s."booking_status" = 'confirmed' AND s."status" <> 'cancelled');
