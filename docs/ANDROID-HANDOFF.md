# Vishwaship Android app: handoff (2026-11-20, branch `feat/android-app`)

## Update 2026-11-20 (v1.1.0): the app now shows the website
At the owner's request the app is now the website itself, full screen: a **Trusted Web Activity**, which runs the site in the phone's Chrome without a URL bar. From v1.2.0 it opens with an animated Vishwaship logo (`SplashActivity`: the box icon pops in, the wordmark sweeps open and an orange line runs underneath). It then opens the website home page `https://vishwaship.in/`, with white system bars to match the site's light theme. Any change made to the website (new pages, design, features, prices, settings) appears in the app straight away, with no app update. Sign-in (including Continue with Google), wallet recharge, labels, uploads and printing behave exactly as in Chrome.
- Manifest: `com.google.androidbrowserhelper.trusted.LauncherActivity` (androidbrowserhelper 2.5.0). Links to `https://vishwaship.in/portal/…` open in the app.
- URL-bar-free mode needs `https://vishwaship.in/.well-known/assetlinks.json` to list the signing key. The route includes the upload-key fingerprint by default. Add the Play App Signing fingerprint through `ANDROID_CERT_SHA256` once the app is on Play. If Chrome cannot verify the site, the app still works but shows a small URL bar.
- Phones without Chrome (or another browser that supports Trusted Web Activities) open the site in a Custom Tab.
- A new APK is only needed to change the app icon, name or start page. Version 1.1.0 (code 2) installs over 1.0.0 because it is signed with the same key.
- The native Compose screens and the `/api/mobile/v1` API from v1.0.0 stay in the repo, but this build does not launch them. The rest of this document describes v1.0.0.

## What was built
- **Android app** in `android/`: Kotlin, Jetpack Compose, Material 3, Gradle 8.11 / AGP 8.7. There is no WebView: every screen is native, and only settings-type pages hand off to the website in a Chrome Custom Tab. Flavors: `staging` (`in.vishwaship.app.staging`, talks to `http://10.0.2.2:3000` by default) and `production` (`in.vishwaship.app`, `https://vishwaship.in`).
- **Backend additions** (backward compatible; the website is unchanged for customers):
  - `src/server/auth/session.ts`: customer sessions also accept `Authorization: Bearer vsm_…` (app tokens). They live in the same `sessions` table, so web logout-all, password reset and admin deactivation apply to the app too. Staff sessions never accept bearer tokens.
  - `src/server/mobile/*` and `src/app/api/mobile/v1/*`: sign-in, signup, reset, refresh, logout, me, home, orders, order detail, wallet, alerts, warehouses, tickets, KYC, devices, account deletion, config. Every change still goes through the existing `/api/portal/*` endpoints, so pricing, booking, ledger and KYC rules stay in one place.
  - Migration `migrations/0019_mobile_app.sql`: tables `mobile_devices` and `account_deletion_requests`, and column `in_app_alerts.pushed_at`. It is additive and runs automatically on start (`scripts/release.mts` / embedded migrations).
  - Push: `src/server/mobile/push.ts`, called from the existing job sweep. Each in-app alert is pushed once, only to signed-in devices of that account, with generic lock-screen text.
  - Cashfree app return: `/pay/cashfree/` (checkout launcher) and `/app/recharge/[id]/` (App Link return). `POST /api/portal/recharge` accepts `client:"android"`.
  - `/.well-known/assetlinks.json` (from `ANDROID_CERT_SHA256`) and the public `/account-deletion/` page.
  - `src/server/orders/view.ts`: `OrderFilters.orderId` (single order, internal only) and `warehouseId` on each row.
- **Docs**: `docs/ANDROID-PARITY-MATRIX.md` (feature-by-feature status) and `android/play/PLAY-LISTING.md` (store text, Data safety, App access, testing track, rollout and rollback). Play graphics are in `android/play/listing/`.

## Commands
Backend (repo root):
```powershell
npm run typecheck
```
```powershell
npx vitest run src/server/mobile src/server/payments
```
Android (from `android/`; needs JDK 17 and the Android SDK, with `sdk.dir` in `android/local.properties`):
```powershell
.\gradlew.bat testStagingDebugUnitTest
```
```powershell
.\gradlew.bat assembleStagingDebug
```
```powershell
.\gradlew.bat bundleProductionRelease
```
Staging against a hosted staging server instead of the emulator host:
```powershell
.\gradlew.bat assembleStagingDebug -Pvishwaship.stagingUrl=https://staging.example.in -Pvishwaship.stagingHost=staging.example.in
```
Outputs: `android/app/build/outputs/apk/staging/debug/app-staging-debug.apk` and `android/app/build/outputs/bundle/productionRelease/app-production-release.aab`.

## Configuration (no secrets in the repo or the APK)
| Where | Key | Purpose |
|---|---|---|
| server env | `FCM_SERVICE_ACCOUNT_B64` | Firebase service account (base64) for push |
| server env | `ANDROID_CERT_SHA256`, `ANDROID_PACKAGE` | App Links verification |
| server env | `ANDROID_MIN_VERSION_CODE` | Force-update older apps |
| `~/.gradle/gradle.properties` | `vishwaship.firebase.projectId/appId/apiKey/senderId` | Firebase client config. These are not secrets, but they are project-specific. Empty = push off |
| `~/.vishwaship/upload-keystore.properties` (or `VISHWASHIP_SIGNING_PROPERTIES`) | `storeFile`, `storePassword`, `keyAlias`, `keyPassword` | Release upload signing. The file stays outside the repo. Env-var alternatives: `VISHWASHIP_UPLOAD_*` |

## Signing (owner does this once, on a trusted machine)
1. Create the upload key and keep it plus its passwords in your password manager / offline backup:
   ```powershell
   & "$env:USERPROFILE\AndroidDev\jdk17\bin\keytool.exe" -genkeypair -v -keystore "$env:USERPROFILE\.vishwaship\upload.jks" -alias vishwaship-upload -keyalg RSA -keysize 4096 -validity 10000
   ```
2. Create `%USERPROFILE%\.vishwaship\upload-keystore.properties` with `storeFile=`, `storePassword=`, `keyAlias=vishwaship-upload` and `keyPassword=` lines.
3. Run `.\gradlew.bat bundleProductionRelease`. The AAB is signed with the upload key. Then in Play Console, enrol in **Play App Signing** (Google holds the app signing key).
4. Copy the **App signing key SHA-256** from Play Console → App integrity into `ANDROID_CERT_SHA256` on the server.

Without step 2 the release bundle builds **unsigned**. It cannot be uploaded until it is signed with the upload key.

## Test evidence (run on this PC, 2026-11-20)
**Automated, backend:** `npx vitest run` → **28 test files, all passing**. This includes the new `src/server/mobile/mobile.test.ts` (8 tests: sign-in by email or mobile with the website password, wrong password, token rotation, revoke-all after password reset, customer B gets 404 on A's order and cannot mark A's alerts, same install re-assigned to another account clears push, logout detaches push, push sent once to the right org only with no amounts or UTR on the lock screen, link mapping) and the existing payments, orders, labels, manifests, carriers and tickets suites. `npm run typecheck`: no errors.

**End to end over HTTP** (the same calls the app makes, against a local dev server on the demo database with the demo carrier, no live carrier or payment). Scripts are in the session scratchpad; the steps are reproducible:
| Step | Result |
|---|---|
| Wrong password | 401 |
| Customer A signs in with the website demo password | token issued; Asha Traders, wallet ₹3,011.56, KYC approved, same as the web portal |
| Home / Orders | 31 orders, the same count as the web Orders tab |
| A opens own order / B opens A's order | 200 / **404** |
| Rate Calculator, B2C 2 boxes | 3 offers, cheapest ₹215.80 |
| Create order without consignee email, then repeat the save | same order id, `replay: true` (no duplicate) |
| Book COD order (A has WhatsApp COD confirmation on) | `cod_hold` (waits for the buyer); the app now handles this code |
| Book prepaid with **two parallel taps** | one `201 confirmed` (AWB DEMO0001GR9QP4) + one `409 already_booked`; wallet debited **once** (₹215.80) and the passbook shows "Shipment Charge" for the order |
| Labels 4×6, 3×4, 4×4, 2×4, 38×100 mm, A4 2-up | all `200 application/pdf` |
| B downloads A's label / A's manifest | refused (422 / 404) |
| Daily manifest | MF261120-HK2NF, 1 AWB, PDF 200 |
| Cancel booked order | refunded ₹215.80; balance back to ₹3,011.56; passbook "Refund" |
| Ticket raised with Order ID | created; listed under My Tickets |
| Token refresh / logout | old token 401, new 200; after logout 401 |
| Admin API with a customer app token | 403 |

**Found and fixed during the run:** (1) the site's trailing-slash redirect breaks POST from OkHttp, so the app client now always uses the slash form; (2) `cod_hold` from booking is now handled in the app.

**Android:** see "Build results" below.

## Build results (this PC: JDK 17 Temurin, Android SDK platform 35, build-tools 35.0.0, Gradle 8.11.1)
- `testStagingDebugUnitTest`: 6 JUnit tests pass (money parsing, weight preview vs the web formula, server-rule validators, push-link allow-list, trailing-slash URLs, parsing the real server JSON shapes).
- `assembleStagingDebug` → `android/app/build/outputs/apk/staging/debug/app-staging-debug.apk` (`in.vishwaship.app.staging`, debug-signed, for testers only).
- `bundleProductionRelease` → `android/app/build/outputs/bundle/productionRelease/app-production-release.aab` (`in.vishwaship.app`, R8-minified, **unsigned**: sign it with your upload key, see Signing).
- Permissions in the final manifest: INTERNET, ACCESS_NETWORK_STATE, POST_NOTIFICATIONS, plus Firebase's WAKE_LOCK and C2DM RECEIVE. NFC and phone-state permissions added by SDKs were removed.
- Secret scan of the APK and AAB: no session tokens, gateway keys, private keys or server secrets.
- **Not run here:** an emulator or device. The app has not yet been launched on a phone, and no Play screenshots were captured. Installing the emulator and a system image is another ~1.5 GB and was not part of the approved download. Alternatively, install the staging APK on any Android 8+ phone (`adb install -r app-staging-debug.apk`) with the staging URL pointed at a reachable server.

## Note about your local dev server
Migration `0019_mobile_app` was applied to `.data/pglite` while a `next dev` server you had running on port 3000 was open. Restart that server so it loads the new tables. Until then, app sign-in **with a device id** returns HTTP 500 on that instance. The HTTP test run used a separate copy of the database on port 3100, which has since been stopped.

## Acceptance status
Everything in this list needs an authorised staging run with real staging services and is **not yet verified**:
- An existing web account signs into the app and sees the same records, and an app signup signs into the web. The server logic is shared and tested. The device run is pending.
- B2B and B2C bookings with real staging quotes: multi-carton, COD and prepaid, concurrent taps, interrupted booking, quote expiry, cancellation credit, weight adjustment. Comparing AWB, wallet entries and tracking across both channels.
- Printing labels and a multi-shipment daily manifest on a real thermal printer.
- Razorpay and Cashfree success, failure and interrupted-return cases on staging keys. Replaying duplicate callbacks (the server-side single credit is already covered by `recharge.test.ts`).
- Real push delivery (needs the Firebase project). Merchant and consignee pickup messaging and COD confirm, decline or timeout. These server flows are unchanged by this work.
- Compact and large phones, tablet, font scaling, slow network, denied notification permission.

## Privacy policy: text to add (the policy is owner-managed in Admin → Content, so it was not changed in code)
> **Vishwaship Android app.** The app uses the same account and data as vishwaship.in. It processes the data you enter to book and manage shipments: names, phone numbers, email, pickup and delivery addresses, product and invoice details, KYC documents and numbers, wallet and payment records, and support messages. Pickup and delivery details are shared with the courier partner that carries your shipment. Online payments are processed by Razorpay or Cashfree. Vishwaship does not receive or store your card or UPI credentials. If you turn on notifications, the app sends a Firebase Cloud Messaging token to our server so we can deliver alerts. Notifications show only a general title on the lock screen. The app contains no advertising or analytics SDKs. Files you upload (KYC, payment screenshots, ticket attachments) are stored privately. You can request account deletion in the app (More → Profile & account) or at vishwaship.in/account-deletion. Records that tax and accounting law requires us to keep (invoices, ledger, shipment records) are retained for the legally required period and then deleted.

## Known gaps (also flagged in the parity matrix)
- Continue with Google in the app, bulk import, draft editing, order tags/clone/archive, signed-manifest upload, support chat, returns UI, weight-dispute submission, and add/edit pickup address with OTP are web-only or planned.
- Locality choice after PIN lookup: the backend returns city and state only.
- Admin screen to process account-deletion requests (staff get an alert and the requests are stored).
- Admin UI to store the FCM key (it is an env var for now).
