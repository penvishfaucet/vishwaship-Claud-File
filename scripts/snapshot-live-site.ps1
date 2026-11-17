# Read-only snapshot of the public vishwaship.com pages and approved brand assets for visual parity.
# HTML/CSS land in reference/live (git-ignored); images the app ships land in public/.
$ErrorActionPreference = "Continue"
$base = "https://vishwaship.com"
New-Item -ItemType Directory -Force "reference/live", "public/brand", "public/couriers" | Out-Null
$pages = @{ "home" = "/"; "rate-calculator" = "/shipping-rate-calculator/"; "track" = "/track/"; "login" = "/login/"; "signup" = "/signup/"; "book" = "/book/"; "customer-care" = "/customer-care/"; "privacy" = "/privacy/"; "refund-policy" = "/refund-policy/"; "terms" = "/terms/"; "admin-login" = "/login/?admin=1" }
foreach ($k in $pages.Keys) { curl.exe -sS -L -o "reference/live/$k.html" ($base + $pages[$k]) }
curl.exe -sS -L -o "reference/live/site.css" "$base/_next/static/css/90500565134f0ba2.css"
curl.exe -sS -L -o "public/brand/logo-full.png" "$base/logo-full.png"
curl.exe -sS -L -o "public/brand/hero.jpg" "$base/hero.jpg"
$couriers = "dtdc","blue-dart","delhivery","xpressbees","ekart","amazon-shipping","ecom-express","shadowfax","fedex-express","dhl","india-post","aramex","ups","allcargo-gati","tci-express","tci","trackon","the-professional-couriers","shree-maruti","dp-world","porter","borzo","allcargo-logistics"
foreach ($c in $couriers) { curl.exe -sS -L -o "public/couriers/$c.webp" "$base/couriers/$c.webp" }
foreach ($f in "favicon.ico","icon.png","apple-icon.png","logo-icon.png") { curl.exe -sS -f -L -o "public/brand/$f" "$base/$f" }
Get-ChildItem reference/live, public/brand, public/couriers | Select-Object Name, Length | Format-Table -AutoSize
Write-Output "SNAPSHOT-DONE"
