# Android app ↔ customer portal parity matrix (2026-11-20)

Status key: **Native** = implemented natively in the app · **Web handoff** = opens the website page in a Chrome Custom Tab (customer signs in on the web) · **Planned** = not yet in the app · **Provider-dependent** = works only when the provider/config is live.
Evidence key: **T** = automated test passes (vitest `src/server/mobile/mobile.test.ts`, `src/server/payments/*.test.ts`; JUnit `android/app/src/test`) · **TC** = type-checks and compiles only · **U** = unverified on a device / against staging (needs a staging run, see `ANDROID-HANDOFF.md`).

Access rule for every row unless noted: customer session (web cookie `vs_cs` **or** app bearer token `vsm_…` in the same `sessions` table). The tenant is always taken from the session (`apiCustomer()` → `orgId`), never from the request.

## Account & session
| Portal route / feature | App screen | API | Status | Evidence |
|---|---|---|---|---|
| `/login/` email or mobile + password | Sign in | `POST /api/mobile/v1/auth/login` (new) | Native | T (email + mobile, wrong password, rate limit shared with web keys) |
| `/signup/` email OTP, password, terms | Create Account | `POST /api/auth/signup-otp` (existing) → `POST /api/mobile/v1/auth/signup` (new) | Native | TC, U |
| Continue with Google (`/api/auth/google/*`) | — | — | **Planned**: needs an Android OAuth client; the web flow is unchanged | — |
| `/forgot-password/` email OTP | Forgot password | `signup-otp {purpose:"reset"}` → `POST /api/mobile/v1/auth/reset` (new) | Native; signs out all web and app sessions | T (revoke-all) |
| Session expiry / refresh | automatic | `POST /api/mobile/v1/auth/refresh` (new, rotates daily; 30-day idle expiry) | Native | T |
| Logout / Log out of all devices | Profile → Sign out | `POST /api/mobile/v1/auth/logout` (new; revokes the token and detaches push) | Native | T |
| `/portal/onboarding/` Complete profile | Home notice → web | — | Web handoff | U |
| `/portal/profile/` | Profile (read) + web edit | `GET /api/mobile/v1/me` | Native read / Web handoff edit | TC |
| Account deletion (Play requirement) | Profile → Request account deletion; public `/account-deletion/` | `POST /api/mobile/v1/account/delete` (new) + table `account_deletion_requests` | Native (request). **Admin processing screen: Planned** (staff alert links to the customer page) | TC |

## Dashboard, orders, NDR
| Portal route / feature | App screen | API | Status | Evidence |
|---|---|---|---|---|
| `/portal/` dashboard tiles → Orders filters | Home (counts first, tap → tab) | `GET /api/mobile/v1/home` (wraps `tabCounts` + `listOrderRows`) | Native; promo tiles removed as requested | TC |
| `/portal/orders/` tabs, filters, search, paging | Orders | `GET /api/mobile/v1/orders` (wraps `parseOrderFilters` + `listOrderRows`) | Native: tabs, date range, payment, type, Order ID / AWB / LR / mobile search | TC |
| `/portal/ndr/` | NDR tab | same, `tab=ndr` | Native | TC |
| `/portal/orders/[id]/` detail | Order detail | `GET /api/mobile/v1/orders/[id]` (new; same row + timeline + NDR case) | Native | T (owner gets it, other customer gets 404) |
| NDR reattempt / address correction / RTO | Order detail → NDR card | `POST /api/portal/ndr/[id]` (existing) | Native | TC, U |
| Cancel (booked or unbooked) | Order detail | `POST /api/portal/orders/[id]/cancel` (existing; refund via ledger) | Native | TC, U |
| Schedule pickup | Order detail | `POST /api/portal/pickups` (existing) | Native (single shipment, today) | TC, U |
| Refresh tracking | Order detail | `POST /api/portal/shipments/[id]/refresh` | Native | TC |
| Weight discrepancy view | Order detail (carrier-adjusted weight + adjustment line) | in order row | Native read. **Dispute submission: Web handoff** (`/portal/tools/weight-discrepancy/`) | TC |
| Order tags, clone, archive, auto-assign | — | existing | **Planned** (web only) | — |
| `/portal/orders/bulk/` bulk import | — | `POST /api/portal/orders/bulk` | **Planned**: web only for now (file mapping UI) | — |
| Store order sync (Shopify, WooCommerce, custom) | More → Integrations | existing | Web handoff | — |
| Returns (`direction=reverse`) | Orders list supports it in the API | `?direction=reverse` | **Planned** in the UI (no filter chip yet) | — |

## Booking, rates, documents
| Portal route / feature | App screen | API | Status | Evidence |
|---|---|---|---|---|
| `/portal/orders/create/` Addresses → Packages → Courier & Payment | Add Order (same 4 steps + Confirmation) | `POST /api/portal/orders/form` → `POST /api/portal/orders/[id]/quote` → `POST /api/portal/orders/[id]/book` (all existing) | Native: B2C parcel / B2B heavy, multi-box groups, identical-box counts, products, COD amount, FOD (B2B), E-Way Bill > ₹50,000, ROV | TC, U |
| Quick order | Quick Order (same flow, fewer fields) | same | Native | TC |
| Drafts | Orders → Drafts tab | list only | Native read; **draft editing: Planned** | TC |
| PIN lookup with city/state auto-fill | Add Order | `GET /api/portal/pincode/[pin]` | Native | TC |
| Choose among localities | — | backend returns city/state only | **Gap**: the backend has no locality list; the customer types locality in Line 2 | — |
| Consignee email optional | Add Order | form schema | Native (labelled optional) | TC |
| Idempotent booking, insufficient balance, quote expiry, price change, ambiguous result | Confirmation step | `book` error codes `insufficient_balance` / `quote_expired` / `price_changed` / `already_booked` / 202 `ambiguous` | Native: handles each; ambiguous or offline → opens the order to check, never re-books | TC, U |
| `/portal/rates/` Rate Calculator | Rate Calculator | `POST /api/portal/quote` (existing; same payload as web → same quote) | Native | TC, U |
| Labels 4×6, 3×4, 4×4, 2×4, 38×100 mm, A4 2-up/4-up, courier original | Order detail → Download Label | `GET /api/portal/labels?ids=&format=` (existing renderer) | Native: download, open, share, print (server PDF printed unchanged) | TC; label PDFs themselves validated earlier (`.data/label-samples`) |
| Manifest (per shipment and daily bulk, grouped by pickup/courier, signature space) | Order detail + Daily manifest | `POST /api/portal/manifests` → `/pdf` | Native, with the requested notice text | TC, U |
| Invoice per shipment | Order detail → Invoice | `GET /api/portal/shipments/[id]/invoice` | Native | TC |
| Signed manifest upload | — | `POST /api/portal/manifests/[id]/signed` | **Planned** | — |

## Wallet & billing
| Portal route / feature | App screen | API | Status | Evidence |
|---|---|---|---|---|
| Live balance, passbook | Wallet → Passbook | `GET /api/mobile/v1/wallet` (wraps `passbookHistory`) | Native | TC |
| All recharges + status | Wallet → Recharges | same + `GET /api/portal/recharge/[id]` (re-checks pending with gateway) | Native | TC |
| Razorpay recharge | Recharge sheet → Razorpay Checkout SDK | `POST /api/portal/recharge` → SDK → `POST /recharge/verify` + webhook + reconcile | Native; **Provider-dependent** (live keys) | T (server: duplicate webhook = single credit); app U |
| Cashfree recharge | Recharge sheet → Custom Tab `/pay/cashfree/` → App Link `/app/recharge/[id]/` | `POST /api/portal/recharge {client:"android"}` | Native handoff; **Provider-dependent** | TC, U |
| Reported defect: Razorpay enabled but hidden | — | `usableGateways()` | **Already fixed in commit 6253c64** (every enabled gateway with keys is shown; the preferred one only orders the list). App reads the same list. | T (`gateways.test.ts`, 6/6) |
| Manual UPI / QR with benefit, UTR + screenshot | Recharge sheet → Manual | `POST /api/portal/recharge/manual`, `GET /recharge/qr` | Native; credited once after admin approval | TC, U |
| COD remittance | Wallet → COD remittance | `GET /api/mobile/v1/wallet?cod=1` | Native | TC |
| Invoices, credit/debit notes, ledgers, shipping charges, notification credits | — | export endpoints | **Web handoff / Planned** in app | — |
| Notification credit purchase | — | `POST /api/portal/credits/purchase` | **Planned**. Google Play billing policy must be checked before offering it in-app (digital service) | — |

## Notifications & support
| Portal route / feature | App screen | API | Status | Evidence |
|---|---|---|---|---|
| Bell alerts | Header bell → Notifications inbox | `GET/POST /api/mobile/v1/alerts` (new) | Native | T (ownership on mark-read) |
| Android push | automatic | `in_app_alerts.pushed_at` + `dispatchPush()` in the job sweep + `PUT /api/mobile/v1/devices` | Native; **Provider-dependent** (`FCM_SERVICE_ACCOUNT_B64` + Firebase app config) | T (pushed once, right org only, generic lock-screen text, stale-token cleanup) |
| `/portal/notifications/` Email/SMS/WhatsApp/Webhook toggles | Notifications & alerts → web | `PUT /api/portal/notifications` | Web handoff (settings), app push toggle native | — |
| WhatsApp COD confirmation | web | existing | Web handoff; flow itself unchanged on the server | — |
| `/portal/support/` My Tickets, new, detail, reply | Header ticket icon + More → Support | `GET /api/mobile/v1/tickets[/id]` (new) + existing POSTs | Native: categories, Order ID/AWB/wallet reference, attachment, idempotent submit and reply | TC, U |
| Support chat (`/api/portal/support/chat`) | — | existing | **Planned** | — |

## KYC, addresses, integrations, tools
| Portal route / feature | App screen | API | Status | Evidence |
|---|---|---|---|---|
| `/portal/kyc/` Aadhaar, PAN, cheque + IFSC, GST | KYC | `GET /api/mobile/v1/kyc` + `POST /api/portal/kyc` | Native: status, reasons, resubmit, system file picker | TC, U |
| `/portal/addresses/` pickup addresses | Pickup addresses (list) | `GET /api/mobile/v1/warehouses` | Native list; **add/edit + pickup OTP: Web handoff** | TC |
| `/portal/integrations/*`, API keys, webhooks, EDD widget, OMS | More → Integrations | — | Web handoff (module-gated) | — |
| `/portal/reports/*`, `/portal/tools/downloads/` | More → Reports | — | Web handoff (module-gated) | — |
| `/portal/settings/*` (label, invoice, tracking page, auto-assign, early COD) | More → Settings | — | Web handoff | — |
| `/portal/tools/couriers/`, price list, activity | — | — | **Planned** | — |
| `/portal/upgrade/` plans | — | — | Web handoff (Play billing policy applies to any in-app plan purchase) | — |
| Admin changes (KYC decisions, modules, gateways, carriers, rates, messaging) | all screens | same backend tables | Native by design: the app has no copies of these rules; `me.modules` comes from `resolveFeatures` | T for gateways; others U |

## Decisions that affect billing or shipment status (flagged for the owner)
1. **Shipmozo default 25 % markup and overrides**: the app never prices anything. It calls the same `getQuotes()` as the web, so the configured markup, basis and tax order apply unchanged. No change was made to pricing code in this work.
2. **Saved order, then quote**: like the web, the app saves the order before rating it. Going back from the courier step starts a new draft, and the saved order stays under Orders → New, where it can be booked or cancelled.
3. **Ambiguous booking** (carrier timeout): the app never retries `book`. It opens the order, which shows "Booking is being confirmed". The existing server reconciliation settles or releases the wallet hold.
4. **Account deletion**: requests are recorded and staff are alerted. Actual closure is a manual staff step, and an admin screen for it is still planned.
