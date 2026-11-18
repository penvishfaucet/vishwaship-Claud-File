# Account-aware navigation, Home hero, offers, tracking (2026-11-18)

## Route mapping
| Button | Destination |
|---|---|
| Login / Customer Login | https://vishwaship.in/login/ |
| Sign Up / Create Account | https://vishwaship.in/signup/ |
| Admin / Franchise Login | https://vishwaship.in/admin/login/ |
| Dashboard (signed-in customer) | /portal/ (Customer Dashboard) |
| Dashboard (signed-in staff only) | /admin/ (Admin Dashboard, role checks unchanged on the server) |
| Dashboard (signed out) | /login/?next=/portal/ → after login the Customer Dashboard |
| Track Shipment | /track/ (AWB, or LR/LRN for B2B) |

The three account URLs are stored in Admin → Website Content → Navigation, links & footer (old `customer.vishwaship.com` / `admin.vishwaship.com` values are replaced automatically). They are rendered as same-site paths (`/login/` etc.), which on vishwaship.in is the identical URL and keeps the `?next=` return path and session cookie working.

## Account states
- **New / unknown visitor**: hero → Calculate Rates + Create Account; header → Login + Create Account (orange).
- **Returning, signed out** (this browser has signed in before — a `vs-known` flag set by the Customer Portal, this browser only, no cross-device tracking): Login becomes the orange action; Create Account stays as a link.
- **Signed-in customer**: header account menu (Dashboard, Create Shipment, Profile, Logout); hero → Go to Dashboard; Continue to Book goes straight to Create Shipment.
- **Signed-in staff**: account menu → Admin Dashboard, Logout (staff).
- `/login/` while already signed in continues straight to `next` (or the dashboard). Login ⇄ Sign up keep `next`, and sign-up returns to it.

## Header & mobile
Desktop (≥ 1200 px): Home · Rate Calculator · Track Shipment · Customer Care · About Us · Dashboard · account. Below 1200 px: logo, Dashboard icon, Account icon, hamburger. The drawer has an icon per item, current page highlighted, Login / Create Account / Franchise-Admin Login, Close button, Esc and outside-tap close, focus moves into the drawer and back, scrolls on small phones. Menus sit above the page (header no longer uses backdrop-filter, which clipped fixed overlays).

## Offers
"COD Available", "Parcel Shipping Starting from ₹28", "Cargo Shipping Starting from ₹8/kg" with the note "Final charges depend on route, weight, dimensions, service, and applicable taxes." — on Home (hero), Rate Calculator and Customer Dashboard (below the header). Text, prices, note and where they show: Admin → Website Content → Offers & features. Quote cards still show the live rate.

## Rate Calculator → booking
Same `/api/public/quote` (global pricing) as before; Admin can switch the calculator or public tracking off (Offers & features). Continue to Book carries destination, cartons, payment, COD and the chosen service/price into Create Shipment; signed-out visitors go through Login/Sign up and land back in Create Shipment. Create Shipment re-quotes with the account's own pricing and shows "Same price" or "Price updated: was ₹X, now ₹Y" (or "service not available now") before booking.

## Tracking
`/track/` reads the same shipment record as the portals (kept current by carrier sync). Shows carrier & service, AWB, LR/LRN, status, latest scan location/time, estimated delivery or delivered time and the scan timeline. States: invalid number, not found, AWB pending, temporarily unavailable, stale updates (no scan for 3 days), rate-limited. Buyer-facing data only.

## Verified (local)
- All Login/Create Account/Admin links on Home resolve to /login/, /signup/, /admin/login/ (14 links checked).
- New → returning → signed-in → logged-out states in header and hero; account menu; drawer focus/Escape.
- Calculator → Continue to Book (signed out) → /login/?next=… → after login Create Shipment with PIN, carton and weight prefilled.
- Track: invalid, not found, and a demo AWB with timeline.
- No horizontal overflow at 360, 390, 768, 1024, 1440 px on Home, Rate Calculator, Track, Customer Care, About Us.
- Unit tests for the confirmed links; production build passes.

Screenshots: `docs/screenshots/site-{home,rate-calculator,track}-{desktop,mobile}.png`.

## Outstanding
- Courier integrations must be enabled in Admin for live rates and live tracking scans (Shipmozo API documentation/keys still needed; Delhivery credentials).
- Hero video: none uploaded yet (image shown).

## Home page v3 (reference design)
- Full-width hero photo with a soft white wash behind the text (left on laptop/desktop, top on phones/tablets); navy "Big & Small," / orange "We Ship It All."; "Simple shipping for parcels and cargo."; Calculate Rates + Create Account (account-aware); offer line "COD Available • Parcels from ₹28 • Cargo from ₹8/kg".
- Floating panel at the hero's bottom edge: **Calculate Rates** (Pickup PIN, Delivery PIN, Weight → full Rate Calculator with these values; carton size and payment are added there) and **Track Shipment** (AWB/LR → /track/). Values are kept while browsing (session storage).
- Courier partners directly below: one row, auto-scrolls and can be swiped/scrolled by hand, arrows on desktop, ~3 logos visible on phones, pause on hover/focus/touch, Pause button, no auto-motion for reduced-motion users. Same component on the Rate Calculator.
- **Background assets:** `public/brand/hero-desktop.webp` (1920×800) and `public/brand/hero-mobile.webp` (780×1100, used up to 1023 px). Cut from the truck-and-warehouse part of the supplied reference design (no image generator was available); a higher-resolution original photo would be sharper on large/retina screens — upload it in Admin → Website Content → Home (desktop and phone fields).
- Admin → Website Content → Home: headline, text, button texts, offer line, desktop/phone background, optional video.
- Checked: no horizontal overflow at 360, 390, 768, 1024, 1440 px; Get Rates carries PINs and weight into the calculator; Track opens the shipment result; carousel stays in one row.
