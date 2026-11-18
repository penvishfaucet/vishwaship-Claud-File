# Wallet Recharge — Razorpay, Cashfree, Manual UPI / QR (2026-11-18)

## Admin configuration
| What | Where |
|---|---|
| Gateway keys, Test/Live, Test Connection, Enable/Disable, webhook URL + steps | **Admin → Settings → Payment Settings** (`/admin/payments/`) — Razorpay and Cashfree cards |
| Active online gateway (Razorpay **or** Cashfree **or** none), online min/max | same page, "Online payment gateway" |
| Manual UPI: QR image, UPI ID, beneficiary name, instructions, discount (default 0.5 %), min/max, review message, Enable | same page, "Manual UPI / QR" (Save & publish) |
| Review / approve manual requests, filter all recharges | **Admin → Finance → Wallet Recharges** (`/admin/recharges/`) |
| New-request alerts | Admin header **bell** (count of pending manual requests + latest alerts) |

Permissions: settings need `integrations.write` (Owner); approving needs `finance.adjust` (Owner / Finance); viewing needs `finance.read`.
Secrets are stored encrypted (write-only, shown masked). Manual UPI is independent of the online gateway.

### Webhooks
- Razorpay: `https://vishwaship.in/api/webhooks/razorpay` — events `payment.captured`, `payment.failed`, `order.paid`; set a webhook secret and save it as *Webhook Secret*.
- Cashfree: `https://vishwaship.in/api/webhooks/cashfree` — Payment Success / Failed / User Dropped; signed with the Secret Key (no separate secret). Orders also send it as `notify_url`.

## Customer flow (Billing → Passbook / All Recharges)
- Amount, method cards (active gateway · Manual UPI "Save 0.5%"), summary beside the form (stacked on phones).
- **Online**: backend creates the order (Razorpay Orders API / Cashfree `POST /pg/orders`), checkout opens (checkout.js / Cashfree JS v3 modal), backend verifies (Razorpay signature + payment fetch / Cashfree `GET /pg/orders/{id}/payments`) and credits; receipt shows reference, amount and new balance. Webhooks and a reconcile on the receipt page settle payments when checkout was closed after paying. Failed / expired / pending are shown.
- **Manual UPI**: ₹1,000 → discount ₹5 → pay ₹995 → credit ₹1,000 (stored on the request; later setting changes do not alter it). QR, UPI ID (Copy), Download QR, then "I Have Paid — Submit Recharge Request": UTR (required), amount paid, date/time, screenshot (JPG/PNG/WebP/PDF ≤ 5 MB, checked by content), remarks. Creates request **RR…** + ticket **VT…**, status *Pending Verification*, Admin alert. Selecting the method never credits.
- Statuses: Payment Pending · Pending Verification · More Information Required · Credited · Rejected · Failed (+ Expired, amount mismatch).
- Request page `/portal/billing/recharges/<id>/`: amounts, status, progress, ticket link, own screenshot, and the reply form when more information is requested.

## Safety
- One wallet credit per recharge: conditional status claim + ledger idempotency key `recharge:<id>` (checkout + webhook + reconcile + double clicks + two admins → one credit; tested concurrently).
- UTRs are normalised; a reused UTR is flagged on submission and can never back two credited manual recharges (DB unique index + check before approval).
- Gateway amount/currency must equal the order; mismatches are never credited and raise an Admin alert.
- Customers only see their own recharges, screenshots and tickets (all queries scoped by account; verified 404 for another account's request).

## Verified (local, demo data)
Admin saved Manual UPI with QR → customer saw ₹1,000 / ₹5 / ₹995 / ₹1,000 → submitted UTR + screenshot → request RR100001 + ticket + bell alert → Admin saw screenshot and details → Approve → wallet +₹1,000 once, passbook entry "paid ₹995 + discount ₹5", request Credited on both sides. 9 automated tests: discount maths, request + ticket + alert, single credit under double/parallel approval, duplicate UTR, info → reply → reject, duplicate gateway callbacks, amount mismatch, failed-then-success. Phone layout (390 px) checked.

## Still needed from you
1. **Razorpay** Key ID + Key Secret (+ Webhook Secret) — Test first, then Live — entered in Payment Settings, webhook added in the Razorpay dashboard.
2. **Cashfree** App ID + Secret Key (Sandbox, then Production), webhook endpoint added; domain whitelisting if Cashfree asks.
3. Choose the active gateway, then upload the real **UPI QR**, UPI ID and beneficiary name and enable Manual UPI.
4. Gateway checkouts were not run against live provider accounts (no credentials here); online flow was tested with the demo mode and automated settlement tests.
