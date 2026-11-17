# Vishwaship platform: repository and reference inventory

Date: 2026-11-17 · Stage 0 (before any code)

## Decisions (owner, 2026-11-17)

| Topic | Decision |
| --- | --- |
| Stack | Fresh Next.js (App Router, TypeScript) + PostgreSQL migrations. Embedded Postgres (PGlite) for local dev; real Postgres + Redis (BullMQ) for staging. Private S3-compatible storage for KYC and documents. |
| Existing site | Port the visuals, copy, assets and URLs from the Horizons export. Do not extend its PocketBase backend. |
| Missing references | Treat `Downloads\Shipmozo.pdf` as the Shipmozo API contract. Build portal screens from the master prompt plus the existing portal code. Flag every portal screen as **pending visual comparison** until the UI PDF and screenshots are supplied. |
| Location | This folder (Google Drive synced). Expect slow `npm install` and sync churn from `node_modules`. |

## Reference inventory

| Reference | Status | Notes |
| --- | --- | --- |
| vishwaship.com (live) | Available | Public visual baseline. Capture at 1440 / 1024 / 390 px before building the UI. |
| `horizons-export-b08546a2…zip` (Downloads) | **Found: the current site source** | React Router 7 + PocketBase. Routes: `/`, `/book`, `/login`, `/signup`, `/franchise-login`, `/customer-care`, `/portal` (overview, kyc, addresses, new-shipment, shipments, shipments/:id, settings), `/admin/portal`, `/admin/kyc`, `/admin/pricing`, `/admin/carriers`, `/admin/complaints`, `/admin/team`, plus `/api/portal/{rates,book,track/:id,label/:id}` and `/api/complaints`. Also has leftover e-commerce routes (`/product/:handle`, `/cart`, `/checkout/*`) that are probably template residue; confirm with the owner before dropping them. |
| `Vishwaship-Courier-Logos.zip` | Found | 23 PNGs: allcargo-gati, allcargo-logistics, amazon-shipping, aramex, blue-dart, borzo, delhivery, dhl, dp-world, dtdc, ecom-express, ekart, fedex-express, india-post, porter, shadowfax, shree-maruti, tci, tci-express, the-professional-couriers, trackon, ups, xpressbees. The owner must confirm which carriers are currently approved for display. |
| Logo assets | Found | `Vishwaship.com Logo with Transparent Background.png`, `Orange carton vishwaship.com logo.png`, plus the logo attached in chat (orange rotated cube + navy "vishwa" / orange "ship" / navy ".com"). The "cupped hands" variants are probably older and are not used unless the owner approves them. |
| `Shipmozo.pdf` (Downloads) | Found, unread | Assumed to be the Shipmozo API contract. Verify its version against DOC-20261105-WA0093. |
| `Shipmozo B2b rate card.pdf`, `shipment_price_list_b2c_…pdf` | Found, unread | Cost-side rate references for seeding indicative rate cards. Commercial data: do not expose to customers. |
| `rate-card-import-template (2).xlsx` | Found, unread | Candidate format for the admin rate-card import. |
| `Vishwaship-Developer-Change-Requests.pdf` | Found, unread | Earlier owner change requests. Read for requirements. |
| `Vishwaship_Mobile_App_UI_Design_v1.pdf` | **Missing** | Portal screens are pending visual comparison. |
| `DOC-20261105-WA0093.pdf` | **Missing** | Using Shipmozo.pdf instead. |
| Six screenshots (Notification Credits, Shipmozo Email/SMS/WhatsApp/Webhook, COD Confirmation) | **Missing** | Notifications and COD screens are built from the written spec only. |
| `customers.csv`, `order-report-*.csv`, `kyc_submissions_*.json`, label PDFs | Present, **not to be used as fixtures** | These contain live customer data. Never copy them into seeds. |

## Environment blockers on this PC (2026-11-17)

- Not installed: Node.js, npm, Git, Docker, PostgreSQL.
- The agent shell kills any command that runs longer than about 3 seconds, so winget installs, large downloads and archive extraction fail silently. **The owner needs to install Node.js LTS and Git manually** (both installers need an admin/UAC prompt anyway).
