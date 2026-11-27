import "server-only";
import { and, eq, inArray, ne } from "drizzle-orm";
import { audit } from "@/server/audit";
import { getDb, schema } from "@/server/db/client";
import { secretsFor } from "@/server/providers/registry";
import { encryptJson, maskSecret } from "@/server/security/crypto";
import { safeFetch } from "@/server/security/safe-fetch";

/**
 * Admin → Settings → API Keys & Services.
 * Every third-party service the platform talks to (email, Google sign-in, WhatsApp) is configured here:
 * the admin pastes the keys, tests the connection and switches the service ON — no server env vars, no deploy.
 * Values are stored AES-GCM encrypted (provider_accounts.secrets_enc); secret fields are write-only
 * (only a masked hint is shown again). Public values (IDs, endpoints) are also kept readable in config_public.
 */

export type ServiceField = { key: string; label: string; secret: boolean; required: boolean; placeholder?: string; help?: string };
export type ServiceDef = {
  adapter: "resend" | "google_oauth" | "firebase_phone" | "wati" | "meta_whatsapp" | "aisensy" | "bolna" | "google_analytics" | "meta_pixel" | "meta_leads";
  group: "Email" | "Sign-in" | "WhatsApp" | "AI calling" | "Analytics" | "Marketing";
  name: string; purpose: string; fields: ServiceField[];
  /** How to get the keys — shown on the page so anyone on the team can set it up. */
  guide: string[]; links: Array<{ label: string; url: string }>;
  /** One provider per group is active at a time (WhatsApp: WATI, AiSensy or Meta). */
  exclusive?: boolean;
};

const appUrl = () => (process.env.APP_URL ?? (process.env.NODE_ENV === "production" ? "https://vishwaship.in" : "http://localhost:3000")).replace(/\/+$/, "");

export const SERVICES: ServiceDef[] = [
  {
    adapter: "meta_leads", group: "Marketing", name: "Meta Lead Ads → CRM Leads",
    purpose: "Every lead from a Facebook / Instagram Instant Form ad is added to Admin → CRM Leads automatically — instantly through the webhook, and a 5-minute check catches anything missed. Each lead is stored once.",
    fields: [
      { key: "pageId", label: "Facebook Page ID", secret: false, required: true, placeholder: "1510965878756741", help: "Page → About → Page transparency, or Business Settings → Pages" },
      { key: "accessToken", label: "Access token (system user or Page)", secret: true, required: true, placeholder: "EAA…", help: "System user token with leads_retrieval, pages_show_list, pages_read_engagement, pages_manage_metadata, pages_manage_ads, ads_management" },
      { key: "appSecret", label: "App secret (for the instant webhook)", secret: true, required: false, help: "App settings → Basic → App secret. Without it, leads still arrive by the 5-minute check." },
      { key: "verifyToken", label: "Webhook verify token", secret: true, required: false, help: "Any long random text you choose (at least 16 characters)" },
    ],
    guide: [
      "developers.facebook.com → My Apps → Create app (Business) in the Vishwaship business portfolio. App settings → Basic: privacy policy URL https://vishwaship.in/privacy/ → copy the App secret → switch the app to Live.",
      "business.facebook.com → Settings → Users → System users → add one (Admin) → Assign assets: the Page (full control) and the app → Generate token for the app with the permissions listed under the Access token field, never expiring.",
      "Settings → Integrations → Leads access: give the app / system user access to the Page leads (if leads access is restricted).",
      "Paste everything below → Save → Test connection → Turn ON. Leads of the last 30 days are added on the first check.",
      "Instant webhook (optional): the app → Webhooks → Page → Callback URL and Verify token from below → subscribe to “leadgen”. Then subscribe the Page: Graph API Explorer → POST /<page id>/subscribed_apps?subscribed_fields=leadgen with the Page token.",
      "Check it with the Lead Ads Testing Tool: a test lead appears in CRM Leads within a minute (or 5 minutes without the webhook).",
    ],
    links: [{ label: "Meta for Developers", url: "https://developers.facebook.com/apps" }, { label: "Lead Ads Testing Tool", url: "https://developers.facebook.com/tools/lead-ads-testing" }, { label: "Business Settings", url: "https://business.facebook.com/settings" }],
  },
  {
    adapter: "google_analytics", group: "Analytics", name: "Google Analytics 4 (website visitors)",
    purpose: "Counts visitors and the pages they use on vishwaship.com. Loads only after a visitor accepts analytics cookies in the cookie banner.",
    fields: [{ key: "measurementId", label: "Measurement ID", secret: false, required: true, placeholder: "G-XXXXXXXXXX", help: "Google Analytics → Admin → Data streams → your website stream → Measurement ID" }],
    guide: [
      "Open analytics.google.com and sign in with the company Google account.",
      "Admin → Create → Property (name: Vishwaship, India, INR) → then Data streams → Add stream → Web → URL vishwaship.com.",
      "Copy the Measurement ID (starts with G-) and paste it below → Save → Test connection → Turn ON.",
      "Visitors see a cookie banner; analytics runs only for those who click Accept. Reports appear in Google Analytics within a day.",
    ],
    links: [{ label: "Google Analytics", url: "https://analytics.google.com/" }],
  },
  {
    adapter: "meta_pixel", group: "Analytics", name: "Meta Pixel (Facebook / Instagram ads)",
    purpose: "Tells Meta which ad visitors sign up, so Facebook / Instagram ads find more sellers. Sends PageView on the website and CompleteRegistration when a new account is created. Loads only after a visitor accepts cookies in the cookie banner.",
    fields: [{ key: "pixelId", label: "Pixel (Dataset) ID", secret: false, required: true, placeholder: "e.g. 1234567890123456", help: "Meta Events Manager → Data sources → your pixel → Settings → Dataset ID" }],
    guide: [
      "Open business.facebook.com → Events Manager → Connect data sources → Web → name it Vishwaship Pixel → Create.",
      "Copy the Dataset (Pixel) ID — a long number — and paste it below → Save → Turn ON.",
      "Visitors see a cookie banner; the pixel runs only for those who click Accept.",
      "Check it in Events Manager → Test events: open vishwaship.in, accept cookies — PageView should appear within a minute.",
    ],
    links: [{ label: "Meta Events Manager", url: "https://business.facebook.com/events_manager2/" }],
  },
  {
    adapter: "resend", group: "Email", name: "Resend (email)",
    purpose: "Sends the signup OTP and shipment emails (Picked Up, In Transit, Delivered …).",
    fields: [
      { key: "apiKey", label: "API key", secret: true, required: true, placeholder: "re_…", help: "Resend → API Keys → Create API Key (Sending access)" },
      { key: "inboundSecret", label: "Courier mail webhook signing secret (optional)", secret: true, required: false, placeholder: "whsec_…", help: "Only for reading courier weight-discrepancy mails automatically: Resend → Webhooks → the email.received webhook → Signing secret" },
      { key: "inboundApiKey", label: "Full-access API key for reading mails (optional)", secret: true, required: false, placeholder: "re_…", help: "Resend → API Keys → Create API Key with Full access. Leave blank if the key above already has Full access." },
    ],
    guide: [
      "Open resend.com and sign in (or sign up) with the company email.",
      "Domains → Add Domain → enter vishwaship.in. Resend shows DNS records (TXT / MX / DKIM).",
      "Add those records in Hostinger → Domains → vishwaship.in → DNS records, exactly as shown. Then click Verify in Resend (can take a few minutes to a few hours).",
      "API Keys → Create API Key → permission “Sending access” → copy the key (it is shown only once).",
      "Paste the key below → Save → Test connection → Turn ON.",
      "Then open Email & Sign-in → Sender Emails → Check verification: contact@vishwaship.in should show “verified”.",
      "Optional — read courier weight-discrepancy mails automatically: Resend must receive mail for vishwaship.com (Emails → Receiving).",
      `Resend → Webhooks → Add webhook → URL ${appUrl()}/api/webhooks/courier-mail/ (with the last /) → event “email.received” → save, then copy its Signing secret (whsec_…) into the field above. Create a Full-access API key too if the key above is Sending-only.`,
      "In the Gmail that receives the courier mails: Settings → Forwarding → Add a forwarding address → noreply@vishwaship.com. Gmail sends a confirmation code there: it appears in Admin → Weight Disputes → Courier mails received; enter it in Gmail.",
      "Gmail → Create a filter: From noreply@delhivery.com, Has the words “charged weight” → Forward to noreply@vishwaship.com. Done: every such mail now raises the discrepancy and informs the client automatically.",
    ],
    links: [{ label: "Resend dashboard", url: "https://resend.com/domains" }, { label: "Hostinger DNS", url: "https://hpanel.hostinger.com/domains" }],
  },
  {
    adapter: "google_oauth", group: "Sign-in", name: "Google sign-in",
    purpose: "Shows “Continue with Google” on the login and signup pages.",
    fields: [
      { key: "clientId", label: "Client ID", secret: false, required: true, placeholder: "…apps.googleusercontent.com" },
      { key: "clientSecret", label: "Client secret", secret: true, required: true, placeholder: "GOCSPX-…" },
    ],
    guide: [
      "Open console.cloud.google.com → create a project (e.g. “Vishwaship”).",
      "APIs & Services → OAuth consent screen (Google Auth Platform): app name Vishwaship, support email, logo; Audience: External; then Publish app.",
      "Clients (Credentials) → Create OAuth client → Application type: Web application.",
      "Authorized JavaScript origin and Authorized redirect URI: copy both from the boxes below.",
      "Create → copy the Client ID and Client secret → paste below → Save → Test connection → Turn ON.",
    ],
    links: [{ label: "Google Cloud console", url: "https://console.cloud.google.com/apis/credentials" }],
  },
  {
    adapter: "firebase_phone", group: "Sign-in", name: "Firebase mobile OTP login",
    purpose: "Shows “Login with Mobile OTP” on the login and signup pages. Firebase sends the SMS code; Vishwaship checks it on the server.",
    fields: [
      { key: "apiKey", label: "Web API key", secret: false, required: true, placeholder: "AIza…", help: "Firebase → Project settings → General → Your apps → Web app → firebaseConfig.apiKey (this key is public by design)" },
      { key: "authDomain", label: "Auth domain", secret: false, required: true, placeholder: "your-project.firebaseapp.com" },
      { key: "projectId", label: "Project ID", secret: false, required: true, placeholder: "your-project" },
      { key: "appId", label: "App ID (optional)", secret: false, required: false, placeholder: "1:1234567890:web:abc123" },
    ],
    guide: [
      "Open console.firebase.google.com → Add project (or open the existing Vishwaship project used for app notifications).",
      "Phone sign-in sends real SMS, which Google bills: upgrade the project to the Blaze (pay as you go) plan and set a budget alert in Google Cloud billing.",
      "Build → Authentication → Get started → Sign-in method → Phone → Enable → Save.",
      "Authentication → Settings → Authorized domains → Add domain: the domain shown below (and www. too if the site uses it).",
      "Authentication → Settings → SMS region policy → Allow → India only (blocks SMS fraud to other countries).",
      "Project settings (gear) → General → Your apps → Add app → Web (</>) → name it Vishwaship Web → Register. Copy apiKey, authDomain, projectId and appId from firebaseConfig.",
      "Paste them below → Save → Test connection → Turn ON. “Login with Mobile OTP” then appears on the login page.",
    ],
    links: [{ label: "Firebase console", url: "https://console.firebase.google.com/" }],
  },
  {
    adapter: "wati", group: "WhatsApp", name: "WATI (WhatsApp)", exclusive: true,
    purpose: "Out for Delivery and COD Confirmation WhatsApp messages through WATI.",
    fields: [
      { key: "apiEndpoint", label: "API endpoint", secret: false, required: true, placeholder: "https://live-mt-server.wati.io/123456", help: "WATI → API Docs: the URL shown above your access token" },
      { key: "accessToken", label: "Access token", secret: true, required: true, placeholder: "eyJhbGciOi… (without “Bearer”)" },
      { key: "webhookToken", label: "Webhook token", secret: true, required: true, placeholder: "Any long random text you choose", help: "Make up a long random text; it goes in the webhook URL below" },
    ],
    guide: [
      "Open app.wati.io and sign in → API Docs (left menu).",
      "Copy the API Endpoint URL and the Access Token (copy the token without the word “Bearer”).",
      "Choose a Webhook token: any long random text (at least 24 characters). Paste all three below → Save → Test connection → Turn ON.",
      "In WATI → Webhooks → Add webhook: paste the Webhook URL from below (with your token at the end); events: Message received and Sent message status.",
      "Map your approved WATI template names in WhatsApp Ops → Template mapping.",
    ],
    links: [{ label: "WATI", url: "https://app.wati.io" }],
  },
  {
    adapter: "aisensy", group: "WhatsApp", name: "AiSensy (WhatsApp)", exclusive: true,
    purpose: "Out for Delivery and COD Confirmation WhatsApp messages through AiSensy.",
    fields: [
      { key: "apiKey", label: "API key", secret: true, required: true, placeholder: "eyJhbGciOi…", help: "AiSensy → Manage → API Key (Developer API)" },
      { key: "webhookToken", label: "Webhook token", secret: true, required: true, placeholder: "Any long random text you choose", help: "Make up a long random text; it goes in the webhook URL below" },
    ],
    guide: [
      "Open app.aisensy.com and sign in → Manage → API Key → copy the key.",
      "Choose a Webhook token: any long random text (at least 24 characters). Paste both below → Save → Test connection → Turn ON.",
      "Create your WhatsApp templates in AiSensy and get them approved. COD confirmation needs two quick-reply buttons: “Confirm Order” and “Cancel Order”.",
      "Template variables are numbered. COD confirmation: {{1}} buyer name, {{2}} your client’s business name, {{3}} order ID, {{4}} COD amount. Out for delivery: {{1}} buyer name, {{2}} order ID, {{3}} courier, {{4}} AWB, {{5}} tracking link.",
      "Campaigns → Launch → API campaign for each approved template (e.g. cod_confirm_v1). Map these campaign names in WhatsApp Ops → Template mapping.",
      "Manage → Webhooks → add the Webhook URL below (with your token at the end); topics: message received (user messages) and message status updated.",
    ],
    links: [{ label: "AiSensy", url: "https://app.aisensy.com" }],
  },
  {
    adapter: "bolna", group: "AI calling", name: "Bolna (AI NDR calls)",
    purpose: "AI voice calls to buyers when a delivery fails (NDR): asks if they still want the parcel, then re-attempt or return.",
    fields: [
      { key: "apiKey", label: "API key", secret: true, required: true, placeholder: "bn-…", help: "Bolna dashboard → Developers → API keys" },
      { key: "agentId", label: "Agent ID", secret: false, required: true, placeholder: "e.g. 3c90c3cc-0d44-4b50-…", help: "The Bolna agent set up for NDR calls (Agents → copy ID)" },
      { key: "webhookToken", label: "Webhook token", secret: true, required: true, placeholder: "Any long random text you choose", help: "Make up a long random text; it goes in the webhook URL below" },
    ],
    guide: [
      "Open platform.bolna.ai and sign up (pay as you go — recharge from $10, no subscription).",
      "Agents → New agent → language Hindi + English. Prompt: you call on behalf of {store_name} about order {order_id} (courier {courier}) that could not be delivered ({failure_reason}). Ask if the buyer still wants it; if yes, ask a convenient day and confirm the address {delivery_address}; COD {cod_amount}. Be short and polite.",
      "In the agent’s Extraction / Analytics tab add: ndr_decision (reattempt or rto), preferred_date, new_address.",
      "In the agent’s settings, set the Webhook URL below (with your token at the end) so call results come back to Vishwaship.",
      "Buy a calling number in Bolna (or connect Exotel / Plivo), then copy the API key and the Agent ID here → Save → Test connection → Turn ON.",
      "Set the price per call in Admin → NDR / RTO. Clients switch AI calling on from their NDR page.",
    ],
    links: [{ label: "Bolna", url: "https://platform.bolna.ai" }, { label: "Bolna docs", url: "https://www.bolna.ai/docs" }],
  },
  {
    adapter: "meta_whatsapp", group: "WhatsApp", name: "Meta WhatsApp Cloud API", exclusive: true,
    purpose: "The same WhatsApp messages sent directly through Meta (instead of WATI).",
    fields: [
      { key: "phoneNumberId", label: "Phone number ID", secret: false, required: true, placeholder: "1234567890…", help: "Meta → WhatsApp → API Setup" },
      { key: "wabaId", label: "WhatsApp Business Account ID", secret: false, required: false, placeholder: "Optional" },
      { key: "accessToken", label: "Permanent access token", secret: true, required: true, placeholder: "EAA…", help: "System user token with whatsapp_business_messaging" },
      { key: "appSecret", label: "App secret", secret: true, required: true, help: "App settings → Basic → App secret (checks webhook signatures)" },
      { key: "verifyToken", label: "Webhook verify token", secret: true, required: true, help: "Any long random text you choose" },
    ],
    guide: [
      "Open developers.facebook.com → My Apps → Create app (type Business) → add the WhatsApp product.",
      "WhatsApp → API Setup: copy the Phone number ID (and the WhatsApp Business Account ID).",
      "business.facebook.com → Settings → Users → System users → add one (Admin) → Generate token for this app with whatsapp_business_messaging and whatsapp_business_management, never expiring. Copy it.",
      "App settings → Basic → App secret → Show → copy.",
      "Choose a Webhook verify token (any long random text). Paste everything below → Save → Test connection → Turn ON.",
      "WhatsApp → Configuration → Webhook: Callback URL and Verify token from below → Verify and save → subscribe to “messages”.",
      "Create and get approval for your templates in WhatsApp Manager (use named variables like {{buyer_name}}), then map them in WhatsApp Ops.",
    ],
    links: [{ label: "Meta for Developers", url: "https://developers.facebook.com/apps" }, { label: "WhatsApp Manager", url: "https://business.facebook.com/wa/manage/home" }],
  },
];

export const serviceDef = (adapter: string) => SERVICES.find((s) => s.adapter === adapter);

/** Values to copy into the provider's dashboard (redirect / webhook URLs). Never secret. */
export function serviceInfo(adapter: string): Array<{ label: string; value: string }> {
  const u = appUrl();
  if (adapter === "google_oauth") return [{ label: "Authorized JavaScript origin", value: u }, { label: "Authorized redirect URI", value: `${u}/api/auth/google/callback` }];
  if (adapter === "firebase_phone") return [{ label: "Authorized domain to add in Firebase", value: new URL(u).hostname }];
  if (adapter === "wati") return [{ label: "Webhook URL", value: `${u}/api/webhooks/wati?token=<your webhook token>` }];
  if (adapter === "aisensy") return [{ label: "Webhook URL", value: `${u}/api/webhooks/aisensy?token=<your webhook token>` }];
  if (adapter === "bolna") return [{ label: "Webhook URL", value: `${u}/api/webhooks/bolna?token=<your webhook token>` }];
  if (adapter === "meta_whatsapp") return [{ label: "Callback URL", value: `${u}/api/webhooks/meta-whatsapp` }, { label: "Verify token", value: "the Webhook verify token you entered below" }];
  if (adapter === "meta_leads") return [{ label: "Webhook callback URL", value: `${u}/api/webhooks/meta-leads` }, { label: "Verify token", value: "the Webhook verify token you entered below" }];
  return [];
}

const CATEGORY: Record<ServiceDef["adapter"], string> = { google_analytics: "analytics", meta_pixel: "analytics", resend: "email", google_oauth: "login", firebase_phone: "login", wati: "messaging", meta_whatsapp: "messaging", aisensy: "messaging", bolna: "messaging", meta_leads: "marketing" };

/** The account row for a service (created on first use; an older WATI row is reused). */
export async function serviceRow(adapter: ServiceDef["adapter"]) {
  const db = await getDb();
  const [r] = await db.select().from(schema.providerAccounts).where(and(eq(schema.providerAccounts.adapter, adapter), ne(schema.providerAccounts.status, "archived"))).limit(1);
  if (r) return r;
  const id = `svc_${adapter}`;
  await db.insert(schema.providerAccounts).values({ id, adapter, category: CATEGORY[adapter], label: serviceDef(adapter)!.name, mode: "live", status: "disabled" }).onConflictDoNothing();
  const [n] = await db.select().from(schema.providerAccounts).where(eq(schema.providerAccounts.id, id));
  return n;
}

type Row = Awaited<ReturnType<typeof serviceRow>>;
const valuesOf = (r: Row) => secretsFor(r.secretsEnc, r.mode as "test" | "live");

/** Decrypted values of a service that is switched ON, else null. Server-side only. */
export async function activeService(adapter: ServiceDef["adapter"]): Promise<Record<string, string> | null> {
  const db = await getDb();
  const [r] = await db.select().from(schema.providerAccounts).where(and(eq(schema.providerAccounts.adapter, adapter), eq(schema.providerAccounts.status, "enabled"))).limit(1);
  if (!r?.secretsEnc) return null;
  const v = valuesOf(r);
  return serviceDef(adapter)!.fields.every((f) => !f.required || v[f.key]) ? v : null;
}

/** Hosts a service may call — fixed in code; WATI's tenant host must be a wati.io host. */
function hostsFor(adapter: string, v: Record<string, string>): string[] {
  if (adapter === "resend") return ["api.resend.com"];
  if (adapter === "google_oauth") return ["oauth2.googleapis.com"];
  if (adapter === "firebase_phone") return ["www.googleapis.com"];
  if (adapter === "meta_whatsapp") return ["graph.facebook.com"];
  if (adapter === "meta_leads") return ["graph.facebook.com"];
  if (adapter === "aisensy") return ["backend.aisensy.com"];
  if (adapter === "bolna") return ["api.bolna.ai"];
  if (adapter === "wati") { try { const h = new URL(v.apiEndpoint).hostname.toLowerCase(); return /(^|\.)wati\.io$/.test(h) ? [h] : []; } catch { return []; } }
  return [];
}

export type SaveResult = { ok: true; message: string } | { ok: false; message: string };

/** Save keys. A blank secret field keeps the value already saved. Saving new keys needs a fresh test before going live. */
export async function saveService(adapter: ServiceDef["adapter"], input: Record<string, string>, by: string): Promise<SaveResult> {
  const def = serviceDef(adapter); if (!def) return { ok: false, message: "Unknown service" };
  const r = await serviceRow(adapter);
  const old = r.secretsEnc ? valuesOf(r) : {};
  const v: Record<string, string> = {};
  for (const f of def.fields) {
    const raw = String(input[f.key] ?? "").trim().replace(/^Bearer\s+/i, "");
    v[f.key] = raw || (f.secret ? old[f.key] ?? "" : "");
    if (raw.length > 4000) return { ok: false, message: `${f.label} is too long` };
  }
  const missing = def.fields.filter((f) => f.required && !v[f.key]).map((f) => f.label);
  if (missing.length) return { ok: false, message: `Fill in: ${missing.join(", ")}` };
  if (adapter === "google_analytics") v.measurementId = v.measurementId.toUpperCase();
  if (adapter === "google_analytics" && !/^G-[A-Z0-9]{6,14}$/.test(v.measurementId)) return { ok: false, message: "The Measurement ID looks like G-XXXXXXXXXX (Google Analytics → Admin → Data streams)" };
  if (adapter === "meta_pixel") v.pixelId = v.pixelId.replace(/\s/g, "");
  if (adapter === "meta_pixel" && !/^\d{10,20}$/.test(v.pixelId)) return { ok: false, message: "The Pixel (Dataset) ID is a long number (Events Manager → your pixel → Settings)" };
  if (adapter === "resend" && !/^re_[\w-]{8,}$/.test(v.apiKey)) return { ok: false, message: "A Resend API key starts with re_" };
  if (adapter === "google_oauth" && !/\.apps\.googleusercontent\.com$/.test(v.clientId)) return { ok: false, message: "The Client ID ends with .apps.googleusercontent.com" };
  if (adapter === "firebase_phone" && !/^AIza[\w-]{30,}$/.test(v.apiKey)) return { ok: false, message: "The Web API key starts with AIza (Firebase → Project settings → Your apps)" };
  if (adapter === "firebase_phone" && !/^[a-z0-9-]{4,40}$/.test(v.projectId)) return { ok: false, message: "The Project ID is lowercase letters, numbers and dashes (e.g. vishwaship-app)" };
  if (adapter === "firebase_phone" && !/^[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/.test(v.authDomain.toLowerCase())) return { ok: false, message: "The Auth domain looks like your-project.firebaseapp.com" };
  if (adapter === "wati" && !hostsFor("wati", v).length) return { ok: false, message: "The WATI API endpoint must be an https://…wati.io URL (copy it from WATI → API Docs)" };
  if (adapter === "meta_whatsapp" && !/^\d{6,}$/.test(v.phoneNumberId)) return { ok: false, message: "The Phone number ID is a number (Meta → WhatsApp → API Setup)" };
  if (adapter === "meta_leads") v.pageId = v.pageId.replace(/\s/g, "");
  if (adapter === "meta_leads" && !/^\d{6,20}$/.test(v.pageId)) return { ok: false, message: "The Page ID is a long number (Page → About → Page transparency)" };
  if (adapter === "meta_leads" && v.verifyToken && v.verifyToken.length < 16) return { ok: false, message: "Choose a webhook verify token of at least 16 characters" };
  if (adapter === "meta_leads" && !!v.verifyToken !== !!v.appSecret) return { ok: false, message: "For the instant webhook fill in both the App secret and the verify token (or leave both empty)" };
  if (adapter === "aisensy" && v.apiKey.length < 20) return { ok: false, message: "Copy the full AiSensy API key (Manage → API Key)" };
  if (((adapter === "wati" || adapter === "aisensy" || adapter === "bolna") && v.webhookToken.length < 16) || (adapter === "meta_whatsapp" && v.verifyToken.length < 16)) return { ok: false, message: "Choose a webhook token of at least 16 characters" };
  const changed = def.fields.some((f) => (old[f.key] ?? "") !== v[f.key]);
  const cleaned = Object.fromEntries(Object.entries(v).filter(([, x]) => x));
  const db = await getDb();
  await db.update(schema.providerAccounts).set({
    mode: "live", secretsEnc: encryptJson(cleaned),
    secretsHint: Object.fromEntries(def.fields.filter((f) => f.secret && v[f.key]).map((f) => [f.key, maskSecret(v[f.key])])),
    configPublic: { ...((r.configPublic as object) ?? {}), allowedHosts: hostsFor(adapter, v), values: Object.fromEntries(def.fields.filter((f) => !f.secret).map((f) => [f.key, v[f.key]])) },
    ...(changed ? { lastTestOk: null, lastTestAt: null, lastTestMessage: null } : {}),
  }).where(eq(schema.providerAccounts.id, r.id));
  await audit({ actorUserId: by, actorKind: "staff", action: "service.keys_saved", targetType: "provider_account", targetId: r.id, details: { adapter, fields: def.fields.filter((f) => input[f.key]).map((f) => f.key) } });
  return { ok: true, message: changed ? "Saved (encrypted). Now click Test connection." : "Saved — nothing changed" };
}

/** Real call to the provider with the saved keys. */
export async function testService(adapter: ServiceDef["adapter"], by: string): Promise<SaveResult> {
  const r = await serviceRow(adapter);
  if (!r.secretsEnc) return { ok: false, message: "Save the keys first" };
  const v = valuesOf(r);
  const allowedHosts = hostsFor(adapter, v);
  const call = (url: string, init: RequestInit = {}) => safeFetch(url, { ...init, allowedHosts, timeoutMs: 15_000 });
  let res: SaveResult;
  try {
    if (adapter === "google_analytics") {
      // nothing to call: Google has no key check for a public Measurement ID; the format was checked on save
      res = /^G-[A-Z0-9]{6,14}$/.test(v.measurementId) ? { ok: true, message: `Measurement ID ${v.measurementId} is valid. After turning ON, open the site, accept cookies and check Google Analytics → Reports → Realtime.` } : { ok: false, message: "The Measurement ID looks like G-XXXXXXXXXX" };
    } else if (adapter === "meta_pixel") {
      res = /^\d{10,20}$/.test(v.pixelId) ? { ok: true, message: `Pixel ${v.pixelId} is saved. After turning ON, open the site, accept cookies and check Events Manager → Test events.` } : { ok: false, message: "The Pixel ID is a long number" };
    } else if (adapter === "resend") {
      const x = await call("https://api.resend.com/domains", { headers: { authorization: `Bearer ${v.apiKey}` } });
      const j = (await x.json().catch(() => ({}))) as { data?: Array<{ name: string; status: string }>; message?: string; name?: string };
      const restricted = j.name === "restricted_api_key" || /restricted|only send/i.test(j.message ?? "");
      res = x.ok ? { ok: true, message: `Connected. Domains: ${(j.data ?? []).map((d) => `${d.name} (${d.status})`).join(", ") || "none added yet — add vishwaship.in in Resend"}` }
        : restricted ? { ok: true, message: "Connected (Sending access key). Domain verification status can only be read with a Full access key — sending works." }
        : x.status === 401 || x.status === 403 ? { ok: false, message: "Resend rejected the API key — copy it again" }
        : { ok: false, message: `Resend HTTP ${x.status}${j.message ? `: ${j.message}` : ""}` };
    } else if (adapter === "google_oauth") {
      // an intentionally invalid code: Google answers invalid_grant when the client ID + secret are right, invalid_client when not
      const x = await call("https://oauth2.googleapis.com/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ grant_type: "authorization_code", code: "vishwaship-connection-test", client_id: v.clientId, client_secret: v.clientSecret, redirect_uri: `${appUrl()}/api/auth/google/callback` }) });
      const j = (await x.json().catch(() => ({}))) as { error?: string; error_description?: string };
      res = j.error === "invalid_grant" ? { ok: true, message: "Client ID and secret accepted by Google" }
        : j.error === "invalid_client" ? { ok: false, message: "Google rejected the Client ID / secret — copy them again from the OAuth client" }
        : j.error === "redirect_uri_mismatch" ? { ok: false, message: "Add the Authorized redirect URI shown above to the OAuth client" }
        : { ok: false, message: `Google answered: ${j.error ?? x.status} ${j.error_description ?? ""}`.trim() };
    } else if (adapter === "firebase_phone") {
      // reads the project settings with the web key: proves the key + project and that this site may sign in
      const x = await call(`https://www.googleapis.com/identitytoolkit/v3/relyingparty/getProjectConfig?key=${encodeURIComponent(v.apiKey)}`);
      const j = (await x.json().catch(() => ({}))) as { projectId?: string; authorizedDomains?: string[]; error?: { message?: string } };
      const host = new URL(appUrl()).hostname;
      const domains = j.authorizedDomains ?? [];
      // Google answers with the project NUMBER (e.g. 981211259035), not the ID; every project's own
      // <id>.firebaseapp.com domain is always authorized, so that proves the key belongs to this Project ID.
      const sameProject = j.projectId === v.projectId || domains.includes(`${v.projectId}.firebaseapp.com`);
      res = !x.ok ? { ok: false, message: x.status === 400 || x.status === 403 ? "Firebase rejected the Web API key — copy it again from Project settings" : `Firebase HTTP ${x.status}${j.error?.message ? `: ${j.error.message}` : ""}` }
        : !sameProject ? { ok: false, message: `This Web API key belongs to a different Firebase project than “${v.projectId}” — copy apiKey and projectId from the same firebaseConfig` }
        : !domains.includes(host) ? { ok: false, message: `Add ${host} in Firebase → Authentication → Settings → Authorized domains, then test again` }
        : { ok: true, message: `Connected to Firebase project ${v.projectId}; ${host} is an authorized domain. Make sure Phone sign-in is enabled.` };
    } else if (adapter === "wati") {
      const base = v.apiEndpoint.replace(/\/+$/, "");
      const x = await call(`${base}/api/v1/getMessageTemplates?pageSize=1`, { headers: { authorization: `Bearer ${v.accessToken}` } });
      res = x.ok ? { ok: true, message: "Connected to WATI (templates readable)" } : { ok: false, message: x.status === 401 || x.status === 403 ? "WATI rejected the access token" : `WATI HTTP ${x.status}` };
    } else if (adapter === "bolna") {
      // read the agent: proves the key and the agent ID without placing a call
      let x = await call(`https://api.bolna.ai/v2/agent/${encodeURIComponent(v.agentId)}`, { headers: { authorization: `Bearer ${v.apiKey}` } });
      if (x.status === 404) x = await call(`https://api.bolna.ai/agent/${encodeURIComponent(v.agentId)}`, { headers: { authorization: `Bearer ${v.apiKey}` } });
      const j = (await x.json().catch(() => ({}))) as { agent_name?: string; name?: string; message?: string };
      res = x.ok ? { ok: true, message: `Connected to Bolna — agent “${j.agent_name ?? j.name ?? v.agentId}”` }
        : x.status === 401 || x.status === 403 ? { ok: false, message: "Bolna rejected the API key — copy it again" }
        : x.status === 404 ? { ok: false, message: "Bolna could not find that Agent ID — copy it from Agents" }
        : { ok: false, message: `Bolna HTTP ${x.status}${j.message ? `: ${j.message}` : ""}` };
    } else if (adapter === "aisensy") {
      // No read-only endpoint: ask for a campaign that cannot exist — nothing is sent. A valid key gets "campaign not found".
      const x = await call("https://backend.aisensy.com/campaign/t1/api/v2", { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ apiKey: v.apiKey, campaignName: "vishwaship-connection-test-do-not-create", destination: "910000000000", userName: "Test", templateParams: [] }) });
      const t = (await x.text().catch(() => "")).slice(0, 300);
      res = x.status === 401 || x.status === 403 || /api ?key|unauthori[sz]ed|invalid token|jwt/i.test(t)
        ? { ok: false, message: "AiSensy rejected the API key — copy it again from Manage → API Key" }
        : x.status >= 500 ? { ok: false, message: `AiSensy HTTP ${x.status} — try again` }
        : { ok: true, message: "AiSensy accepted the API key (test campaign not found, nothing was sent)" };
    } else if (adapter === "meta_leads") {
      const { testMetaLeads } = await import("@/server/marketing/meta-leads");
      res = await testMetaLeads(v);
    } else {
      const x = await call(`https://graph.facebook.com/v21.0/${encodeURIComponent(v.phoneNumberId)}?fields=display_phone_number,verified_name,quality_rating`, { headers: { authorization: `Bearer ${v.accessToken}` } });
      const j = (await x.json().catch(() => ({}))) as { display_phone_number?: string; verified_name?: string; error?: { message?: string } };
      res = x.ok ? { ok: true, message: `Connected: ${j.verified_name ?? "WhatsApp number"} ${j.display_phone_number ?? ""}`.trim() } : { ok: false, message: `Meta: ${j.error?.message ?? `HTTP ${x.status}`}`.slice(0, 200) };
    }
  } catch (e) {
    res = { ok: false, message: `Could not reach the provider: ${(e as Error).message}`.slice(0, 200) };
  }
  const db = await getDb();
  await db.update(schema.providerAccounts).set({ lastTestAt: new Date(), lastTestOk: res.ok, lastTestMessage: res.message.slice(0, 300) }).where(eq(schema.providerAccounts.id, r.id));
  await audit({ actorUserId: by, actorKind: "staff", action: "service.tested", targetType: "provider_account", targetId: r.id, details: { adapter, ok: res.ok } });
  return res;
}

/** Turn a service ON (only after a passing test) or OFF. WhatsApp: turning one provider ON turns the other OFF. */
export async function setServiceOn(adapter: ServiceDef["adapter"], on: boolean, by: string): Promise<SaveResult> {
  const def = serviceDef(adapter)!;
  const r = await serviceRow(adapter);
  if (on && !r.lastTestOk) return { ok: false, message: "Run Test connection successfully before turning it ON" };
  const db = await getDb();
  if (on && def.exclusive) {
    const others = SERVICES.filter((s) => s.group === def.group && s.adapter !== adapter).map((s) => s.adapter);
    await db.update(schema.providerAccounts).set({ status: "disabled" }).where(and(inArray(schema.providerAccounts.adapter, others), eq(schema.providerAccounts.status, "enabled")));
  }
  await db.update(schema.providerAccounts).set({ status: on ? "enabled" : "disabled" }).where(eq(schema.providerAccounts.id, r.id));
  await audit({ actorUserId: by, actorKind: "staff", action: on ? "service.enabled" : "service.disabled", targetType: "provider_account", targetId: r.id, details: { adapter } });
  return { ok: true, message: on ? `${def.name} is ON` : `${def.name} is OFF` };
}

/** Page data: status per service, masked hints only — never a secret value. */
export async function servicesOverview() {
  return Promise.all(SERVICES.map(async (d) => {
    const r = await serviceRow(d.adapter);
    const pub = ((r.configPublic as { values?: Record<string, string> } | null)?.values) ?? {};
    const hint = (r.secretsHint as Record<string, string> | null) ?? {};
    return {
      adapter: d.adapter, group: d.group, name: d.name, purpose: d.purpose, guide: d.guide, links: d.links, info: serviceInfo(d.adapter),
      fields: d.fields.map((f) => ({ ...f, value: f.secret ? "" : pub[f.key] ?? "", hint: f.secret ? hint[f.key] ?? null : null })),
      saved: !!r.secretsEnc, on: r.status === "enabled",
      lastTest: r.lastTestAt ? { ok: !!r.lastTestOk, message: r.lastTestMessage ?? "", at: r.lastTestAt.toISOString() } : null,
    };
  }));
}
