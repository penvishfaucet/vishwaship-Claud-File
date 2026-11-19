import Link from "next/link";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { CheckCircle2, CircleAlert, CreditCard, QrCode } from "lucide-react";
import { audit } from "@/server/audit";
import { can } from "@/server/auth/rbac";
import { requireStaff } from "@/server/auth/session";
import { getDb, schema } from "@/server/db/client";
import { testCashfree } from "@/server/payments/cashfree";
import { sniffQr } from "@/server/payments/files";
import { testRazorpay } from "@/server/payments/razorpay";
import { GATEWAY_SECRETS, gatewayAccount, gatewayAvailability, getPaymentSettings, savePaymentSettings, webhookUrl } from "@/server/payments/settings";
import { pendingManualCount } from "@/server/payments/recharge";
import { decryptJson, encryptJson, maskSecret } from "@/server/security/crypto";
import { newKey, putPrivate } from "@/server/storage";
import { formatINR } from "@/lib/money";
import { bpsLabel, manualQuote } from "@/lib/recharge";

export const dynamic = "force-dynamic";
type G = "razorpay" | "cashfree";
const isG = (v: unknown): v is G => v === "razorpay" || v === "cashfree";
const rupees = (v: FormDataEntryValue | null) => Math.round(Number(String(v ?? "").replace(/[,₹\s]/g, "")) * 100);

async function saveGateway(fd: FormData) {
  "use server";
  const s = await requireStaff("integrations.write");
  const g = fd.get("gateway");
  if (!isG(g)) return;
  const acct = await gatewayAccount(g);
  const old = acct.secretsEnc ? decryptJson<Record<string, string>>(acct.secretsEnc) : {};
  const next: Record<string, string> = { ...old };
  for (const f of GATEWAY_SECRETS[g]) { const v = String(fd.get(f.key) ?? "").trim(); if (v) next[f.key] = v; }
  const mode = String(fd.get("mode")) === "live" ? "live" : "test";
  if (g === "razorpay" && next.keyId && !next.keyId.startsWith(mode === "live" ? "rzp_live_" : "rzp_test_")) redirect(`/admin/payments/?err=${encodeURIComponent(`The Razorpay Key ID does not match ${mode === "live" ? "Live" : "Test"} mode (live keys start rzp_live_, test keys rzp_test_).`)}#${g}`);
  const db = await getDb();
  await db.update(schema.providerAccounts).set({ secretsEnc: encryptJson(next), secretsHint: Object.fromEntries(Object.entries(next).map(([k, v]) => [k, maskSecret(v)])), mode, lastTestAt: null, lastTestOk: null, lastTestMessage: null }).where(eq(schema.providerAccounts.id, acct.id));
  await audit({ actorUserId: s.userId, actorKind: "staff", action: "payments.gateway_saved", targetType: "provider_account", targetId: acct.id, details: { gateway: g, mode, fields: Object.keys(next) } });
  redirect(`/admin/payments/?ok=${encodeURIComponent(`${g === "razorpay" ? "Razorpay" : "Cashfree"} settings saved. Use Test Connection to check them.`)}#${g}`);
}

async function testGateway(fd: FormData) {
  "use server";
  const s = await requireStaff("integrations.write");
  const g = fd.get("gateway");
  if (!isG(g)) return;
  const acct = await gatewayAccount(g);
  const r = g === "razorpay" ? await testRazorpay() : await testCashfree();
  const db = await getDb();
  await db.update(schema.providerAccounts).set({ lastTestAt: new Date(), lastTestOk: r.ok, lastTestMessage: r.message.slice(0, 200), ...(r.ok ? { lastSuccessAt: new Date() } : {}) }).where(eq(schema.providerAccounts.id, acct.id));
  await audit({ actorUserId: s.userId, actorKind: "staff", action: "payments.gateway_tested", targetType: "provider_account", targetId: acct.id, details: { ok: r.ok } });
  redirect(`/admin/payments/?${r.ok ? "ok" : "err"}=${encodeURIComponent(r.message)}#${g}`);
}

async function setEnabled(fd: FormData) {
  "use server";
  const s = await requireStaff("integrations.write");
  const g = fd.get("gateway");
  if (!isG(g)) return;
  const on = String(fd.get("on")) === "1";
  const acct = await gatewayAccount(g);
  if (on && !acct.secretsEnc) redirect(`/admin/payments/?err=${encodeURIComponent("Save the credentials before enabling.")}#${g}`);
  const db = await getDb();
  await db.update(schema.providerAccounts).set({ status: on ? "enabled" : "disabled" }).where(eq(schema.providerAccounts.id, acct.id));
  await audit({ actorUserId: s.userId, actorKind: "staff", action: on ? "payments.gateway_enabled" : "payments.gateway_disabled", targetType: "provider_account", targetId: acct.id, details: { gateway: g } });
  redirect(`/admin/payments/#${g}`);
}

async function setActive(fd: FormData) {
  "use server";
  const s = await requireStaff("integrations.write");
  const v = String(fd.get("active"));
  const st = await getPaymentSettings();
  const active = v === "razorpay" || v === "cashfree" ? v : "none";
  st.activeGateway = active;
  st.onlineMinPaise = Math.max(100, rupees(fd.get("onlineMin")) || st.onlineMinPaise);
  st.onlineMaxPaise = Math.max(st.onlineMinPaise, rupees(fd.get("onlineMax")) || st.onlineMaxPaise);
  await savePaymentSettings(st);
  await audit({ actorUserId: s.userId, actorKind: "staff", action: "payments.active_gateway", targetType: "setting", targetId: "payment_settings", details: { active } });
  redirect(`/admin/payments/?ok=${encodeURIComponent(active === "none" ? "Saved." : `${active === "razorpay" ? "Razorpay" : "Cashfree"} is pre-selected for customers (when enabled).`)}`);
}

async function saveManual(fd: FormData) {
  "use server";
  const s = await requireStaff("integrations.write");
  const st = await getPaymentSettings();
  const m = { ...st.manual };
  m.upiId = String(fd.get("upiId") ?? "").trim().slice(0, 80);
  if (m.upiId && !/^[A-Za-z0-9._-]{2,256}@[A-Za-z][A-Za-z0-9.-]{1,64}$/.test(m.upiId)) redirect(`/admin/payments/?err=${encodeURIComponent("Enter a valid UPI ID, e.g. vishwaship@okaxis")}#manual`);
  m.payeeName = String(fd.get("payeeName") ?? "").trim().slice(0, 80);
  m.instructions = String(fd.get("instructions") ?? "").trim().slice(0, 1000);
  m.reviewMessage = String(fd.get("reviewMessage") ?? "").trim().slice(0, 400) || m.reviewMessage;
  const pct = Number(String(fd.get("discountPct") ?? "0").replace(",", "."));
  if (!(pct >= 0 && pct <= 10)) redirect(`/admin/payments/?err=${encodeURIComponent("Discount must be between 0% and 10%")}#manual`);
  m.discountBps = Math.round(pct * 100);
  m.minPaise = Math.max(100, rupees(fd.get("minAmount")) || m.minPaise);
  m.maxPaise = Math.max(m.minPaise, rupees(fd.get("maxAmount")) || m.maxPaise);
  const file = fd.get("qr");
  if (file instanceof File && file.size > 0) {
    const buf = Buffer.from(await file.arrayBuffer());
    const kind = sniffQr(buf);
    if (!kind) redirect(`/admin/payments/?err=${encodeURIComponent("QR image must be PNG, JPG or WebP up to 2 MB")}#manual`);
    const key = newKey("payments/qr", kind.ext);
    await putPrivate(key, buf);
    m.qrKey = key; m.qrMime = kind.mime;
  }
  if (fd.get("removeQr") === "1") { m.qrKey = ""; m.qrMime = ""; }
  m.enabled = fd.get("enabled") === "on";
  if (m.enabled && (!m.upiId || !m.payeeName || !m.qrKey)) redirect(`/admin/payments/?err=${encodeURIComponent("Add the QR image, UPI ID and beneficiary name before enabling Manual UPI.")}#manual`);
  st.manual = m;
  await savePaymentSettings(st);
  await audit({ actorUserId: s.userId, actorKind: "staff", action: "payments.manual_saved", targetType: "setting", targetId: "payment_settings", details: { enabled: m.enabled, discountBps: m.discountBps, minPaise: m.minPaise, maxPaise: m.maxPaise, qr: !!m.qrKey } });
  redirect(`/admin/payments/?ok=${encodeURIComponent("Manual UPI settings saved and published to the Customer Portal.")}#manual`);
}

export default async function PaymentSettingsPage({ searchParams }: { searchParams: Promise<{ ok?: string; err?: string }> }) {
  const sp = await searchParams;
  const s = await requireStaff("integrations.read");
  const write = can(s.role, "integrations.write");
  const st = await getPaymentSettings();
  const accts = { razorpay: await gatewayAccount("razorpay"), cashfree: await gatewayAccount("cashfree") };
  const avail = await Promise.all((["razorpay", "cashfree"] as const).map(async (g) => { const a = await gatewayAvailability(g); return { g, usable: a.usable, reason: a.reason }; }));
  const pending = await pendingManualCount();
  const ex = manualQuote(1000_00, st.manual.discountBps);
  const card = (g: G) => {
    const a = accts[g];
    const hint = (a.secretsHint ?? {}) as Record<string, string>;
    const configured = GATEWAY_SECRETS[g].filter((f) => g !== "razorpay" || f.key !== "webhookSecret").every((f) => hint[f.key]);
    const name = g === "razorpay" ? "Razorpay" : "Cashfree";
    const isActive = st.activeGateway === g && avail.find((x) => x.g === g)?.usable;
    return (
      <section key={g} id={g} className="card pay-card" style={{ padding: 18 }}>
        <div className="row between wrap" style={{ gap: 8 }}>
          <h2 style={{ fontSize: 17, margin: 0, display: "flex", gap: 8, alignItems: "center" }}><CreditCard size={18} aria-hidden />{name}</h2>
          <span className="row" style={{ gap: 6 }}>
            {avail.find((x) => x.g === g)?.usable ? <span className="chip c-active">Shown to customers</span> : null}{isActive && <span className="chip c-pending">Preferred</span>}
            <span className={`chip ${a.status === "enabled" ? "c-active" : "c-draft"}`}>{a.status === "enabled" ? "Enabled" : "Disabled"}</span>
            <span className={`chip ${a.mode === "live" ? "c-pending" : "c-draft"}`}>{a.mode === "live" ? "Live" : "Test"}</span>
          </span>
        </div>
        <p className="small" style={{ margin: "8px 0" }}>
          {a.lastTestAt ? (a.lastTestOk ? <span className="t-credit"><CheckCircle2 size={14} aria-hidden /> {a.lastTestMessage}</span> : <span className="t-debit"><CircleAlert size={14} aria-hidden /> {a.lastTestMessage}</span>) : <span className="muted">{configured ? "Not tested yet" : "Not configured"}</span>}
          {a.lastTestAt && <span className="tiny muted"> · {a.lastTestAt.toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}</span>}
        </p>
        {write ? (
          <form action={saveGateway} className="col" style={{ gap: 8 }}>
            <input type="hidden" name="gateway" value={g} />
            <div className="field"><label htmlFor={`${g}-mode`}>Environment</label><select id={`${g}-mode`} name="mode" className="select" defaultValue={a.mode}><option value="test">Test / Sandbox</option><option value="live">Live / Production</option></select></div>
            {GATEWAY_SECRETS[g].map((f) => (
              <div key={f.key} className="field"><label htmlFor={`${g}-${f.key}`}>{f.label}</label>
                <input id={`${g}-${f.key}`} name={f.key} className="input" type={f.secret ? "password" : "text"} autoComplete="off" placeholder={hint[f.key] ? `Saved: ${hint[f.key]} (leave blank to keep)` : "Not set"} /></div>
            ))}
            <div className="row wrap" style={{ gap: 8 }}><button className="btn btn-orange btn-sm">Save</button><button formAction={testGateway} className="btn btn-outline btn-sm" disabled={!configured}>Test Connection</button></div>
          </form>
        ) : <p className="small muted">Read-only. {configured ? "Credentials saved." : "Not configured."}</p>}
        {write && (
          <form action={setEnabled} className="mt8"><input type="hidden" name="gateway" value={g} /><input type="hidden" name="on" value={a.status === "enabled" ? "0" : "1"} />
            <button className={`btn btn-sm ${a.status === "enabled" ? "btn-outline" : "btn-green"}`}>{a.status === "enabled" ? `Disable ${name}` : `Enable ${name}`}</button></form>
        )}
        <details className="mt12"><summary className="small b">Webhook setup</summary>
          <div className="small" style={{ marginTop: 8 }}>
            <p style={{ margin: "0 0 6px" }}>Webhook URL:</p>
            <code className="mono tiny" style={{ display: "block", padding: 8, background: "var(--gray-soft)", borderRadius: 8, wordBreak: "break-all" }}>{webhookUrl(g)}</code>
            {g === "razorpay" ? (
              <ol style={{ paddingLeft: 18, margin: "8px 0 0" }}>
                <li>Razorpay Dashboard → Account &amp; Settings → Webhooks → Add New Webhook (in the same Test/Live mode as the keys).</li>
                <li>Paste the URL above, set a Secret and save the same value here as <b>Webhook Secret</b>.</li>
                <li>Active events: <code>payment.captured</code>, <code>payment.failed</code>, <code>order.paid</code>.</li>
                <li>Keys: Account &amp; Settings → API Keys → Generate Key (Key ID + Key Secret).</li>
              </ol>
            ) : (
              <ol style={{ paddingLeft: 18, margin: "8px 0 0" }}>
                <li>Cashfree Merchant Dashboard → Developers → API Keys (Payment Gateway): copy the App ID and Secret Key for Sandbox or Production.</li>
                <li>Developers → Webhooks → Add Webhook Endpoint: paste the URL above, choose the latest webhook version and the events <b>Payment Success, Payment Failed, Payment User Dropped</b>.</li>
                <li>Webhooks are signed with your Secret Key — no separate webhook secret is needed. Each order also sends this URL as <code>notify_url</code>.</li>
                <li>Production: if Cashfree asks for domain whitelisting, add <b>{new URL(webhookUrl(g)).host}</b> (Developers → Whitelisting) so checkout can open on your site.</li>
              </ol>
            )}
          </div>
        </details>
      </section>
    );
  };
  return (
    <>
      <div className="page-h">
        <div><h1>Payment Settings</h1><p className="small muted" style={{ margin: "4px 0 0" }}>Wallet recharge methods shown in the Customer Portal.</p></div>
        <div className="actions"><Link className="btn btn-outline" href="/admin/recharges/?status=open">Manual requests{pending ? <span className="chip c-pending" style={{ marginLeft: 6 }}>{pending} pending</span> : null}</Link></div>
      </div>
      {sp.ok && <p className="note small mb12" role="status">{sp.ok}</p>}
      {sp.err && <p className="note small mb12 t-debit" role="alert">{sp.err}</p>}

      <section className="card mb16" style={{ padding: 18 }}>
        <h2 style={{ fontSize: 16, margin: "0 0 8px" }}>Online payment gateways</h2>
        <div className="pay-visible mb12" aria-label="What customers see">
          <b className="small">What customers see in Wallet → Recharge</b>
          <ul className="plain-list small" style={{ margin: "6px 0 0" }}>
            {avail.map((a) => <li key={a.g} className="row" style={{ gap: 8 }}><span className={`chip ${a.usable ? "c-active" : "c-draft"}`}>{a.usable ? "Shown" : "Hidden"}</span>{a.reason}</li>)}
            <li className="row" style={{ gap: 8 }}><span className={`chip ${st.manual.enabled ? "c-active" : "c-draft"}`}>{st.manual.enabled ? "Shown" : "Hidden"}</span>Manual UPI / QR {st.manual.enabled ? "is shown" : "is off"}</li>
          </ul>
        </div>
        <form action={setActive} className="row wrap" style={{ gap: 12, alignItems: "end" }}>
          <div className="field"><label htmlFor="active">Preferred gateway (pre-selected when both are on)</label>
            <select id="active" name="active" className="select" defaultValue={st.activeGateway === "none" ? "razorpay" : st.activeGateway} disabled={!write}>
              <option value="razorpay">Razorpay{accts.razorpay.status === "enabled" ? "" : " (disabled)"}</option>
              <option value="cashfree">Cashfree{accts.cashfree.status === "enabled" ? "" : " (disabled)"}</option>
            </select></div>
          <div className="field"><label htmlFor="onlineMin">Online minimum (₹)</label><input id="onlineMin" name="onlineMin" className="input" inputMode="numeric" defaultValue={st.onlineMinPaise / 100} disabled={!write} /></div>
          <div className="field"><label htmlFor="onlineMax">Online maximum (₹)</label><input id="onlineMax" name="onlineMax" className="input" inputMode="numeric" defaultValue={st.onlineMaxPaise / 100} disabled={!write} /></div>
          {write && <button className="btn btn-navy btn-sm">Save</button>}
        </form>
        <p className="tiny muted" style={{ margin: "8px 0 0" }}>Each gateway is shown to customers when it is <b>Enabled</b> and its keys are saved — use Enable / Disable on its card to control it. Manual UPI is independent. Orders already started on a gateway that was switched off still settle through its webhook.</p>
      </section>

      <div className="grid2 mb16" style={{ gap: 16, alignItems: "start" }}>{card("razorpay")}{card("cashfree")}</div>

      <section id="manual" className="card" style={{ padding: 18 }}>
        <div className="row between wrap" style={{ gap: 8 }}>
          <h2 style={{ fontSize: 17, margin: 0, display: "flex", gap: 8, alignItems: "center" }}><QrCode size={18} aria-hidden />Manual UPI / QR</h2>
          <span className={`chip ${st.manual.enabled ? "c-active" : "c-draft"}`}>{st.manual.enabled ? "Shown to customers" : "Off"}</span>
        </div>
        <div className="split mt12" style={{ gap: 20, alignItems: "start" }}>
          <form action={saveManual} className="col" style={{ gap: 10 }}>
            <label className="check"><input type="checkbox" name="enabled" defaultChecked={st.manual.enabled} disabled={!write} /> Enable Manual UPI recharge</label>
            <div className="field"><label htmlFor="qr">Payment QR image (PNG/JPG/WebP, max 2 MB)</label><input id="qr" name="qr" type="file" accept="image/png,image/jpeg,image/webp" className="input" disabled={!write} />{st.manual.qrKey && <label className="check tiny"><input type="checkbox" name="removeQr" value="1" disabled={!write} /> Remove current QR</label>}</div>
            <div className="grid2" style={{ gap: 10 }}>
              <div className="field"><label htmlFor="upiId">UPI ID</label><input id="upiId" name="upiId" className="input" defaultValue={st.manual.upiId} placeholder="business@bank" disabled={!write} /></div>
              <div className="field"><label htmlFor="payeeName">Beneficiary / payee name</label><input id="payeeName" name="payeeName" className="input" defaultValue={st.manual.payeeName} disabled={!write} /></div>
              <div className="field"><label htmlFor="discountPct">Manual payment discount (%)</label><input id="discountPct" name="discountPct" className="input" inputMode="decimal" defaultValue={st.manual.discountBps / 100} disabled={!write} /></div>
              <div className="field"><label htmlFor="minAmount">Minimum recharge (₹)</label><input id="minAmount" name="minAmount" className="input" inputMode="numeric" defaultValue={st.manual.minPaise / 100} disabled={!write} /></div>
              <div className="field"><label htmlFor="maxAmount">Maximum recharge (₹)</label><input id="maxAmount" name="maxAmount" className="input" inputMode="numeric" defaultValue={st.manual.maxPaise / 100} disabled={!write} /></div>
            </div>
            <div className="field"><label htmlFor="instructions">Payment instructions</label><textarea id="instructions" name="instructions" className="textarea" rows={3} defaultValue={st.manual.instructions} disabled={!write} /></div>
            <div className="field"><label htmlFor="reviewMessage">Message after submission (review time)</label><textarea id="reviewMessage" name="reviewMessage" className="textarea" rows={2} defaultValue={st.manual.reviewMessage} disabled={!write} /></div>
            {write && <button className="btn btn-orange btn-sm" style={{ alignSelf: "start" }}>Save &amp; publish</button>}
          </form>
          <div>
            <h3 className="small b">Customer preview</h3>
            <div className="card" style={{ padding: 14, textAlign: "center" }}>
              {st.manual.qrKey ? <img src="/api/portal/recharge/qr/" alt="Payment QR" style={{ width: 220, height: 220, objectFit: "contain", margin: "0 auto", display: "block" }} /> : <p className="small muted">No QR uploaded</p>}
              <p className="small" style={{ margin: "8px 0 0" }}><b>{st.manual.payeeName || "Payee name"}</b><br /><span className="mono">{st.manual.upiId || "upi@id"}</span></p>
              <p className="tiny muted" style={{ margin: "8px 0 0" }}>Example: recharge {formatINR(ex.rechargePaise)} → discount {bpsLabel(ex.discountBps)} = {formatINR(ex.discountPaise)} → pay {formatINR(ex.payablePaise)} → wallet credit {formatINR(ex.creditPaise)}</p>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
