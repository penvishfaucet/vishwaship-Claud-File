-- Sign-up details (owner 2026-11-28): every new account gives mobile, name, business name and parcels per day,
-- so the team can call back. Google / mobile-OTP sign-ups fill the same on /welcome/ before using the portal.
ALTER TABLE "orgs" ADD COLUMN IF NOT EXISTS "daily_parcels" text;
