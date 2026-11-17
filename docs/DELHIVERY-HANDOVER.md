# Handover — Dashboard, Sidebar, Create Shipment and Delhivery Direct (2026-11-17)

Screenshots: `docs/screenshots/` (desktop dashboard with the sidebar collapsed and hover-expanded, mobile dashboard and drawer, Pickup dialogs, Deliver-to validation and saved-customer picker, Admin Delhivery page).

## 1. Dashboard (Customer Portal → Dashboard)
Header (left → right): hamburger · search (AWB ID default, Order ID, LR/LRN) · Notification Credits → Billing › Notification Credit History · Refresh (keeps tab + dates) · Wallet balance → Billing › Passbook · Recharge → recharge panel · Quick Actions (Create Shipment, Rate Calculator, Track Order, Add Warehouse, Raise Ticket) · Tickets (open count; recent tickets with ID, subject, status, last update; Raise Ticket, View All) · Bell (unread count, linked notifications) · Avatar (Profile, Account settings, KYC, Sign out). On phones: search icon (opens Quick Search), wallet, quick-actions icon, tickets, bell, profile.

Tabs **Analytics / Order Status** + date range (presets 7/30/90 days or custom; carried into every destination).

| Card / chart | Opens (same filter + dates) | Verified count = list |
|---|---|---|
| New Orders | `/portal/orders/?bucket=new` | ✅ |
| Courier Assigned | `?bucket=assigned` | ✅ (0 = 0) |
| Scheduled | `?bucket=scheduled` | ✅ |
| All Orders | `?bucket=all` | ✅ |
| Customer Returns | `?bucket=returns` | ✅ (0 = 0) |
| RTO | `?bucket=rto` | ✅ |
| Donut: Delivered / RTO In-Transit / RTO Delivered / NDR | `?bucket=delivered` … (segments and legend are links) | ✅ all four |
Wallet Transactions → Passbook (same dates); Recent Orders rows → order details, with Track and Label buttons; View All Orders → `?bucket=all`. Order Status tab: pipeline New → Assigned → Scheduled → In Transit → Out for Delivery → Delivered, NDR, RTO; each stage filters the list. Counts and lists share one server-side definition (`src/server/portal/buckets.ts`).

## 2. Sidebar
Desktop: 64 px icon rail; expands over the content on hover or keyboard focus (page doesn’t move — measured content offset stays 64 px); “Keep open” pins it (hamburger also pins); collapses when the pointer leaves. Mobile: drawer with close button. Verified rendered colours: labels/icons **#FFFFFF**, chevrons **#C9D2E6** on navy **#0B1F3A**; selected item **orange #F0712C with navy text and icon**; hover = white on 12 % white; keyboard focus = 2 px white outline + 4 px orange ring; parent of the selected submenu = bold white with orange bar. Order, names and routes unchanged.

## 3. Create Shipment → Pickup
“+ Add New Warehouse” and “Change Warehouse” under Pickup Address, above the OTP notice (stack full-width on phones).
✅ Add: saved via existing Warehouse API, selected for this shipment, OTP sent and verified in the dialog, draft (buyer, address, pickup date) kept.
✅ Change: list shows name, city, PIN, masked mobile, verification, Selected/Default; switching affects this shipment only (default unchanged, checked on Warehouses page); rates are cleared and re-fetched; past pickup dates are moved forward.
✅ Unverified warehouse → “Verify with OTP” inline; Next is blocked until verified.

## 4. Create Shipment → Deliver to
✅ “Address line 1 *”: empty or spaces → “Please enter Address line 1” under the field, Next blocked; API also rejects it (HTTP 422).
✅ PIN autofill: India Post directory via `/api/portal/pincode/<pin>` (cached; only the PIN is sent); a changed PIN clears and refills City/State (560001 Bengaluru → 110001 New Delhi); late answers ignored; unknown PIN → inline error; service failure → Retry.
✅ Mobile lookup: exact match in the account’s Customers, +91 / 0 / dashes normalised; 1 address → auto-filled; 2+ addresses → picker; no match → manual. “Save to Customers” stores the buyer, found again next time (saved as “+91 99000 11122”, found by “09900011122”). Existing customers are updated only when the box is ticked.

## 5. Delhivery Direct B2B and B2C
Admin → Settings → **Delhivery Direct** (`/admin/carriers/delhivery/?svc=b2b|b2c`): credentials (encrypted, masked), environment (test/production), Test connection, Enable/Disable (only after a passed test), Remove credentials, payment modes, FOD activation + collection basis, **B2B Freight Markup (%)** (default 25 %), B2C markup (independent), rate source (Delhivery API or contract rate card), B2B billing address, recent shipments with carrier cost / sender charge / receiver amount and FOD collection status, registered pickup warehouses, setup checklist. Endpoints used: `docs/DELHIVERY-API-NOTES.md`.

Built: serviceability, rates (B2B Freight Estimator / B2C Shipping Cost API or contract card), TAT, warehouse registration on first booking, booking (B2B async job → LR via reconcile job; B2C synchronous waybill with duplicate-safe order id), labels (B2B Base64 images, B2C PDF), pickup requests (one per shipment+date), tracking (30-min polling; webhook needs Delhivery set-up), cancellation, FOD reconciliation status.

Pricing (unit-tested): Vishwaship B2B freight = base freight × (1 + markup). ₹1,000 → **₹1,250** at 25 % → **₹1,300** at 30 % (verified in Admin); fuel/docket/ROV/ODA/COD/FOD charges pass through; GST once. B2C stays independent (₹1,250 example unchanged). Booked shipments keep their quote.

Also fixed: outbound HTTPS from the server was failing on this Node version (“invalid onError method”) for **all** integrations (WATI, stores, webhooks, Razorpay, Delhivery). Now uses undici’s own fetch; verified against India Post (200) and Delhivery (401/400 on dummy credentials = real responses).

### Payment-mode status
| Service | Prepaid | COD | FOD |
|---|---|---|---|
| Delhivery B2B | Built · needs credentials to test live | Built · needs credentials | Built and verified locally (`npm run verify:fod`, 7/7); **Pending Delhivery Activation**: `freight_mode: "fod"` is documented, but who collects, whether the markup can be collected, and settlement are not — confirm in writing, then set “Activated” |
| Delhivery B2C | Built · needs API token | Built · needs API token | **Not supported** — B2C API documents only Prepaid, COD, Pickup, REPL; Admin refuses enabling it |

FOD money flow verified locally (demo courier standing in): not quotable while pending; once active, receiver ₹89.56 + sender ₹22.40 = total ₹111.96; wallet charged only ₹22.40; shipment stores receiver freight and “pending collection”; backend refuses FOD after Admin disables it.

**Verified in test vs production:** nothing has run against Delhivery test or production with real credentials yet; connectivity confirmed (Delhivery rejected dummy credentials). All flows above were verified locally.

### What you need from Delhivery
- **B2B:** API username + password (test and production); confirm Freight Estimator, Manifest, Pickup Request, Label, Track and Cancel APIs are enabled; whether you are a retail (B2BR) client (then billing address, `freight_mode`, `fm_pickup`, `rov_insurance` and invoice copies are mandatory); FOD activation and the written collection/settlement terms; optional status webhook (lastmile-integration@delhivery.com).
- **B2C:** API token for staging and production (Delhivery ONE → Settings → API setup); confirm Surface/Express and COD on your contract.
- Then: Admin → Delhivery Direct → enter credentials → Test connection → (B2B) billing address → Enable.

## Tests
`npx tsc --noEmit` clean · `npm test` 47/47 · `npm run verify:whatsapp` 10/10 · `npm run verify:fod` 7/7.
