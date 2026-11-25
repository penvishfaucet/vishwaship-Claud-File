-- Launch offer (owner 2026-11-26): every client gets the first month free, Online Store included. Stores whose trial
-- ends before 26 Dec 2026 (IST) — or has already ended — are extended to then. Paid periods are untouched.
UPDATE "stores" SET "trial_ends_at" = '2026-12-26 00:00:00+05:30', "updated_at" = now()
WHERE "trial_ends_at" IS NOT NULL AND "trial_ends_at" < '2026-12-26 00:00:00+05:30';
