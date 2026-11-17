# Local demo setup: generate migrations from the schema, apply them to embedded PGlite, seed demo data.
$ErrorActionPreference = "Stop"
$npx = "C:\Program Files\nodejs\npx.cmd"
& $npx drizzle-kit generate --name init
# (re-run safe: generate is a no-op when schema unchanged)
if ($LASTEXITCODE -ne 0) { throw "drizzle-kit generate failed" }
& $npx tsx scripts/migrate.mts
if ($LASTEXITCODE -ne 0) { throw "migrate failed" }
& $npx tsx scripts/seed.mts
if ($LASTEXITCODE -ne 0) { throw "seed failed" }
Write-Output "DEV-SETUP-DONE"

