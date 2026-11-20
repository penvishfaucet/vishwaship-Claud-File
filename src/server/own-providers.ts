import "server-only";
import { randomBytes } from "node:crypto";
import { sql } from "drizzle-orm";
import { audit } from "@/server/audit";
import { orgSetting, saveOrgSetting } from "@/server/couriers";
import { getDb, schema } from "@/server/db/client";
import type { ProviderContext } from "@/server/providers/types";
import { decryptJson, encryptJson, maskSecret } from "@/server/security/crypto";
import { safeFetch } from "@/server/security/safe-fetch";

/**
 * A client's OWN WhatsApp (WATI or AiSensy) and AI calling (Bolna) accounts.
 * When switched on, COD confirmations go from the client's own WhatsApp number and NDR calls run on the
 * client's own Bolna account — Vishwaship charges no credits for them. Keys are stored encrypted in
 * org_settings ("own_providers"); only masked hints are ever shown again. Each connection has its own
 * secret webhook URL (/api/webhooks/own/<key>) so replies and call results come back to this account only.
 */
export type OwnKind = "whatsapp" | "calling";
type Conn = {
  adapter: "wati" | "aisensy" | "bolna";
  secretsEnc: string; hints: Record<string, string>; values: Record<string, string>;
  on: boolean; lastTestOk: boolean | null; lastTestMessage: string | null; lastTestAt: string | null; webhookKey: string;
};
type Stored = { whatsapp?: Conn; calling?: Conn };
const KEY = "own_providers";

export const OWN_FIELDS = {
  wati: [
    { key: "apiEndpoint", label: "API endpoint", secret: false, placeholder: "https://live-mt-server.wati.io/123456" },
    { key: "accessToken", label: "Access token", secret: true, placeholder: "eyJhbGciOi… (without “Bearer”)" },
    { key: "codTemplate", label: "COD confirmation template name", secret: false, placeholder: "cod_confirm_v1" },
    { key: "ofdTemplate", label: "Out for delivery template name (optional)", secret: false, placeholder: "out_for_delivery_v1" },
  ],
  aisensy: [
    { key: "apiKey", label: "API key", secret: true, placeholder: "eyJhbGciOi…" },
    { key: "codTemplate", label: "COD confirmation API campaign name", secret: false, placeholder: "cod_confirm_v1" },
    { key: "ofdTemplate", label: "Out for delivery campaign name (optional)", secret: false, placeholder: "out_for_delivery_v1" },
  ],
  bolna: [
    { key: "apiKey", label: "API key", secret: true, placeholder: "bn-…" },
    { key: "agentId", label: "Agent ID", secret: false, placeholder: "3c90c3cc-0d44-4b50-…" },
  ],
} as const;
export type OwnAdapter = keyof typeof OWN_FIELDS;
const HOSTS = (adapter: OwnAdapter, v: Record<string, string>) => {
  if (adapter === "aisensy") return ["backend.aisensy.com"];
  if (adapter === "bolna") return ["api.bolna.ai"];
  try { const h = new URL(v.apiEndpoint).hostname.toLowerCase(); return /(^|\.)wati\.io$/.test(h) ? [h] : []; } catch { return []; }
};
const kindOf = (a: OwnAdapter): OwnKind => (a === "bolna" ? "calling" : "whatsapp");

const appUrl = () => (process.env.APP_URL ?? (process.env.NODE_ENV === "production" ? "https://vishwaship.in" : "http://localhost:3000")).replace(/\/$/, "");

/** What the client's page shows: never a secret, only hints. */
export async function ownOverview(orgId: string) {
  const s = (await orgSetting<Stored>(orgId, KEY)) ?? {};
  const view = (c?: Conn) => c ? { adapter: c.adapter, hints: c.hints, values: c.values, on: c.on, lastTestOk: c.lastTestOk, lastTestMessage: c.lastTestMessage, lastTestAt: c.lastTestAt, webhookUrl: `${appUrl()}/api/webhooks/own/${c.webhookKey}` } : null;
  return { whatsapp: view(s.whatsapp), calling: view(s.calling) };
}

/** Save keys (a blank secret keeps the saved one). Changing keys turns the connection off until it is tested again. */
export async function saveOwn(orgId: string, userId: string, adapter: OwnAdapter, input: Record<string, string>): Promise<{ ok: boolean; message: string }> {
  const kind = kindOf(adapter);
  const s = (await orgSetting<Stored>(orgId, KEY)) ?? {};
  const prev = s[kind]?.adapter === adapter ? s[kind] : undefined;
  const old = prev ? decryptJson<Record<string, string>>(prev.secretsEnc) : {};
  const v: Record<string, string> = {};
  for (const f of OWN_FIELDS[adapter]) {
    const raw = String(input[f.key] ?? "").trim().replace(/^Bearer\s+/i, "");
    if (raw.length > 4000) return { ok: false, message: `${f.label} is too long` };
    v[f.key] = raw || (f.secret ? old[f.key] ?? "" : "");
  }
  const required = OWN_FIELDS[adapter].filter((f) => !/optional/i.test(f.label));
  const missing = required.filter((f) => !v[f.key]).map((f) => f.label);
  if (missing.length) return { ok: false, message: `Fill in: ${missing.join(", ")}` };
  if (adapter === "wati" && !HOSTS("wati", v).length) return { ok: false, message: "The WATI API endpoint must be an https://…wati.io URL (WATI → API Docs)" };
  for (const k of ["codTemplate", "ofdTemplate"]) if (v[k]) v[k] = v[k].replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 80);
  const secrets = Object.fromEntries(OWN_FIELDS[adapter].filter((f) => f.secret).map((f) => [f.key, v[f.key]]));
  const values = Object.fromEntries(OWN_FIELDS[adapter].filter((f) => !f.secret).map((f) => [f.key, v[f.key]]));
  const changed = JSON.stringify(secrets) !== JSON.stringify(Object.fromEntries(Object.keys(secrets).map((k) => [k, old[k]]))) || JSON.stringify(values) !== JSON.stringify(prev?.values ?? {});
  s[kind] = {
    adapter, secretsEnc: encryptJson(secrets), hints: Object.fromEntries(Object.entries(secrets).filter(([, x]) => x).map(([k, x]) => [k, maskSecret(x)])), values,
    on: changed ? false : prev?.on ?? false, lastTestOk: changed ? null : prev?.lastTestOk ?? null, lastTestMessage: changed ? null : prev?.lastTestMessage ?? null, lastTestAt: changed ? null : prev?.lastTestAt ?? null,
    webhookKey: prev?.webhookKey ?? `${kind === "calling" ? "c" : "w"}_${randomBytes(18).toString("base64url")}`,
  };
  await saveOrgSetting(orgId, KEY, s, userId);
  await audit({ actorUserId: userId, actorKind: "customer", orgId, action: "own_provider.saved", details: { adapter } });
  return { ok: true, message: changed ? "Saved (encrypted). Now click Test connection." : "Saved — nothing changed" };
}

function ctxFor(orgId: string, c: Conn): ProviderContext {
  const secrets = decryptJson<Record<string, string>>(c.secretsEnc);
  const all = { ...c.values, ...secrets };
  const allowedHosts = HOSTS(c.adapter, all);
  return { accountId: `own_${orgId}`, mode: "live", config: { values: c.values }, secrets: all, fetch: (url, init) => safeFetch(url, { ...init, allowedHosts }) };
}

/** Real call with the client's keys; nothing is sent to a buyer. */
export async function testOwn(orgId: string, userId: string, kind: OwnKind): Promise<{ ok: boolean; message: string }> {
  const s = (await orgSetting<Stored>(orgId, KEY)) ?? {};
  const c = s[kind];
  if (!c) return { ok: false, message: "Save the keys first" };
  const ctx = ctxFor(orgId, c);
  let res: { ok: boolean; message: string };
  try {
    if (c.adapter === "wati") {
      const x = await ctx.fetch(`${String(ctx.secrets.apiEndpoint).replace(/\/+$/, "")}/api/v1/getMessageTemplates?pageSize=1`, { headers: { authorization: `Bearer ${ctx.secrets.accessToken}` }, timeoutMs: 15_000 });
      res = x.ok ? { ok: true, message: "Connected to your WATI account" } : { ok: false, message: x.status === 401 || x.status === 403 ? "WATI rejected the access token" : `WATI HTTP ${x.status}` };
    } else if (c.adapter === "aisensy") {
      const x = await ctx.fetch("https://backend.aisensy.com/campaign/t1/api/v2", { method: "POST", timeoutMs: 15_000, headers: { "content-type": "application/json" }, body: JSON.stringify({ apiKey: ctx.secrets.apiKey, campaignName: "vishwaship-connection-test-do-not-create", destination: "910000000000", userName: "Test", templateParams: [] }) });
      const t = (await x.text().catch(() => "")).slice(0, 300);
      res = x.status === 401 || x.status === 403 || /api ?key|unauthori[sz]ed|invalid token|jwt/i.test(t) ? { ok: false, message: "AiSensy rejected the API key" } : x.status >= 500 ? { ok: false, message: `AiSensy HTTP ${x.status}` } : { ok: true, message: "AiSensy accepted your API key (nothing was sent)" };
    } else {
      let x = await ctx.fetch(`https://api.bolna.ai/v2/agent/${encodeURIComponent(String(ctx.secrets.agentId))}`, { headers: { authorization: `Bearer ${ctx.secrets.apiKey}` }, timeoutMs: 15_000 });
      if (x.status === 404) x = await ctx.fetch(`https://api.bolna.ai/agent/${encodeURIComponent(String(ctx.secrets.agentId))}`, { headers: { authorization: `Bearer ${ctx.secrets.apiKey}` }, timeoutMs: 15_000 });
      res = x.ok ? { ok: true, message: "Connected to your Bolna agent" } : { ok: false, message: x.status === 401 || x.status === 403 ? "Bolna rejected the API key" : x.status === 404 ? "Bolna could not find that Agent ID" : `Bolna HTTP ${x.status}` };
    }
  } catch (e) { res = { ok: false, message: `Could not reach the provider: ${(e as Error).message}`.slice(0, 200) }; }
  s[kind] = { ...c, lastTestOk: res.ok, lastTestMessage: res.message, lastTestAt: new Date().toISOString(), on: res.ok ? c.on : false };
  await saveOrgSetting(orgId, KEY, s, userId);
  return res;
}

/** Switch on (only after a passing test) or off. Removing deletes the keys. */
export async function setOwn(orgId: string, userId: string, kind: OwnKind, on: boolean | "remove"): Promise<{ ok: boolean; message: string }> {
  const s = (await orgSetting<Stored>(orgId, KEY)) ?? {};
  const c = s[kind];
  if (!c) return { ok: false, message: "Nothing saved yet" };
  if (on === "remove") delete s[kind];
  else if (on && !c.lastTestOk) return { ok: false, message: "Run Test connection successfully first" };
  else s[kind] = { ...c, on };
  await saveOrgSetting(orgId, KEY, s, userId);
  await audit({ actorUserId: userId, actorKind: "customer", orgId, action: "own_provider.switched", details: { kind, on } });
  return { ok: true, message: on === "remove" ? "Removed" : on ? "Switched on — your own account is used from now, with no Vishwaship charges" : "Switched off — Vishwaship's service is used" };
}

/** The client's own WhatsApp for an event, when switched on and a template is set for it. */
export async function ownWhatsapp(orgId: string, event: "cod_confirmation" | "out_for_delivery") {
  const c = ((await orgSetting<Stored>(orgId, KEY)) ?? {}).whatsapp;
  if (!c?.on) return null;
  const templateName = event === "cod_confirmation" ? c.values.codTemplate : c.values.ofdTemplate;
  if (!templateName) return null;
  return { adapter: c.adapter as "wati" | "aisensy", ctx: ctxFor(orgId, c), templateName };
}

/** The client's own Bolna, when switched on. */
export async function ownCalling(orgId: string) {
  const c = ((await orgSetting<Stored>(orgId, KEY)) ?? {}).calling;
  return c?.on ? { ctx: ctxFor(orgId, c) } : null;
}

/** Which account (and which kind) a webhook key belongs to. */
export async function ownByWebhookKey(key: string): Promise<{ orgId: string; kind: OwnKind; adapter: OwnAdapter } | null> {
  if (!/^[cw]_[A-Za-z0-9_-]{20,40}$/.test(key)) return null;
  const kind: OwnKind = key.startsWith("c_") ? "calling" : "whatsapp";
  const db = await getDb();
  const [r] = await db.select().from(schema.orgSettings).where(sql`${schema.orgSettings.key} = ${KEY} and ${schema.orgSettings.value}->${kind}->>'webhookKey' = ${key}`);
  if (!r) return null;
  const c = (r.value as Stored)[kind]!;
  return { orgId: r.orgId, kind, adapter: c.adapter as OwnAdapter };
}
