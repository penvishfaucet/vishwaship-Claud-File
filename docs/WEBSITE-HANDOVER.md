# Website redesign — Home, Rate Calculator, Customer Care, About Us (2026-11-18)

## Routes
| Page | Route |
|---|---|
| Home | `/` |
| Rate Calculator | `/shipping-rate-calculator/` (Home quick form → `?o=&d=&w=`) |
| Customer Care | `/customer-care/` |
| About Us | `/about-us/` (new) |

Header: logo · Home · Rate Calculator · Customer Care · About Us · Login · Sign Up. Footer: Franchise Login, policies, Track/Book links. Mobile: menu button opens a full-height menu (Esc / link closes it).
Account links default to `https://customer.vishwaship.com/login`, `/register` and `https://admin.vishwaship.com`; editable in Admin.

Screenshots: `docs/screenshots/site-*-desktop.png` (1440 px) and `site-*-mobile.png` (390 px, device emulation).

## Admin → Website Content (`/admin/website/`, needs `content.write`)
Tabs: Home · Courier carousel · Customer Care & team · Head office & map · About Us · Navigation, links & footer · Calculator.
- **Save draft → Preview draft ↗ → Publish.** Drafts are visible only to signed-in staff with `?preview=1`; visitors see published content (or the built-in defaults).
- **Media**: PNG/JPG/WebP (≤ 3 MB), MP4/WebM (≤ 20 MB); checked by file content (SVG refused). Stored in the database (`site_assets`) and served from `/api/site-assets/<id>` with long caching, so uploads survive redeploys.
- **Team photos**: upload → square crop (drag + zoom) → 512×512 JPEG.
- **Contacts**: call / WhatsApp buttons appear only for a complete 10-digit mobile; otherwise the card shows “number coming soon”. South (partial `786855`) and Tanmay (pending) are drafts until completed.
- **Head office**: address lines, map search text, optional latitude/longitude (exact pin) and Google Maps share link. Embedded map uses the search text until coordinates are set (no API key needed).
- **Courier carousel**: the 23 original logos are always kept (records merge additively); hide, rename, re-order, add a link or logo, or add new partners. The ID is the courier code used to show logos beside calculator results. Count = unique visible partners.
- **Calculator**: B2C/B2B threshold (default 10 kg) — shared with customer Create Shipment; saved immediately.

## Rate Calculator behaviour (verified locally)
- PIN lookup (India Post, cached): 249402 → Haridwar, Uttarakhand; 400001 → Mumbai, Maharashtra; invalid/unknown PIN shown inline.
- Cartons: count, actual weight per carton, L×W×H; multiple carton sizes; totals and volumetric weight shown.
- Automatic service from total actual weight: **9.99 kg → B2C, 10 kg → B2B, 10.01 kg → B2B** (unit tests + in-browser); threshold change in Admin applies immediately. Visitors may switch manually (“Use automatic” restores).
- Payment: Prepaid / COD (amount required) / FOD (only where activated — backend refuses otherwise).
- Results from `/api/public/quote`, i.e. the enabled integrations (Shipmozo, Delhivery Direct B2B/B2C, …) with the configured pricing (25 % Delhivery B2B default markup, other rules). Each shows logo, courier, service, B2B/B2C, final price incl. GST, chargeable weight, transit estimate, payment mode, expandable breakdown, **Continue to Book**.
- Any change to an input clears the rates (“Get updated rates”). Loading, invalid PIN, no-service and provider-error states shown.
- **Continue to Book** → this site’s login (`/login/?next=…`) → Create Shipment with destination, cartons, payment and COD prefilled (verified: both carton sizes arrived). Create Shipment re-quotes, so an expired quote is refreshed before booking. Inputs are also kept in the browser.
- Public prices use the global pricing; customer-specific rates apply after login in Create Shipment.

## Accessibility & performance
- Carousel: continuous scroll, pauses on hover / keyboard focus / touch, Pause button; reduced-motion → static, horizontally scrollable row (verified with emulated `prefers-reduced-motion`). Duplicate loop copy hidden from screen readers. No page overflow at 360/390/768/1024/1440 px (measured scrollWidth = viewport on all four pages).
- Hero: muted inline looping video with Pause/Play when a video is uploaded; poster image otherwise, and for reduced-motion or data-saver visitors.
- Truck animation in “How it works”; stops for reduced motion.

## Still needed from you
1. **Hero video** — none was supplied; the hero uses the existing photo as poster. Upload a short (10–20 s) compressed MP4 in Admin → Website Content → Home.
2. **South** manager’s full mobile number and **Tanmay Panchal’s** number.
3. **Team photos** and an About Us image if you want new ones (current: brand photo).
4. **Office pin**: latitude/longitude or Google Maps link once the exact location is pinned.
5. **Partner links**: the original carousel had no links; add them per partner if wanted.
6. Note: Login/Sign Up go to `customer.vishwaship.com` as requested, while **Continue to Book** uses this site’s own login so the calculator details can be carried into Create Shipment.
