# Google Play: listing, declarations and release checklist (draft for the owner)

Production submission, pricing/countries and the final declarations stay with the owner. Re-verify every requirement in Play Console on the day you submit. Policies change, and target API rules are at https://support.google.com/googleplay/android-developer/answer/11926878.

## App identity
- Package: `in.vishwaship.app` (staging build: `in.vishwaship.app.staging`, never uploaded to production)
- versionCode 1 / versionName 1.0.0 (bump `versionCode` on every upload; `ANDROID_MIN_VERSION_CODE` on the server can force an update)
- minSdk 26 (Android 8.0), targetSdk 35 (Android 15), compileSdk 35. Play currently requires new apps and updates to target API 35, from 31 Aug 2025. Check whether a newer level is required by your submission date.
- Category: Business. Contact email: support@vishwaship.com (as on the website). Website: https://vishwaship.in

## Store text
**Short description (≤ 80 chars)**
> Book, track and manage courier shipments across India with live rates.

**Full description**
> Vishwaship is the shipping app for businesses that send parcels and cargo across India. Sign in with your existing Vishwaship account; your orders, wallet, rates and tickets are the same on the website and the app.
>
> • Live courier rates for parcels (B2C) and heavy shipments (B2B), with GST, chargeable weight and delivery estimate before you book
> • Add Order in four steps: addresses, packages (multiple boxes and identical cartons), courier and payment, confirmation
> • Prepaid, Cash on Delivery and, for heavy shipments, Freight on Delivery
> • Download, share and print shipping labels in thermal 4×6, 3×4, 4×4, 2×4 and 38×100 mm sizes, plus the daily handover manifest
> • Track every shipment, act on delivery exceptions (NDR): reattempt, address correction or return
> • Wallet passbook, online recharge and UPI/QR recharge with payment proof, COD remittance status
> • Support tickets with attachments, notifications for shipment, wallet and ticket updates
> • KYC upload for the best rates
>
> A Vishwaship business account is required. New businesses can create one in the app.

## Graphics (in `android/play/listing/`)
- App icon 512×512: `icon-512.png` (from the approved logo mark on white)
- Feature graphic 1024×500: `feature-graphic-1024x500.png`
- Phone screenshots (min 2): **to capture from the staging build with synthetic data** (sign-in, Home, Orders, Add Order courier step, Order detail with labels, Wallet). See `docs/ANDROID-HANDOFF.md` → Screenshots.
- Note: the approved logo artwork reads "vishwaship.com" while the live site is vishwaship.in. Confirm this is the intended mark before publishing.

## App access (for Google reviewers)
All features need sign-in. Provide in Play Console → App content → App access:
- Login: a dedicated **reviewer** customer account on production with a small wallet balance, KYC approved and one pickup address. Create it yourself and paste the credentials only into Play Console (never into chat, email threads or the repo).
- Instructions: "Sign in with the email and password above. Use Rate Calculator (More → Rate Calculator) with pickup PIN 110001 and delivery PIN 400001 to see live rates. Booking a real shipment is not required for review."

## Data safety (draft answers; confirm against the final build)
| Data type | Collected | Shared | Purpose | Notes |
|---|---|---|---|---|
| Name, email, phone | Yes | No | Account management, app functionality | Same account as the website |
| Physical address (pickup and consignee addresses) | Yes | Yes, with courier partners, to deliver shipments | App functionality | Required to book |
| Financial info: purchase history (wallet passbook, recharges), payment info | Yes | Payment processors (Razorpay or Cashfree) process card/UPI data; the app never stores card data | App functionality | |
| Photos / files (KYC documents, payment screenshots, ticket attachments) | Yes, only files the user picks | No | App functionality, fraud prevention (KYC) | Uploaded over HTTPS to private storage |
| Government ID numbers (PAN, Aadhaar, GSTIN) | Yes | No | Account verification (KYC) | Stored masked; files private |
| App interactions / diagnostics | **No analytics or crash SDKs are included** | n/a | n/a | If you add any later, update this form |
| Device or other IDs | Firebase Cloud Messaging token (only when the user turns on notifications) and a random install ID | No | Notifications | |
- Encrypted in transit: Yes (HTTPS only in production; cleartext allowed only to the emulator host in the staging build).
- Users can request deletion: Yes, in the app (More → Profile & account → Request account deletion) and at https://vishwaship.in/account-deletion/.

## Other declarations
- Ads: No. Target audience: 18+ (business users). Content rating questionnaire: business/utility, no user-generated public content.
- Financial features declaration: the app lets businesses top up a **restricted-use shipping wallet**, which is used only to pay for physical shipping services provided by Vishwaship and its courier partners. Physical goods and services are outside Google Play Billing, so Razorpay and Cashfree are used. **Notification credits and plan upgrades are digital services**: they are deliberately *not* sold in the app (they open on the website). Keep it that way unless Google Play Billing is integrated for them.
- Permissions: INTERNET, ACCESS_NETWORK_STATE, POST_NOTIFICATIONS (asked only when the user turns notifications on). No storage, camera, location or contacts permissions. Files are chosen with the system pickers.
- Account deletion URL for Play Console: `https://vishwaship.in/account-deletion/` (deploy the server changes first).

## Testing track
- New **personal** developer accounts must run a closed test with at least 12 testers for 14 continuous days before production access. **Organization** accounts do not have this requirement. Check which type your account is in Play Console.
- Recommended order: internal testing (team) → closed testing → production with a staged rollout.

## Production rollout checklist
1. Deploy backend changes (migration `0019_mobile_app` runs on start) and set `ANDROID_CERT_SHA256` (Play App Signing SHA-256 from Play Console → App integrity), `FCM_SERVICE_ACCOUNT_B64`, `ANDROID_MIN_VERSION_CODE=1`.
2. Check `https://vishwaship.in/.well-known/assetlinks.json` lists the fingerprint. In Play Console → Deep links, confirm vishwaship.in is verified.
3. Build the release bundle with the owner's upload key (`docs/ANDROID-HANDOFF.md` → Signing). Upload to Internal testing first.
4. Smoke test on 2+ real devices: sign in with an existing web account, Rate Calculator, book a low-value staging/real shipment if authorised, label print, recharge (only if authorised for live), push, logout.
5. Promote to production with a **staged rollout** (10 % → 50 % → 100 %) while watching Android vitals and support tickets.

## Rollback
- Halt the staged rollout in Play Console (stops new installs of that version).
- Ship a fixed build with a higher versionCode (Play cannot roll back to a lower versionCode).
- Server side: the mobile API is additive. To block a broken app version, raise `ANDROID_MIN_VERSION_CODE` so it shows "Update required". To stop push, unset `FCM_SERVICE_ACCOUNT_B64`. Web customers are unaffected either way.
