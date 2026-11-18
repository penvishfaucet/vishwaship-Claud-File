-- Courier accounts that were already live (enabled, connection test passed) before capability verification
-- existed keep quoting: they are treated like the owner's "Activate now" (owner decision 2026-11-18).
-- The remaining capabilities verify from real bookings. Shipmozo is excluded: its adapter did not exist before.
UPDATE "provider_accounts"
SET "config_public" = "config_public" || '{"activatedEarly":{"at":"2026-11-18","by":"migration"}}'::jsonb,
    "capabilities" = "capabilities" || jsonb_build_object('authenticate', jsonb_build_object(
      'state', CASE WHEN "mode" = 'live' THEN 'live_verified' ELSE 'sandbox_verified' END,
      'mode', "mode", 'message', 'Connection test passed before verification tracking existed', 'evidence', 'last connection test'))
WHERE "category" = 'shipping' AND "status" = 'enabled' AND "adapter" NOT IN ('demo', 'shipmozo') AND "last_test_ok" = true;
