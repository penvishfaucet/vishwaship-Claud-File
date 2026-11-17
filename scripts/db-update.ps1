# Generate a migration for schema changes and apply it, then typecheck + test. Stop the dev server first (PGlite lock).
param([string]$Name = "update")
$npx = "C:\Program Files\nodejs\npx.cmd"
& $npx drizzle-kit generate --name $Name
& $npx tsx scripts/migrate.mts
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/verify.ps1
Write-Output "DB-UPDATE-DONE"
