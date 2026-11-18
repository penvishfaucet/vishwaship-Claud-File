-- Shipmozo and Shipora X have no sandbox: their accounts always use production keys. Older Shipmozo rows were
-- created in "test" mode, so keys saved under Production were never read and Test authentication failed.
UPDATE "provider_accounts" SET "mode" = 'live' WHERE "adapter" IN ('shipmozo', 'shiporax') AND "mode" <> 'live';
