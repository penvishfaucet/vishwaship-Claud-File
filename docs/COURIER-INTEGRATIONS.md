# Courier integrations — Shipmozo, Delhivery Direct, Shipora X, Ekart, TCI, Blue Dart (2026-11-18)

## Where things are
| What | Admin menu path |
|---|---|
| Add, test, verify, activate, pause and monitor every courier account | **Admin → Settings → Courier Integrations** (`/admin/carriers/`) → *Manage* (`/admin/carriers/<account>/`) |
| Delhivery payment modes (COD / FOD), contract rate card, B2B billing address | Courier Integrations → Delhivery account → *Delhivery payment modes, rate card & billing* (`/admin/carriers/delhivery/`) |
| Markup: global default, provider/service defaults | **Admin → Finance → Pricing** (`/admin/pricing/`) |
| Markup for one customer (incl. 0%) | **Admin → Customers → customer → Pricing** |
| Search shipments by Vishwaship ID, order, external order ID, AWB, LR; last tracking sync | **Admin → Operations → All Shipments** |

Each row in Courier Integrations is **one provider account + one service** (B2C or B2B), so B2B and B2C are configured, verified and switched on separately. The route is shown on every account: *aggregator* (Shipmozo hands the order to the courier you picked) or *direct*. A Delhivery service bought through Shipmozo is a Shipmozo quote and booking; Delhivery Direct is a separate account and never mixed with it.

### Setup states
Missing Credentials → Credentials saved, not tested → **Connected** (authentication passed only) → **Ready for Activation** (authentication, rates, booking, label and tracking verified in the current environment) → **Active** → **Paused**. Providers without an adapter show **Documentation Required**. An account that is switched on but not fully verified shows *Enabled but unverified — not quoting* and is blocked at runtime (quotes and booking both check).

### How each capability gets verified
- **Authentication** — *Test authentication* (Shipmozo: `/info` + `/get-warehouses`).
- **Rates** — *Rate check*: Admin runs a shipment, enters the provider-panel amounts for the same inputs (`courier_id=amount`), and rates are verified only when every entered amount matches within ₹1. The raw provider response is shown (no credentials) so the field mapping can be checked.
- **Booking / label / pickup / tracking** — add a **pilot customer** to the account while it is in setup; only that customer sees the service (marked "verification"). Their real booking, label download, pickup and tracking scan mark each capability verified automatically. Label and tracking can also be verified by AWB from the account page.
- Verification is per environment: a sandbox pass does not count in production.

## Pricing
Customer price = round to the paisa (verified provider rate × (1 + markup ÷ 100)), then GST once on the Vishwaship price.
Markup priority: **1. customer-specific** (an explicit 0% counts) → **2. provider + service default** (`shipmozo:B2C`, `shipmozo:B2B`, `delhivery_b2c`, `delhivery_b2b`, …) → **3. global default** (initially 25%). Migration 0009 moved the old Shipmozo-wide global and customer percentages to the new global/customer keys unchanged.

Comparable rate per provider:
- **Shipmozo** — `before_tax_total_charges` (shipping + overhead charges; GST from `gst` / `gst_percentage` is removed and charged once by Vishwaship). The whole comparable rate is marked up. ₹1,000 → ₹1,250 (25%), ₹1,100 (customer 10%), ₹1,000 (customer 0%).
- **Delhivery Direct B2B** — base freight only is marked up; fuel, docket, ROV, ODA, COD/FOD pass through at cost (earlier owner rule).
- **Delhivery Direct B2C** — pre-tax charges; COD fee and insurance pass through (Admin can change per provider via component rules).

Every quote stores the provider breakdown, tax treatment, applied markup and rule, final price and 30-minute expiry. Customers see the final price and their charge lines; cost and margin are Admin-only. Each provider has its own 12-second budget, so one slow provider never hides the others. At booking an expired quote — or an order whose details changed — is re-quoted on the same account and service; if the price changed the customer must confirm the new price before anything is charged or sent.

## Shipmozo (implemented, `src/server/providers/shipmozo.ts`)
Base URL `https://shipping-api.com/app/api/v1` (editable only to the approved host `shipping-api.com`, no trailing slash). Headers `public-key` / `private-key` from the server only.
- Quote: `rate-calculator` (grams, cm, rupees; `type_of_package` SPS for B2C, configurable for B2B; `order_amount` falls back to ₹100 when no declared value because 0 is rejected). Serviceability is decided by rate-calculator — on the live account `pincode-serviceability` returned `false` for a lane where rate-calculator returned 27 couriers.
- Book: `create-warehouse` (title `VS-<warehouse code>`, once per pickup address) → `push-order` (order_id = stable Vishwaship order ID; duplicate = continue) → `assign-courier` with the quoted `courier_id` → `schedule-pickup` only when the quote said `pickups_automatically_scheduled = NO` → `get-order-detail/{order_id}` for the AWB. Timeouts are reconciled by `get-order-detail` before any retry.
- Label: `get-order-label/{awb}` (base64 PNG), served from the customer's authenticated order page, one page per label.
- Tracking: `track-order?awb_number=` every 30 minutes (no webhook contract supplied). "Picked Up" only from an explicit pickup / in-transit scan; unknown text never advances status.
- Cancel: `cancel-order`.

## Background jobs and migration
- **Migration** `0009_courier_integrations` runs automatically at server start (embedded migrations). It adds shipment indexes, moves markup rows to the new keys, and puts any pre-existing Shipmozo account back into setup as the B2C service (it was never verified).
- **Jobs** run inside the web server by default. If `WORKER_MODE=external` is set, run `npm run worker` as a separate always-on process. Jobs used here: `booking.reconcile` (uncertain / async bookings — asks the provider by order reference first, settles or releases the wallet hold once), `tracking.poll` (every 30 minutes, up to 500 open shipments per slot, all live providers including paused accounts).

## Credentials needed per provider and service
| Provider / service | Fields (Admin → Courier Integrations → account → Credentials) | Environments |
|---|---|---|
| Shipmozo B2C | Public key, Private key | Production only (no sandbox in the guide) |
| Shipmozo B2B | Public key, Private key (same or separate B2B keys — confirm with Shipmozo) | Production only |
| Delhivery Direct B2C | API token | Sandbox + production |
| Delhivery Direct B2B | B2B API username, password | Sandbox + production |
| Shipora X B2C | API key (`X-Api-Key`), webhook token (your own random text) | Production (https://shiporax.com) |
| Ekart B2C | Client ID, client secret / password, merchant code | Sandbox + production |
| TCI Express B2B | API username, password, customer code | Sandbox + production |
| Blue Dart B2C | Login ID, licence key, customer code, area code | Sandbox + production |

## Status (verified 2026-11-18)
| Provider / service | Sandbox | Live credentials | Pending — what you need to supply |
|---|---|---|---|
| **Shipmozo B2C** | No sandbox exists | ✅ Authentication passed on your live account (11 warehouses). ✅ Live rate API returned 27 courier rates (122001 → 110001, 0.5 kg); response mapping confirmed from the real response; shown to a pilot customer in the portal with logos and 25% markup. | ❗ Rate check against the **Shipmozo panel** with the same inputs (enter panel amounts in Rate check). ❗ One **pilot booking** to verify push-order → assign-courier → AWB → label → pickup → tracking (creates a real Shipmozo order — not run without your go-ahead). Webhook payload + signing method if Shipmozo offers one. **Not activated.** |
| **Shipmozo B2B** | No sandbox exists | Not tested | Shipmozo's B2B details for your account: `type_of_package` code, which courier_ids are B2B, B2B rate card, and the multi-carton push-order fields (per-box dimensions, invoice / e-way bill). Then rate check + pilot booking. **Not activated.** |
| **Delhivery Direct B2C** | Adapter built earlier; not run (no token) | Not run | B2C API token (staging + production) from Delhivery ONE; confirm Shipping Cost API vs contract rate card. Then rate check + pilot booking. |
| **Delhivery Direct B2B** | Adapter built earlier; not run (no credentials) | Not run | B2B API username/password (dev + production); confirm Freight Estimator access or supply the rate card; billing address (GST/PAN). Then rate check + pilot booking. |
| **Shipora X B2C** | No sandbox | ✅ API key accepted (40 couriers). ✅ calc-rate returned 39 live rates (122001 → 110001, 0.5 kg); request fields confirmed (`weight` kg, `pickup_pincode`, `delivery_pincode`, `length`/`breadth`/`height` cm). ✅ Tracking webhook parsed and token-checked locally. | GST basis of `total` (set in Service settings — no rates until chosen); how COD charges are quoted (COD off until then); full body + response of `POST /api/orders/webhook/import`, `PATCH /api/orders/:id/ship` response (AWB field), label response, track-by-awb response and full status list, correct cancel route, webhook signing. Customers see Shipora X rates only after booking is built. |
| **Ekart B2C** | Documentation required | — | Ekart merchant API guide, sandbox + production URLs and auth, rate API or contracted rate card, shipment creation, label, tracking codes, pickup/manifest. |
| **TCI Express B2B** | Documentation required | — | TCI API document for your customer code, rate API or contracted B2B rate card, docket/LR creation with package IDs, label, tracking, pickup. |
| **Blue Dart B2C** | Documentation required | — | API gateway access for your customer code + area, contracted rate card, waybill API version + product codes, label, tracking, pickup registration. |

Automated tests (`src/server/carriers/carriers.test.ts`, 20): markup priority and ₹1,000 → ₹1,250 / ₹1,100 / ₹1,000; Shipmozo mapping incl. the live response shape; host/base-URL validation; a provider timing out leaves other quotes usable; B2C/B2B separation and pilot-only visibility; paused and unverified accounts never quote or book; booking sends the exact quoted courier_id; repeated clicks make one provider booking and one charge; timeouts reconcile instead of re-booking; price change asks before charging; verification states.
