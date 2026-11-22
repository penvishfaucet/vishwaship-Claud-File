-- FoD weight discrepancies were first raised as "accepted" (for information only), which hid the client's dispute
-- button. Reopen those still inside their dispute window; nothing is ever charged to a wallet for FoD.
UPDATE "weight_disputes" SET "status" = 'open', "resolution" = NULL
WHERE "status" = 'accepted' AND "charge_paise" = 0 AND ("calc" ->> 'fod') = 'true' AND "deadline_at" > now();
