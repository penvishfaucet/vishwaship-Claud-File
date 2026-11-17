# Copies owner-supplied brand assets and the old site export into the repo.
# reference/ is git-ignored source material; public/brand/ ships with the app.
$ErrorActionPreference = "Stop"
$dl = Join-Path $env:USERPROFILE "Downloads"
New-Item -ItemType Directory -Force "reference/site-export", "public/brand/carriers" | Out-Null
tar -xf (Join-Path $dl "horizons-export-b08546a2-b494-4b70-9362-857680ba26f0.zip") -C "reference/site-export"
tar -xf (Join-Path $dl "Vishwaship-Courier-Logos.zip") -C "public/brand/carriers"
Copy-Item (Join-Path $dl "Vishwaship.com Logo with Transparent Background.png") "public/brand/logo.png" -Force
Copy-Item (Join-Path $dl "Smiling delivery worker with parcels.png") "reference/hero-candidate.png" -Force
Write-Output "EXTRACT-DONE"
