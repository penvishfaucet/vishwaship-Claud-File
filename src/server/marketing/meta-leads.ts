import "server-only";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/server/db/client";
import { type MetaLead, ingestMetaLead } from "@/server/crm/leads";
import { activeService, serviceRow } from "@/server/integrations/services";
import { enqueue } from "@/server/jobs/runner";
import { safeFetch } from "@/server/security/safe-fetch";

/**
 * Meta Lead Ads (Instant Form) leads → Admin → CRM Leads.
 *
 * Two ways a lead arrives, both ending in one job per lead (dedupe key metalead:<id>; the lead table is unique by
 * Meta lead ID too, so a lead is stored once):
 *  - instantly: Meta calls /api/webhooks/meta-leads (Page subscribed to "leadgen")
 *  - safety net: every 5 minutes the forms of the Page are read for leads newer than the last poll
 * Configured in Admin → API Keys & Services → Meta Lead Ads.
 */

const GRAPH = "https://graph.facebook.com/v21.0";
export const META_LEADS_HOSTS = ["graph.facebook.com"];
const LEAD_FIELDS = "id,created_time,field_data,ad_id,ad_name,adset_name,campaign_name,form_id,platform,is_organic";

const call = (url: string) => safeFetch(url, { allowedHosts: META_LEADS_HOSTS, timeoutMs: 20_000 });

async function getJson<T>(url: string): Promise<T> {
  const x = await call(url);
  const j = (await x.json().catch(() => ({}))) as T & { error?: { message?: string } };
  if (!x.ok || j.error) throw new Error(`Meta: ${j.error?.message ?? `HTTP ${x.status}`}`.slice(0, 300));
  return j;
}
const graph = <T,>(path: string, token: string) => getJson<T>(`${GRAPH}/${path}${path.includes("?") ? "&" : "?"}access_token=${encodeURIComponent(token)}`);

/** The saved token may be a system-user / user token or already a Page token: a Page token for the Page either way. */
export async function pageToken(v: Record<string, string>): Promise<{ token: string; pageName: string }> {
  const j = await graph<{ name?: string; access_token?: string }>(`${encodeURIComponent(v.pageId)}?fields=name,access_token`, v.accessToken);
  return { token: j.access_token || v.accessToken, pageName: j.name ?? v.pageId };
}

/** One lead → one job (stored once, retried with back-off when Meta is down). */
export async function queueLead(leadId: string, lead?: MetaLead) {
  if (!/^\d{5,25}$/.test(leadId)) return;
  await enqueue("metaleads.lead", lead ? { leadId, lead } : { leadId }, { dedupeKey: `metalead:${leadId}` });
}

/** Job: read the lead (when only its ID came from the webhook) and add it to CRM Leads. */
export async function deliverLead(p: { leadId: string; lead?: MetaLead }) {
  let lead = p.lead;
  if (!lead) {
    const v = await activeService("meta_leads");
    if (!v) throw new Error("Meta Lead Ads service is OFF");
    const { token } = await pageToken(v);
    lead = await graph<MetaLead>(`${p.leadId}?fields=${LEAD_FIELDS}`, token);
  }
  return ingestMetaLead(lead);
}

const OVERLAP_SEC = 3600;

/** Every 5 minutes: leads of every form of the Page created since the last poll (first run: the last 30 days). */
export async function pollLeads(): Promise<number> {
  const v = await activeService("meta_leads");
  if (!v) return 0;
  const r = await serviceRow("meta_leads");
  const cfg = (r.configPublic as Record<string, unknown> | null) ?? {};
  const startedAt = Math.floor(Date.now() / 1000);
  const since = typeof cfg.leadsPolledAt === "number" ? cfg.leadsPolledAt - OVERLAP_SEC : startedAt - 30 * 86400;
  const { token } = await pageToken(v);
  const filter = encodeURIComponent(JSON.stringify([{ field: "time_created", operator: "GREATER_THAN", value: since }]));
  let n = 0;
  let forms = await graph<{ data: Array<{ id: string }>; paging?: { next?: string } }>(`${encodeURIComponent(v.pageId)}/leadgen_forms?fields=id&limit=100`, token);
  for (let fp = 0; fp < 5; fp++) {
    for (const f of forms.data ?? []) {
      let leads = await graph<{ data: MetaLead[]; paging?: { next?: string } }>(`${f.id}/leads?fields=${LEAD_FIELDS}&filtering=${filter}&limit=100`, token);
      for (let lp = 0; lp < 10; lp++) {
        for (const l of leads.data ?? []) { await queueLead(l.id, l); n++; }
        if (!leads.paging?.next) break;
        leads = await getJson<typeof leads>(leads.paging.next);
      }
    }
    if (!forms.paging?.next) break;
    forms = await getJson<typeof forms>(forms.paging.next);
  }
  const db = await getDb();
  await db.update(schema.providerAccounts).set({ configPublic: { ...cfg, leadsPolledAt: startedAt }, lastSuccessAt: new Date() }).where(eq(schema.providerAccounts.id, r.id));
  return n;
}

/** Admin "Test connection": the Page token works and the lead forms can be read. */
export async function testMetaLeads(v: Record<string, string>): Promise<{ ok: true; message: string }> {
  const { token, pageName } = await pageToken(v);
  const forms = await graph<{ data: Array<{ id: string; name?: string }> }>(`${encodeURIComponent(v.pageId)}/leadgen_forms?fields=id,name&limit=50`, token);
  const names = forms.data.map((f) => f.name).filter(Boolean).slice(0, 5).join(", ");
  return { ok: true, message: `Connected: Page “${pageName}”, ${forms.data.length} lead form(s)${names ? ` (${names})` : ""}. Leads will appear in CRM Leads.` };
}
