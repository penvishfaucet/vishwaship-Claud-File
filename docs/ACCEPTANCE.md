# Status, provider matrix and acceptance checklist

Updated 2026-11-17. "Verified" means exercised against the running local app (embedded Postgres, demo data), not against any live provider.

## Run locally

```
npm install
powershell -ExecutionPolicy Bypass -File scripts/dev-setup.ps1   # migrations + demo seed
npm run dev                                                       # http://localhost:3000
```
Dev uses Turbopack (`next dev --turbopack`) because this PC has ~0.8 GB free RAM and webpack ran out of memory.
Known pitfall fixed: in server-action forms, don't rely on which button was clicked (`<button name value>`); use one form per action with hidden fields.
Demo logins are generated into `.data/demo-credentials.txt` (local only). `.env.local` sets `ALLOW_DEMO_STAFF_WITHOUT_MFA=1` so demo staff can skip MFA locally; never set it in staging/production.

## Provider capability matrix

| Provider | Status | Notes |
| --- | --- | --- |
| Demo network | **Demo** | Deterministic fixtures. All refs start with `DEMO`. Never counts as carrier verification. |
| Shipmozo | **Blocked: API contract missing** | `Downloads/Shipmozo.pdf` is a rate card, not the API doc. Adapter returns "unsupported" for every operation until `DOC-20261105-WA0093.pdf` is supplied. |
| Delhivery B2C / B2B | Adapter required | In catalog; cannot be enabled. |
| Shiprocket | Adapter required | In catalog; cannot be enabled. |
| DTDC / DHL / TCI / FedEx | Adapter required | Catalog entries only. |
| Razorpay | Implemented, awaiting credentials | Server-side order, Checkout signature check, raw-body webhook HMAC, payment re-fetch before credit, credit keyed by payment id. Simulated "DEMO" recharge when not configured (blocked in production). |
| Shopify (store) | Implemented, awaiting credentials | REST Admin API, version via `SHOPIFY_API_VERSION` (default 2025-10). Uses a custom-app Admin API token. Shopify has been moving custom apps to the Dev Dashboard; confirm the current way to get a token for your store before go-live. |
| WooCommerce (store) | Implemented, awaiting credentials | REST API v3, consumer key/secret over HTTPS. |
| WATI (WhatsApp) | Not implemented | Settings, credits, COD subscription and order hold are in place; sending/reply processing pending WATI account details. |
| Resend / SMTP | Not implemented | Password reset email depends on this. |
| SMS / OTP | Awaiting provider | Pickup-mobile OTP shows the code on screen in dev only. |

## Acceptance checklist

| Requirement | Result |
| --- | --- |
| Shipmozo markup: 25% default, 20% and 10% overrides, clear → default, public = global | ✅ unit tests + live API (₹133.32 vs ₹138.88 subtotal) + admin clear-override in UI |
| GST applied once; pass-through fees not marked up | ✅ unit tests |
| Customer A cannot see customer B data | ✅ order page and NDR API return 404 cross-tenant |
| Staff role restrictions (server-side) | ✅ Finance redirected from Staff, Tickets, Integrations |
| B2C prepaid journey: quote → order → book → wallet debit | ✅ demo booking, ₹197.82 debited once |
| Duplicate booking prevented | ✅ second book → 409, no second debit/AWB |
| Insufficient balance | ✅ 402, no hold left behind |
| Wallet replay-safe credit, reserve/settle/release | ✅ unit tests |
| Spreadsheet formula escaping | ✅ unit tests |
| Staff TOTP MFA | ✅ RFC 6238 vector test; enrol/verify pages built, not clicked through |
| No page-wide overflow at 390 px (home) | ✅ |
| B2B multipiece booking | ⚠️ quote verified (Allcargo Gati, 134 kg); booking not completed (demo wallet too small) |
| Labels (A4, 4×6, 38×100 mm), invoice | ✅ render with Code 128 barcode and DEMO stamp; cross-tenant label → 404 |
| CSV export totals match screen | ✅ Shipping Charges ₹4,757.20 on screen = export TOTAL row |
| KYC upload → admin approve | ✅ non-PDF and bad PAN rejected; 3 docs uploaded encrypted; 5-min signed link works, tampered link 403; approvals set org KYC = approved |
| NDR action | ✅ reattempt acknowledged; second action on same attempt → 409 |
| Weight dispute charge / waive | ✅ charge −₹59 once, waive posts compensating +₹59 |
| Webhook URL safety (SSRF) | ✅ localhost, 169.254.169.254 and http:// rejected |
| Signed webhook delivery | ⚠️ signer + retry job built; not sent to a real endpoint (needs a public https URL you control) |
| /api/v1 with API keys + idempotency | ✅ no key 401; quote parity with portal (₹138.88); missing Idempotency-Key 400; replay returns same order; changed body 409; book → AWB; tracking; other tenant's AWB 404 |
| COD hold for subscribed customer (API source) | ✅ order created in `cod_hold`; booking refused (409 cod_hold) |
| COD send without WhatsApp provider | ✅ worker marks send_failed + alert; order stays on hold, never auto-confirmed |
| COD buyer confirm/reject replies | ❌ needs WATI account + approved template |
| Background worker | ✅ in-process loop (15 s) in dev; `npm run worker` for Postgres; backoff, dead-letter + admin replay (Finance → Reconciliation) |
| Ambiguous booking reconcile job | ⚠️ handler built; not exercised (demo provider never times out) |
| Bulk CSV/XLSX upload | ✅ template (CSV + XLSX); preview flags bad PIN, in-file duplicate, existing order ID with row numbers; import creates only valid rows (server re-validates); re-upload → duplicates; imported order quoted + booked from order page |
| Real XLSX export | ✅ customer reports + admin shipments export genuine .xlsx (same rows/totals as CSV, formula guard) |
| Store connectors (Shopify / WooCommerce) | ⚠️ Implemented, awaiting credentials. Connect (with live connection test), encrypted creds, warehouse mapping, manual + 15-min auto sync, dedupe by store + external order id, import history with errors, retry via Sync now, tracking push-back job after booking. Mapping unit-tested on synthetic payloads. Validation verified (non-myshopify host, http, bad key format, private IP, other tenant's warehouse all rejected). **Not tested against a real store.** |
| Visual comparison 1440/1024/390 for every screen | ❌ only home (1440, 390) and portal/admin dashboards checked |
| Public complaint form + ticket lookup without login | ❌ pending owner decision |
| Policy pages | Owner-editable; the live site's policy pages are currently empty, so no text was copied |
