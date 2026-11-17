# Customer Portal menu — handover checklist

Sidebar order is fixed in code (`src/components/portal/nav.ts`) and matches the reference order: 10 main items, 35 sub-items, then **Quick Search (Ctrl+B)** and the **Seller Support** card.
Labels, page help text and support phone / hours are editable in **Admin → Content** (tab “Customer sidebar menu” / “Page text”), with draft → publish and English / Hindi.
Feature access per module: **Admin → Plans & Features** (global / plan / customer). Plan features show a 🔒 lock and open the upgrade page; features Admin switches off are hidden. Access is enforced in pages, APIs, `/api/v1` and background jobs.

✅ = verified end-to-end on local demo data (2026-11-17). 🟡 = built and loads, not fully exercised. ❌ = needs external credentials / partner.

| # | Menu item | Route | Customer can | Admin controls | Verified |
|---|---|---|---|---|---|
| 1 | Dashboard | `/portal/` | Status tiles → filtered orders, wallet, COD remittance summary, credits, quick actions | Content (banners) | ✅ |
| 2 | Orders | `/portal/orders/` | Create / import / filter (status, payment, type, **tag**), weights & dims, book, auto-assign, label, invoice, **cancel** | Feature access (bulk, channels) | ✅ create + tag + auto-assign + book + cancel/refund |
| 3 | NDR | `/portal/ndr/` | Reattempt / update details / RTO, carrier response | Admin → NDR / RTO | 🟡 (built earlier) |
| 4.1 | Passbook | `/portal/billing/passbook/` | Credits, debits, refs, running balance, CSV/Excel | Admin → Wallets | ✅ |
| 4.2 | COD Remittance | `/portal/billing/cod-remittance/` | Collected, scheduled/paid payouts, deductions, UTR, per-shipment state | Admin → COD & Early COD | ✅ batch → paid → UTR shown |
| 4.3 | Shipping Charges | `/portal/billing/shipping-charges/` | Freight / COD fee / surcharges / GST / weight adj. per AWB | Pricing | ✅ |
| 4.4 | All Recharges | `/portal/billing/recharges/` | Amount, payment ref, status, wallet credited | Admin → Wallets | 🟡 (no Razorpay test payment run) |
| 4.5 | Invoices | `/portal/billing/invoices/` | List + printable tax invoice (Save as PDF) | Admin → Invoices & Notes | ✅ |
| 4.6 | Credit Notes | `/portal/billing/credit-notes/` | List + print | Admin → Invoices & Notes; auto on waived weight charge | ✅ |
| 4.7 | Debit Notes | `/portal/billing/debit-notes/` | List + print | Auto on weight charge; manual in Admin | ✅ |
| 4.8 | Ledgers | `/portal/billing/ledgers/` | Opening, entries, closing for any dates; export | — | ✅ |
| 4.9 | Notification Credit History | `/portal/billing/notification-credits/` | Purchases, usage per WhatsApp event, refunds, balance | Admin → Notifications (packs, costs) | ✅ |
| 5.1 | Rate Calculator | `/portal/rates/` | Rates with logos, ETA, chargeable weight | Pricing, courier availability | ✅ |
| 5.2 | Shipment Price List | `/portal/tools/price-list/` | Own rates by courier × zone × slab, COD fee, personalised badge | Admin → Couriers & Rate Cards (zones); customer Pricing tab | ✅ |
| 5.3 | Activity logs | `/portal/tools/activity/` | Account actions with actor, time, reference, filters | Admin → Audit Log | ✅ |
| 5.4 | Manage Courier | `/portal/tools/couriers/` | Hide couriers, set preference order | Admin → Couriers (availability for all) | ✅ hidden courier removed from quotes |
| 5.5 | Report Download | `/portal/tools/downloads/` | Background exports with filters, status, download (7 days) | Feature access (reports) | ✅ |
| 5.6 | Track Order | `/portal/track/` | Order ID / AWB / LR, timeline, ETA | Feature access (tracking) | ✅ (previous phase) |
| 5.7 | Weight Discrepancy | `/portal/tools/weight-discrepancy/` | Entered / volumetric / booked / carrier weights, charge, evidence, **raise dispute** | Admin → Weight Disputes (charge / waive) | ✅ dispute → charge → debit note |
| 6.1 | Shipment Report | `/portal/reports/shipments/` | AWB/LR, courier, warehouse, status, booked/delivered dates, weights, charges | Feature access (reports) | ✅ |
| 6.2 | Orders Reports | `/portal/reports/orders/` | Incl. awaiting shipment; channel, payment, value, fulfilment | 〃 | ✅ |
| 6.3 | NDR Reports | `/portal/reports/ndr/` | Reason, attempts, response, status, final outcome | 〃 | ✅ |
| 6.4 | Custom Report | `/portal/reports/custom/` | Choose columns, filters, dates, preview, export | 〃 | ✅ |
| 7.1 | Branded Tracking Page | `/portal/settings/tracking-page/` | Logo, colours, text, preview, publish / unpublish, link | Admin → Tracking Pages; plan | ✅ (previous phase) + 🔒 lock for no-plan |
| 7.2 | Label Setting | `/portal/settings/label/` | 4×6, 3×4, 4×4, 2×4, 38×100 mm, A4; optional fields; preview | — | ✅ download uses chosen size |
| 7.3 | Invoice settings | `/portal/settings/invoice/` | Business details, logo, GSTIN, footer, colour, live preview | — | ✅ order invoice uses them |
| 7.4 | Auto-Assign Rule | `/portal/settings/auto-assign/` | Rules by type, PIN, warehouse, payment, weight → couriers; reason shown | Feature access (auto_assign) | ✅ rule + skip reason + book |
| 7.5 | Shipping Notification | `/portal/notifications/` | Event toggles, WhatsApp subscription, message log | Admin → WhatsApp Ops, Plans | ✅ (previous phase) |
| 7.6 | COD Confirmation | `/portal/notifications/cod/` | Confirm / Cancel results, cancellation states | Admin → WhatsApp Ops | ✅ 10/10 server checks (previous phase) |
| 7.7 | Early COD Subscription | `/portal/settings/early-cod/` | Eligibility, terms, fee, schedule, subscribe / cancel, qualifying shipments | Admin → COD & Early COD (terms, versioned) | ✅ subscribe → early payout with fee |
| 8 | Warehouse | `/portal/addresses/` | Add / edit / deactivate / default, OTP, export | Admin → Warehouses | ✅ (previous phase) |
| 9.1 | Order Channels | `/portal/integrations/` | Shopify / WooCommerce, sync status, errors, retry | Feature access | 🟡 (no live store connected) |
| 9.2 | OMS | `/portal/integrations/oms/` | Request connector, API + webhook path, sync history | Admin → OMS Requests (status) | 🟡 ❌ native connectors need OMS partner access |
| 9.3 | EDD Widget | `/portal/integrations/edd-widget/` | Configure, preview, test PIN, embed code | Feature access | ✅ public estimate endpoint |
| 9.4 | API Integration | `/portal/integrations/api/` | Keys (create / rotate / revoke), docs, webhook, connection log | Admin → API Credentials | ✅ (previous phase) |
| 10.1 | Customers | `/portal/others/customers/` | Buyers + 2 addresses; pick in Create Order; “save to Customers” | — | ✅ |
| 10.2 | Products | `/portal/others/products/` | SKU, value, weight, size; add to order | — | ✅ |
| 10.3 | Packaging | `/portal/others/packaging/` | Box presets with tare; default box pre-filled | — | ✅ |
| 10.4 | Order Tags | `/portal/others/tags/` | Create / rename / delete; assign on order; filter Orders & reports | — | ✅ |

**Navigation verified:** exact order; parent stays expanded and child highlighted on direct visit / refresh; desktop collapse (icon rail, names as tooltips); mobile slide-out; Quick Search by menu name and own order / AWB / LR (Ctrl+B or button).
**Isolation verified:** customer B gets 404 for A’s products, buyers, rules, exports, documents, orders and tags; search returns nothing of A’s.

## Still needed for live operation
- Courier credentials for live bookings, labels, tracking and **cancellation** (Shipmozo adapter currently quotes only; cancel / label return “unsupported”).
- Razorpay live keys (recharges), WATI account + Meta-approved templates (WhatsApp), OMS partner credentials (Unicommerce / EasyEcom / Vinculum / Browntape).
- Vishwaship GSTIN, legal address and SAC in **Admin → Invoices & Notes** before issuing real invoices.
- `APP_URL` must be the public site URL (EDD widget script, tracking and webhook links).
