# Hosting on Hostinger (Web Apps, Node.js)

Live: https://vishwaship.in · Repo: `penvishfaucet/vishwaship-Claud-File` (branch `main`, auto-deploys on every push) · Database: Neon PostgreSQL.

## Settings
- Framework preset **Next.js** (not Vite) · Node 20.x · root `./` · build `npm run build` · output `.next`.
- Environment variables (only these): `NODE_ENV=production`, `APP_URL=https://vishwaship.in`, `DATABASE_URL` (Neon pooled string, without `&channel_binding=require`), `APP_ENCRYPTION_KEY` (from local `.env.production` — back it up; losing it makes stored credentials/KYC unreadable), `OWNER_EMAIL`, `OWNER_NAME`, `SHOPIFY_API_VERSION=2025-10`, `NEXT_TELEMETRY_DISABLED=1`.
- Do not set `WORKER_MODE` (jobs run inside the web app), `REDIS_URL`, `S3_*`, `PGUSER`/`PGPASSWORD`, or any `ALLOW_DEMO_*`.

## How it starts
Hostinger installs without devDependencies, ships only `.next` + `node_modules`, and does not run `prestart`. So:
- `next.config.ts` type-checks with `tsconfig.build.json` (excludes tests and tool configs).
- `prebuild` embeds `/migrations` into `src/server/db/migrations.generated.ts`.
- `src/instrumentation.ts` runs `src/server/db/release.ts` on start: migrations (advisory-locked), then owner bootstrap. Look for `[release]` lines in **Runtime logs**.

## Owner access
- First login: Runtime logs → search `setup-password` (Time: Last 24 hours) → open the newest link → set password → add the key in an authenticator app → Verify.
- Forgot password / lost phone: add `OWNER_RESET_CODE` = any new text (8+ chars) → **Save and redeploy** → new setup link appears in Runtime logs. Each code works once; remove the variable afterwards.

## Known limits
- Uploaded documents (KYC etc.) are stored on the server disk under `.data/private`, inside the per-deploy folder (`hbuilds/versions/<id>/`), so every redeploy loses them. Move to S3-compatible storage before relying on uploads.
- Emails (password reset for customers) need an email provider in Admin → Integrations.
