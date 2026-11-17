# Screenshot → Vishwaship feature checklist

Functional reference: 10 Shipmozo customer-panel screenshots (dashboard, orders, sidebar menus, warehouse list).
Built with Vishwaship's own design system; no Shipmozo branding, copy or data is reused.
Screenshots contain real buyer names/phones/addresses — none of that data is copied into fixtures.

Status key: ✅ done & verified · 🟡 done, not yet verified end-to-end · 🔨 this phase · ⏭ next phase · ❌ blocked (needs owner input)

Assumptions recorded where the screenshot does not show behaviour.

| # | Screenshot | Feature / action | Vishwaship route | Customer can | Admin controls | Status |
|---|---|---|---|---|---|---|
| 1 | Dashboard | Analytics / Order Status toggle | `/portal/` | view | content copy (CMS) | ⏭ |
| 1 | Dashboard | Date-range filter | `/portal/` | filter | — | ⏭ |
| 1 | Dashboard | Tiles: New Orders, Courier Assigned, Scheduled, All Orders, Customer Returns, RTO | `/portal/` (status tiles exist) | click → filtered orders | — | 🟡 (tiles exist with our status groups) |
| 1 | Dashboard | Wallet Transactions + View All | `/portal/` → `/portal/billing/` | view | — | ✅ |
| 1 | Dashboard | Shipment status donut | `/portal/` | view | — | ⏭ |
| 1 | Dashboard | Recent Orders | `/portal/` | view | — | ✅ |
| 1 | Top bar | AWB/Order search with type selector | top bar | search | — | 🟡 (single search box covers order/AWB/LR/phone) |
| 1 | Top bar | Notification credits, wallet + Recharge, Tickets, bell, avatar | top bar | view/act | — | ✅ |
| 1 | Top bar | Quick Actions dropdown | top bar | act | — | ⏭ (Quick actions live on dashboard) |
| 2 | Orders | Forward / Reverse tabs | `/portal/orders/` | filter | — | ⏭ |
| 2 | Orders | Domestic / International | `/portal/orders/` | — | feature flag | ⏭ (International hidden unless enabled — spec) |
| 2 | Orders | Sync Orders, Bulk Import, Add Order | `/portal/integrations/`, `/portal/orders/bulk/`, `/portal/orders/new/` | act | feature access | ✅ |
| 2 | Orders | Status buckets (New, Courier Assigned, Pickups & Manifests, In Transit, OFD, Delivered, NDR, RTO In-Transit, RTO Delivered, All, Archive) | `/portal/orders/` | filter | — | 🟡 (status tabs exist; bucket names differ) |
| 2 | Orders | Filters: date, reference id, payment, channel, more | `/portal/orders/` | filter | — | 🟡 (search/payment/type) |
| 2 | Orders | Columns incl. package/volumetric, pickup address, Assign Courier | `/portal/orders/`, order page "Choose courier" | book | — | 🟡 |
| 2 | Orders | Download, refresh, page size | `/portal/orders/` | export | report access | ✅ export |
| 3 | Sidebar | Grouped nav: Dashboard, Orders, NDR, Billing▾, Tools▾, Reports▾, Settings▾, Warehouse, Integrations▾, Others▾, support phone | portal sidebar | navigate | module visibility per plan | ✅ Billing▾ / Tools▾ / Settings▾ groups, module-gated, support phone · Others▾ waits for those pages ⏭ |
| 4 | Billing | Passbook, COD Remittance, Shipping Charges, Invoices | `/portal/billing/?tab=` | view/export | — | ✅ |
| 4 | Billing | All Recharges, Credit Notes, Debit Notes, Ledgers, Notification Credit History | `/portal/billing/?tab=` | view | — | 🟡 / ⏭ |
| 5 | Tools | Rate Calculator, Track Order, Weight Discrepancy, Report Download | `/portal/rates/`, `/portal/track/`, `/portal/billing/?tab=disputes`, `/portal/reports/` | use | — | ✅ |
| 5 | Tools | Shipment Price List, Activity logs, Manage Courier | — | — | — | ⏭ |
| 6 | Reports | Shipment, Orders, NDR, Custom report with filters, counts, downloads | `/portal/reports/[type]/` | filter/export own data | report access per plan | ✅ (Shipment, Orders, NDR, Delivery, RTO, COD, Weight, Custom; CSV + Excel = on-screen filters) |
| 7 | Settings | Branded Tracking Page (draft/preview/publish, public link) | `/portal/settings/tracking-page/`, public `/t/[slug]/[ref]` | edit/publish | defaults, access, preview, unpublish | ✅ (draft → publish, public link, buyer search, admin disable verified) |
| 7 | Settings | Shipping Notification, COD Confirmation | `/portal/notifications/`, `/portal/notifications/cod/` | enable events in plan | plans, templates, provider, ops | ✅ demo mode verified · ❌ live sending needs WATI account + approved templates |
| 7 | Settings | Label Setting, Invoice settings, Auto-Assign Rule, Early COD Subscription | — | — | — | ⏭ |
| 8 | Warehouse | List: ID, title, contact, pincode, address, created by/at, status, edit | `/portal/addresses/` | add/edit/deactivate/default | view/manage all customers' warehouses | 🟡 (pages + export verified; edit/deactivate verified in earlier pass) |
| 8 | Warehouse | Search by title / ID, filters, download, Bulk Upload | `/portal/addresses/` | search/export | — | ✅ search + export · ⏭ bulk upload |
| 9 | Integrations | Order Channels (Shopify/Woo), API Integration | `/portal/integrations/` | connect | API credentials | ✅ |
| 9 | Integrations | OMS, EDD Widget | — | — | — | ⏭ |
| 10 | Others | Customers (buyers), Products, Packaging, Order Tags | — | — | — | ⏭ |

## Cross-cutting (prompt sections 4–6)
| Feature | Route | Status |
|---|---|---|
| Feature access: global / plan / customer, enforced on backend | Admin → Subscriptions & Plans, Admin → Customers → Features | ✅ (page redirect, API 403, sidebar, background sync — verified) |
| Editable customer-facing copy with draft/publish (+ locale) | Admin → Content | ✅ (draft → publish → portal → revert verified; en + hi) |
| Subscriptions: plans, modules, events, activation/expiry/overrides | Admin → Subscriptions & Plans | ✅ (plan create, activate, per-customer override verified) |
| WhatsApp Out for Delivery + COD Confirmation (Confirm/Cancel buttons, cancellation flow, logs) | Admin → WhatsApp, Customer → Notifications | ✅ 10/10 server checks (`npm run verify:whatsapp`) + UI confirm/cancel |
| WhatsApp provider credentials (WATI) stored encrypted, masked | Admin → Integrations → WATI | 🟡 (fields + masking ready; no real WATI account connected yet) |
| Audit history for settings/permissions/subscriptions/content | Admin → Audit Log | ✅ (extended) |

Assumptions
1. "Scheduled" tile = shipments with pickup scheduled; "Customer Returns" = reverse orders.
2. International stays hidden until a carrier supports it (original spec), so the Domestic/International switch is not shown.
3. Buyer phone = `orders.consignee.mobile`; WhatsApp numbers are sent in E.164 (+91).
4. No reply to COD confirmation → `No Response`, shipment stays active (admin can configure a timeout action).
