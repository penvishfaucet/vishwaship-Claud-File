import Link from "next/link";
import { Fragment } from "react";
import { desc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { metaCodTemplate, retryWhatsapp, saveCodSettings, saveTemplateMapping, fillDefaultCodTemplate } from "@/server/admin/module-actions";
import { COD_BUTTONS, COD_TEMPLATE, numbered } from "@/lib/cod-template";
import { can } from "@/server/auth/rbac";
import { requireStaff } from "@/server/auth/session";
import { getDb, schema } from "@/server/db/client";
import { WA_EVENT_LABEL, codSettings, whatsappAccount, whatsappMode } from "@/server/whatsapp/service";

const CANCEL: Record<string, string> = { requested: "Cancellation requested", cancelled: "Cancelled", failed: "Cancellation Failed", action_required: "Action Required" };
const fmt = (d: Date | null) => d?.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "short", timeStyle: "short" }) ?? "—";

const WA_DEFAULT_BODY: Record<string, string> = {
  cod_confirmation: "Hi {{buyer_name}}, please confirm your COD order {{order_id}} from {{merchant_name}} for {{cod_amount}}. [Confirm Order] [Cancel Order]",
  out_for_delivery: "Hi {{buyer_name}}, your order {{order_id}} from {{merchant_name}} is out for delivery with {{carrier}} (AWB {{awb}}). Track: {{tracking_link}}",
  store_order_accepted: "Hi {{buyer_name}}, thank you! {{store_name}} has confirmed your order {{order_id}} ({{order_total}}). We will dispatch it by {{dispatch_by}}; expected delivery {{expected_delivery}}. {{payment_line}}",
  store_order_cancelled: "Hi {{buyer_name}}, sorry — {{store_name}} could not fulfil your order {{order_id}} and has cancelled it. Reason: {{reason}}. {{refund_line}}",
  store_order_dispatched: "Hi {{buyer_name}}, your order {{order_id}} from {{store_name}} is on its way with {{courier_name}} (AWB {{awb_number}}). Expected delivery {{expected_delivery}}. Track: {{tracking_link}}",
};

export default async function WhatsappOps({ searchParams }: { searchParams: Promise<{ ok?: string; err?: string; status?: string }> }) {
  const sp = await searchParams;
  const s = await requireStaff("notifications.read");
  const write = can(s.role, "notifications.write");
  const db = await getDb();
  const mode = await whatsappMode();
  const acct = await whatsappAccount();
  const isMeta = acct?.adapter === "meta_whatsapp";
  const isAisensy = acct?.adapter === "aisensy";
  const cfg = await codSettings();
  const appUrl = (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
  const templates = await db.select().from(schema.notificationTemplates).where(eq(schema.notificationTemplates.channel, "whatsapp"));
  const msgs = await db.select({ m: schema.whatsappMessages, org: schema.orgs.businessName }).from(schema.whatsappMessages).innerJoin(schema.orgs, eq(schema.orgs.id, schema.whatsappMessages.orgId))
    .where(sp.status ? eq(schema.whatsappMessages.status, sp.status) : undefined).orderBy(desc(schema.whatsappMessages.createdAt)).limit(50);
  const counts = await db.select({ status: schema.whatsappMessages.status, n: sql<number>`count(*)::int` }).from(schema.whatsappMessages).groupBy(schema.whatsappMessages.status);
  const cancellations = await db.select({ c: schema.codConfirmations, o: schema.orders, org: schema.orgs.businessName }).from(schema.codConfirmations)
    .innerJoin(schema.orders, eq(schema.orders.id, schema.codConfirmations.orderId)).innerJoin(schema.orgs, eq(schema.orgs.id, schema.codConfirmations.orgId))
    .where(isNotNull(schema.codConfirmations.cancellationStatus)).orderBy(desc(schema.codConfirmations.cancellationAt)).limit(30);
  const inbound = await db.select().from(schema.inboundEvents).where(inArray(schema.inboundEvents.provider, ["wati", "aisensy", "meta_whatsapp"])).orderBy(desc(schema.inboundEvents.createdAt)).limit(15);
  const hints = (acct?.secretsHint as Record<string, string> | null) ?? {};
  const unmatched = inbound.filter((i) => i.error && i.error !== null && !i.error.startsWith("ignored")).length;
  return (
    <>
      <div className="page-h"><div><h1>WhatsApp Operations</h1><p className="small muted" style={{ margin: "4px 0 0" }}>Out for Delivery and COD Confirmation messages, buyer replies and cancellations.</p></div></div>
      {sp.ok && <p className="note small mb12">{sp.ok}</p>}
      {sp.err && <p className="note small mb12 t-debit">{sp.err}</p>}

      <div className="split" style={{ gap: 16, alignItems: "start" }}>
        <section className="card" style={{ padding: 18 }}>
          <h2 className="b" style={{ fontSize: 15, marginTop: 0 }}>Provider connection</h2>
          <dl className="kv-list">
            <dt>Status</dt><dd><span className={`chip ${mode === "live" ? "c-active" : mode === "demo" ? "c-pending" : "c-failed"}`}>{mode === "live" ? (isMeta ? "Connected (Meta Cloud API)" : isAisensy ? "Connected (AiSensy)" : "Connected (WATI)") : mode === "demo" ? "Demo mode (local only)" : "Not connected"}</span></dd>
            <dt>Account</dt><dd className="small">{acct ? `${acct.label} · ${acct.mode}` : "—"}</dd>
            {Object.entries(hints).map(([k, v]) => <Fragment key={k}><dt>{k}</dt><dd className="small mono">{v}</dd></Fragment>)}
            <dt>Last test</dt><dd className="small">{acct?.lastTestAt ? `${fmt(acct.lastTestAt)} · ${acct.lastTestOk ? "OK" : acct.lastTestMessage ?? "failed"}` : "—"}</dd>
            <dt>Last send</dt><dd className="small">{fmt(acct?.lastSuccessAt ?? null)}</dd>
          </dl>
          <p className="small mt8">Webhook URL for the provider:</p>
          <p className="small mono" style={{ wordBreak: "break-all" }}>{isMeta ? `${appUrl}/api/webhooks/meta-whatsapp` : isAisensy ? `${appUrl}/api/webhooks/aisensy?token=<webhookToken>` : `${appUrl}/api/webhooks/wati?token=<webhookToken>`}</p>
          <p className="tiny muted">Keys are stored encrypted and never shown again. Add, change or switch provider (WATI / AiSensy / Meta) in <Link className="link" href="/admin/services/">API Keys &amp; Services</Link>.</p>
          {unmatched > 0 && <p className="small t-debit">{unmatched} recent inbound event(s) could not be matched — see below.</p>}
        </section>

        <section className="card" style={{ padding: 18 }}>
          <h2 className="b" style={{ fontSize: 15, marginTop: 0 }}>COD Confirmation rules</h2>
          <form action={saveCodSettings} className="grid2" style={{ gap: 10 }}>
            <div className="field"><label htmlFor="exp">No-response timeout (minutes)</label><input id="exp" name="expiry" type="number" min={30} max={4320} className="input" defaultValue={cfg.expiryMinutes} disabled={!write} /></div>
            <div className="field"><label htmlFor="nr">When the buyer does not reply</label><select id="nr" name="noReply" className="select" defaultValue={cfg.noReply} disabled={!write}><option value="release">No Response — keep order active (release for shipping)</option><option value="hold_for_review">No Response — hold for customer review</option><option value="cancel">Cancel the order</option></select></div>
            <div className="field"><label htmlFor="rem">Reminder after (minutes)</label><input id="rem" name="reminder" type="number" className="input" defaultValue={cfg.reminderMinutes} disabled={!write} /></div>
            <div className="field"><label htmlFor="cr">Credits per confirmation</label><input id="cr" name="credits" type="number" min={0} max={10} className="input" defaultValue={cfg.credits} disabled={!write} /></div>
            {write && <button className="btn btn-orange">Save rules</button>}
          </form>
          <p className="tiny muted mt8">The timeout applies to confirmations created after saving. The reminder is recorded for a future reminder template; no reminder message is sent today.</p>
        </section>
      </div>

      <section className="card p0 mt16">
        <h2 className="b small card-h" style={{ margin: 0 }}>Template mapping (approved templates)</h2>
        <div className="col" style={{ gap: 12, padding: 16 }}>
          {(["out_for_delivery", "cod_confirmation", "store_order_accepted", "store_order_cancelled", "store_order_dispatched"] as const).map((ev) => {
            const t = templates.find((x) => x.event === ev);
            return (
              <form key={ev} action={saveTemplateMapping} className="row wrap" style={{ gap: 8, alignItems: "end" }}>
                <input type="hidden" name="event" value={ev} />
                <b className="small" style={{ minWidth: 150 }}>{WA_EVENT_LABEL[ev]}</b>
                <div className="field"><label htmlFor={`tn-${ev}`}>Template name (WATI) / API campaign name (AiSensy) / template name (Meta)</label><input id={`tn-${ev}`} name="templateName" className="input mono" defaultValue={t?.providerTemplateName ?? ""} placeholder={ev === "cod_confirmation" ? "cod_confirm_v1" : ev === "out_for_delivery" ? "out_for_delivery_v1" : `${ev}_v1`} disabled={!write} /></div>
                <div className="field"><label htmlFor={`ap-${ev}`}>Approval</label><select id={`ap-${ev}`} name="approval" className="select" defaultValue={t?.approvalState ?? "draft"} disabled={!write}><option value="draft">Draft</option><option value="submitted">Submitted to Meta</option><option value="approved">Approved</option><option value="rejected">Rejected</option></select></div>
                <div className="field"><label htmlFor={`lg-${ev}`}>Language</label><select id={`lg-${ev}`} name="language" className="select" defaultValue={t?.language ?? "en"} disabled={!write}><option value="en">English</option><option value="hi">Hindi</option></select></div>
                <div className="field" style={{ flex: 1, minWidth: 240 }}><label htmlFor={`bd-${ev}`}>Body (reference copy)</label><input id={`bd-${ev}`} name="body" className="input" defaultValue={t?.body ?? WA_DEFAULT_BODY[ev]} disabled={!write} /></div>
                {write && <button className="btn btn-sm btn-navy">Save</button>}
              </form>
            );
          })}
          <div className="note small" style={{ whiteSpace: "normal" }}>
            <b>Ready-made COD confirmation template</b> — address, COD amount and expected delivery date, with the buttons “{COD_BUTTONS.confirm}” and “{COD_BUTTONS.cancel}” (category Utility).
            {(() => { const t = templates.find((x) => x.event === "cod_confirmation"); const lang = t?.language === "hi" ? "hi" : "en"; const n = numbered(COD_TEMPLATE[lang]); return (
              <div className="split mt8" style={{ gap: 12, alignItems: "start" }}>
                <div><div className="tiny b">Named variables (Meta / WATI)</div><pre className="tiny mono" style={{ whiteSpace: "pre-wrap", margin: "4px 0" }}>{COD_TEMPLATE[lang]}</pre></div>
                <div><div className="tiny b">Numbered variables (AiSensy)</div><pre className="tiny mono" style={{ whiteSpace: "pre-wrap", margin: "4px 0" }}>{n.text}</pre><div className="tiny muted">{n.order.map((v, i) => `{{${i + 1}}} ${v}`).join(" · ")}</div></div>
              </div>
            ); })()}
            {write && (
              <div className="row wrap mt8" style={{ gap: 8 }}>
                <form action={fillDefaultCodTemplate} className="row" style={{ gap: 6 }}><input type="hidden" name="language" value="en" /><input type="hidden" name="templateName" value={templates.find((x) => x.event === "cod_confirmation")?.providerTemplateName ?? ""} /><button className="btn btn-sm btn-outline">Use English template</button></form>
                <form action={fillDefaultCodTemplate} className="row" style={{ gap: 6 }}><input type="hidden" name="language" value="hi" /><button className="btn btn-sm btn-outline">Use Hindi template</button></form>
                {isMeta && <form action={metaCodTemplate}><input type="hidden" name="op" value="create" /><button className="btn btn-sm btn-orange">Create on Meta (send for approval)</button></form>}
                {isMeta && <form action={metaCodTemplate}><input type="hidden" name="op" value="check" /><button className="btn btn-sm btn-navy">Check Meta approval</button></form>}
              </div>
            )}
            <p className="tiny muted" style={{ margin: "6px 0 0" }}>{isMeta ? "Meta: one click creates the template; when Meta approves it (usually minutes), click Check Meta approval — the mapping turns Approved and sending starts." : "WATI: create the template with the named text (same variable names). AiSensy: use the numbered text. Add the two quick-reply buttons, get it approved, enter its name above (AiSensy: the API campaign name) and set Approval to Approved."} Clients choose the store name, help number, note and language on their COD Confirmation page.</p>
          </div>
          <p className="tiny muted">Live sending only uses templates marked <b>Approved</b>. Template variables sent: buyer_name, order_id, merchant_name, cod_amount; COD also store_name, delivery_address, expected_delivery, store_note, support_phone (+ carrier, awb, tracking_link for Out for Delivery). COD templates need quick-reply buttons exactly “Confirm Order” and “Cancel Order”.</p>
        </div>
      </section>

      <section className="card p0 mt16">
        <h2 className="b small card-h" style={{ margin: 0 }}>Messages</h2>
        <nav className="pills" style={{ padding: "8px 16px" }}>
          <Link className={!sp.status ? "pill on" : "pill"} href="/admin/whatsapp/">All</Link>
          {counts.map((c) => <Link key={c.status} className={sp.status === c.status ? "pill on" : "pill"} href={`/admin/whatsapp/?status=${c.status}`}>{c.status} {c.n}</Link>)}
        </nav>
        {msgs.length === 0 ? <p className="small muted" style={{ padding: 16 }}>No messages.</p> : (
          <div className="tbl-wrap"><table className="tbl"><thead><tr><th>Time</th><th>Customer</th><th>Event</th><th>To</th><th>Status</th><th>Reply</th><th>Credits</th>{write && <th />}</tr></thead>
            <tbody>{msgs.map(({ m, org }) => (
              <tr key={m.id}>
                <td className="small">{fmt(m.createdAt)}</td><td className="small">{org}</td>
                <td className="small">{WA_EVENT_LABEL[m.event as keyof typeof WA_EVENT_LABEL] ?? m.event}{m.isDemo && <span className="chip c-draft" style={{ marginLeft: 6 }}>demo</span>}</td>
                <td className="small mono">{m.recipientMasked}</td>
                <td><span className={`chip ${m.status === "failed" ? "c-failed" : m.status === "skipped" ? "c-draft" : "c-active"}`}>{m.status}</span>{m.error && <div className="tiny muted">{m.error}</div>}</td>
                <td className="small">{m.buyerResponse ?? "—"}</td><td>{m.creditsCharged}</td>
                {write && <td>{m.status === "failed" && <form action={retryWhatsapp}><input type="hidden" name="id" value={m.id} /><button className="btn btn-sm btn-outline">Retry</button></form>}</td>}
              </tr>
            ))}</tbody></table></div>
        )}
      </section>

      <section className="card p0 mt16">
        <h2 className="b small card-h" style={{ margin: 0 }}>Cancellation attempts (buyer pressed Cancel Order)</h2>
        {cancellations.length === 0 ? <p className="small muted" style={{ padding: 16 }}>None.</p> : (
          <div className="tbl-wrap"><table className="tbl"><thead><tr><th>When</th><th>Customer</th><th>Order</th><th>Result</th><th>Detail</th></tr></thead>
            <tbody>{cancellations.map(({ c, o, org }) => <tr key={c.id}><td className="small">{fmt(c.cancellationAt)}</td><td className="small">{org}</td><td className="small mono">{o.orderNumber}</td><td><span className={`chip ${c.cancellationStatus === "cancelled" ? "c-active" : c.cancellationStatus === "requested" ? "c-pending" : "c-failed"}`}>{CANCEL[c.cancellationStatus!]}</span></td><td className="tiny muted">{c.cancellationReason}</td></tr>)}</tbody></table></div>
        )}
      </section>

      <section className="card p0 mt16">
        <h2 className="b small card-h" style={{ margin: 0 }}>Recent inbound webhook events</h2>
        {inbound.length === 0 ? <p className="small muted" style={{ padding: 16 }}>None received yet.</p> : (
          <div className="tbl-wrap"><table className="tbl"><thead><tr><th>Received</th><th>Event</th><th>Result</th></tr></thead>
            <tbody>{inbound.map((i) => <tr key={i.id}><td className="small">{fmt(i.createdAt)}</td><td className="small mono">{String((i.payloadRedacted as Record<string, unknown>).eventType ?? "")}</td><td className="small">{i.error ?? "processed"}</td></tr>)}</tbody></table></div>
        )}
      </section>
    </>
  );
}
