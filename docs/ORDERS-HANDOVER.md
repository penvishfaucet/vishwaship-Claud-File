# Customer Portal → Orders (Shipmozo-style layout) — handover (2026-11-18)

Sidebar **Orders** opens `/portal/orders/`. Navy / orange / white theme, existing header (search, credits, wallet, Recharge, Quick Actions, Tickets, alerts, profile) unchanged.

## Layout
- **Forward / Reverse** tabs (`?direction=reverse`), **Domestic / International** (International shows “not enabled for your account” — text editable in Portal Text), **Sync Orders** (pulls every connected Shopify/WooCommerce store), **Bulk Import**, **Add Order** (+ menu: return, quick add, bulk, connect store).
- Status navigation in the screenshot order, each with its count:
  Shipment Booking: New → Courier Assigned → Pickups & Manifests · Shipment Journey: In Transit → Out For Delivery → Delivered · NDR Exceptions: NDR → RTO In-Transit → RTO Delivered · All → Archive.
- Filter bar: date type (Order Created / Shipment Booked / Delivered), date range, search by reference ID, search by AWB/LR, **More Filters** (courier, B2C / MPS / B2B, payment, warehouse, shipment status, WhatsApp COD status, tag), Export (CSV, same filters + tab), Refresh, Table settings (show/hide optional columns, saved per user).
- Table columns: Order Date · Order Details · Product Details · Package Details · Payment · Tracking Info · Shipping Details · Pickup Address · Action, with the **WhatsApp COD order confirmation** line under every row. Pagination with “Data per page” (10/25/50/100, remembered).
- Mobile (≤ 900 px): one card per shipment — AWB + Copy, courier + status, recipient, COD value, shipping charged, WhatsApp COD status, Track + Download Label first; products, package & weights, addresses, tracking and more actions in expandable sections. No horizontal page scroll at 390 px.

## Status mapping (one rule for tabs, counts, filters, export)
`src/lib/order-view.ts` (`tabOf`) and its SQL twin `tabSql()` in `src/server/orders/view.ts` — a DB test checks they agree.

| Tab | Rule |
|---|---|
| New | no shipment yet, or the last booking failed (draft, ready, COD hold, booking failed) |
| Courier Assigned | booked, pickup not scheduled |
| Pickups & Manifests | booked with pickup scheduled, or pickup pending |
| In Transit | picked up, in transit, at delivery centre (reverse in transit) |
| Out For Delivery / Delivered / NDR | out_for_delivery / delivered / ndr |
| RTO In-Transit / RTO Delivered | rto_initiated + rto_in_transit / rto_delivered |
| All | everything not archived (incl. cancelled, lost) |
| Archive | orders moved to Archive (hide only; nothing deleted) |

Dashboard tiles (`?bucket=`) and old `?group=` links open the matching tab.

## Row details
- **Payment**: invoice value, COD amount, Prepaid / COD / FOD badge, receiver-paid freight for FOD, and the **actual booked charge** (+ any weight-dispute adjustment). Clicking it opens the breakdown (freight, fuel, fees, GST, booked amount, adjustments, total).
- **Tracking Info**: courier + service, AWB (from the provider response only) with Copy and Track, **AWB Pending** while booking is processing, LR separately for B2B, status, latest scan location + time, sync state (“Synced 5 min ago” / “Sync failed · Retry”).
- **Actions**: Track (timeline dialog: events, locations, ETA / delivered time, confirmed address changes, Retry sync) and a menu: Download Label (per size; unavailable sizes show why), Invoice, View Order Details, View WhatsApp COD Confirmation, Move to Archive / Restore, Cancel Shipment / Order when eligible. Menus are fixed-position so they are never clipped.
- Bulk: select rows → Download labels (one PDF) / Archive / Restore.

## Labels (`/api/portal/labels?ids=…&format=…`, PDF)
Sizes: 3×4 in, 4×4 in, 2×4 in, 38×100 mm, Original carrier format.
- Live carriers: the carrier’s own label, requested in its native size or placed on the chosen page and scaled — never below 60 % (barcode readability). Delhivery B2C (4×6 PDF): 3×4 / 4×4 / original; 2×4 and 38×100 are refused with a reason. Delhivery B2B: native 3×4 / 4×4 / 2×4, 38×100 scaled from 2×4.
- Demo courier: Vishwaship-drawn label marked DEMO; one page per box (“BOX 2 OF 3”, piece ID); 38×100 is laid out landscape and rotated so the AWB barcode runs along the 100 mm side.
- Other accounts’, cancelled and AWB-pending shipments are skipped and listed.

## Tracking sync
- `ingestEvents` keeps every event (deduped), and only moves status / latest location / time to an event at least as new as the stored one — duplicate and out-of-order updates are safe. Delivered time is stored. Scan location and delivery address are separate; the address changes only on a carrier-confirmed amendment, recorded in `destination_amendments` and shown in the Track dialog.
- Push: `POST /api/webhooks/tracking/<providerAccountId>?token=<webhookToken>` (token saved on the provider account, constant-time check, identical bodies processed once). Only adapters with a documented push format accept it — today only the demo courier; others are polled every 30 min (`tracking.poll`).
- Sync health on each shipment (last success, last error, consecutive failures) → row indicator, Retry in the Track dialog, and **Admin → Order Exceptions**.

## WhatsApp COD confirmation
Row statuses: Setup Required (links to Settings → COD Confirmation), Disabled, Not Applicable, Pending, Sent, Delivered, Confirmed, Rejected, No Response, Message Failed, plus the cancellation status shown separately (Cancellation Pending, Cancelled, Cancellation Failed / Action Required). Click → message history, buyer’s button + time, cancellation detail, wallet refund.
- COD orders are held before booking until the buyer confirms (existing flow). **Pickup requests are now refused** while a confirmation is pending/unanswered (held for review) or after a rejection.
- Buyer “Cancel Order”: not booked → order cancelled at once; booked and before pickup → the provider that created it is asked to cancel (latest carrier status is fetched first for live couriers); on confirmation the shipment is cancelled and the shipping charge refunded once; already picked up or courier refuses → Action Required alert to the customer and listed in Admin → Order Exceptions.

## Admin
- **Admin → Order Exceptions** (`/admin/order-exceptions/`): default label size for Orders, tracking sync failures with Retry, COD cancellation exceptions.
- Tab names, group names, the COD line and the International message: **Admin → Portal Text** (keys “Orders – …”).
- WhatsApp COD rules: Admin → Notifications; plan access: Plans & Features (unchanged).

## Verified (local, demo courier, separate copy of the demo database)
- Tabs and counts move as updates arrive: webhook push of pickup → transit scans → OFD → delivered, NDR, RTO initiated/in transit, RTO delivered reached the right orders (19 matched, unknown AWB ignored, duplicate body ignored, late older scan did not roll OFD back, address amendment recorded).
- AWB / LR on rows equal the booking response (demo LR for B2B, AWB for B2C/MPS).
- Charge breakdown sums to the booked amount (e.g. ₹726.25 + ₹72.63 + ₹35 + GST ₹150.10 = ₹983.98).
- Labels: every size for single box; MPS 3 boxes → 3 pages; B2B 2 boxes → 2 pages; bulk 6 pages with the foreign ID skipped.
- WhatsApp COD: buyer Confirm released the held order, which then booked; buyer Cancel on an unbooked order cancelled it; DB tests cover Cancel before pickup (courier cancel + single refund, retry no-op), after pickup (Action Required) and duplicate replies.
- Export CSV = tab + filters (NDR tab → 2 rows = tab count). Another account’s shipment → 404. No horizontal overflow at 390 px; table fits at 1440 px.
- Tests: `src/server/orders/orders-view.test.ts` (21, real Postgres semantics via PGlite) — whole suite green.

Screenshots: `docs/screenshots/orders-desktop*.jpg`, `orders-mobile-*.jpg`.

## Still needed (provider / account)
1. **Shipmozo**: the official API documentation could not be found publicly (shipping-api.com shows only a placeholder; `Shipmozo.pdf` in Downloads is a rate card). The Shipmozo adapter therefore stays “unsupported” — no Shipmozo quote, booking, AWB, label, tracking or cancellation is faked. Please send the Shipmozo API document (endpoints for push order, assign courier, label, track, cancel, webhooks) and API keys (entered by you in Admin → Integrations).
2. **Tracking push**: Delhivery / Shipmozo webhook formats are not documented to us, so those shipments are polled every 30 min. When a provider confirms a push format, add `parseTrackingWebhook` to its adapter and give them the URL above.
3. **WhatsApp**: a WATI account with the approved `cod_confirm` template is needed for real messages (demo mode records but does not deliver).
4. **International**: no international carrier is integrated, so the selector stays disabled.
