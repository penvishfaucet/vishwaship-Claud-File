# Status, provider matrix and acceptance checklist

Updated 2026-11-17. "Verified" means exercised against the running local app (embedded Postgres, demo data), not against any live provider.

## Run locally

```
npm install
powershell -ExecutionPolicy Bypass -File scripts/dev-setup.ps1   # migrations + demo seed
npm run dev                                                       # http://localhost:3000
```
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
| Label / invoice / exports | ⚠️ built, not opened in browser yet |
| KYC upload → admin approve | ⚠️ built, not exercised |
| NDR actions, weight dispute charge/waive | ⚠️ built, not exercised |
| Signed customer webhooks | ⚠️ built, not exercised (needs a public https endpoint) |
| /api/v1 with API keys + idempotency | ⚠️ built, not exercised |
| COD confirmation send/reply | ❌ needs WATI |
| Store connectors (Shopify/WooCommerce) | ❌ not built |
| Bulk CSV/XLSX upload, real XLSX export | ❌ not built (exports are CSV) |
| Background worker (reconcile jobs, retries, webhooks retry) | ❌ jobs are queued in the `jobs` table; worker not written |
| Visual comparison 1440/1024/390 for every screen | ❌ only home (1440, 390) and portal/admin dashboards checked |
| Public complaint form + ticket lookup without login | ❌ pending owner decision |
| Policy pages | Owner-editable; the live site's policy pages are currently empty, so no text was copied |
