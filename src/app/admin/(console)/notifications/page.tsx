import { redirect } from "next/navigation";
import { desc, eq } from "drizzle-orm";
import { audit } from "@/server/audit";
import { can } from "@/server/auth/rbac";
import { requireStaff } from "@/server/auth/session";
import { getDb, schema } from "@/server/db/client";
import { getSetting } from "@/server/quotes/service";
import { creditPrice } from "@/server/notifications/credits";

async function saveCod(fd: FormData) {
  "use server";
  const s = await requireStaff("notifications.write");
  const reminderMinutes = Math.max(15, Math.min(1440, Number(fd.get("reminder"))));
  const expiryMinutes = Math.max(60, Math.min(4320, Number(fd.get("expiry"))));
  const noReply = ["hold_for_review", "cancel", "release"].includes(String(fd.get("noReply"))) ? String(fd.get("noReply")) : "hold_for_review";
  const credits = Math.max(0, Math.min(10, Number(fd.get("credits"))));
  const db = await getDb();
  const value = { reminderMinutes, expiryMinutes, noReply, credits };
  await db.insert(schema.pricingSettings).values({ key: "cod_confirmation", value }).onConflictDoUpdate({ target: schema.pricingSettings.key, set: { value, updatedAt: new Date() } });
  await audit({ actorUserId: s.userId, actorKind: "staff", action: "notifications.cod_settings", details: value });
  redirect("/admin/notifications/?ok=1");
}

async function savePrice(fd: FormData) {
  "use server";
  const s = await requireStaff("notifications.write");
  const paisePerCredit = Math.round(Math.max(0.01, Math.min(100, Number(fd.get("price")) || 0.25)) * 100);
  const value = { paisePerCredit, gstInclusive: fd.get("gstInclusive") === "on", minRupees: Math.max(1, Math.min(10_000, Math.round(Number(fd.get("min")) || 10))) };
  const costs = { sms: 1, email: 0, webhook: 0, whatsapp: Math.max(0, Math.min(10, Math.round(Number(fd.get("wa")) || 0))), cod_confirmation: Math.max(0, Math.min(10, Math.round(Number(fd.get("cod")) || 0))) };
  const db = await getDb();
  await db.insert(schema.pricingSettings).values({ key: "notification_credit_price", value }).onConflictDoUpdate({ target: schema.pricingSettings.key, set: { value, updatedAt: new Date() } });
  await db.insert(schema.pricingSettings).values({ key: "notification_credit_cost", value: costs }).onConflictDoUpdate({ target: schema.pricingSettings.key, set: { value: costs, updatedAt: new Date() } });
  // COD confirmation cost lives with the COD settings (used when sending)
  const [cur] = await db.select().from(schema.pricingSettings).where(eq(schema.pricingSettings.key, "cod_confirmation"));
  const cod = { reminderMinutes: 120, expiryMinutes: 1440, noReply: "release", ...((cur?.value as object) ?? {}), credits: costs.cod_confirmation };
  await db.insert(schema.pricingSettings).values({ key: "cod_confirmation", value: cod }).onConflictDoUpdate({ target: schema.pricingSettings.key, set: { value: cod, updatedAt: new Date() } });
  await audit({ actorUserId: s.userId, actorKind: "staff", action: "notifications.credit_price", details: { ...value, ...costs } });
  redirect("/admin/notifications/?ok=1");
}

export default async function AdminNotifications({ searchParams }: { searchParams: Promise<{ ok?: string }> }) {
  const sp = await searchParams;
  const s = await requireStaff("notifications.read");
  const cfg = await getSetting("cod_confirmation", { reminderMinutes: 120, expiryMinutes: 1440, noReply: "release", credits: 1 });
  const costs = await getSetting("notification_credit_cost", { sms: 1, whatsapp: 1, email: 0, webhook: 0, cod_confirmation: 1 });
  const price = await creditPrice();
  const db = await getDb();
  const packs = await db.select().from(schema.creditPacks);
  const exceptions = await db.select({ c: schema.codConfirmations, o: schema.orgs }).from(schema.codConfirmations).innerJoin(schema.orgs, eq(schema.orgs.id, schema.codConfirmations.orgId)).orderBy(desc(schema.codConfirmations.createdAt)).limit(50);
  const subs = await db.select({ n: schema.notificationSettings, o: schema.orgs }).from(schema.notificationSettings).innerJoin(schema.orgs, eq(schema.orgs.id, schema.notificationSettings.orgId)).where(eq(schema.notificationSettings.event, "cod_confirmation"));
  const write = can(s.role, "notifications.write");
  return (
    <>
      <div className="page-h"><h1>Notifications</h1></div>
      <div className="split" style={{ gap: 16, alignItems: "start" }}>
        <section className="card" style={{ padding: 18 }}>
          <h2 className="b" style={{ fontSize: 15, marginTop: 0 }}>COD Confirmation settings</h2>
          {sp.ok && <p className="small t-credit">Saved.</p>}
          <form action={saveCod} className="grid2" style={{ gap: 10 }}>
            <div className="field"><label htmlFor="rem">Reminder after (minutes)</label><input id="rem" name="reminder" type="number" className="input" defaultValue={cfg.value.reminderMinutes} disabled={!write} /></div>
            <div className="field"><label htmlFor="exp">Expire after (minutes)</label><input id="exp" name="expiry" type="number" className="input" defaultValue={cfg.value.expiryMinutes} disabled={!write} /></div>
            <div className="field"><label htmlFor="nr">No-reply behaviour</label><select id="nr" name="noReply" className="select" defaultValue={cfg.value.noReply} disabled={!write}><option value="hold_for_review">Hold for review</option><option value="cancel">Cancel order</option><option value="release">Release for shipping</option></select></div>
            <div className="field"><label htmlFor="cr">Credits per confirmation</label><input id="cr" name="credits" type="number" className="input" defaultValue={cfg.value.credits} disabled={!write} /></div>
            {write && <button className="btn btn-orange" style={{ alignSelf: "end" }}>Save</button>}
          </form>
        </section>
        <section className="card" style={{ padding: 18 }}>
          <h2 className="b" style={{ fontSize: 15, marginTop: 0 }}>Credit price &amp; cost per message</h2>
          <form action={savePrice} className="grid2" style={{ gap: 10 }}>
            <div className="field"><label htmlFor="pp">Price of 1 credit (₹)</label><input id="pp" name="price" type="number" step="0.01" min="0.01" className="input" defaultValue={(price.paisePerCredit / 100).toFixed(2)} disabled={!write} /></div>
            <div className="field"><label htmlFor="mn">Minimum purchase (₹)</label><input id="mn" name="min" type="number" min="1" className="input" defaultValue={price.minRupees} disabled={!write} /></div>
            <div className="field"><label htmlFor="cc">Credits per COD confirmation</label><input id="cc" name="cod" type="number" min="0" max="10" className="input" defaultValue={cfg.value.credits} disabled={!write} /></div>
            <div className="field"><label htmlFor="wc">Credits per WhatsApp update</label><input id="wc" name="wa" type="number" min="0" max="10" className="input" defaultValue={Number(costs.value.whatsapp ?? 1)} disabled={!write} /></div>
            <label className="check" style={{ gridColumn: "1 / -1" }}><input type="checkbox" name="gstInclusive" defaultChecked={price.gstInclusive} disabled={!write} /> Price includes GST (₹1 buys exactly {Math.floor(100 / price.paisePerCredit)} credits)</label>
            {write && <button className="btn btn-orange" style={{ alignSelf: "end" }}>Save price</button>}
          </form>
          <p className="small mt8">Customers buy any amount from their wallet (Billing → Notification Credits). With 0 credits no WhatsApp message is sent, so the provider charges nothing.</p>
          {packs.length > 0 && <p className="tiny muted">Fixed packs also offered: {packs.map((p) => `${p.credits} × ₹${(p.unitPricePaise / 100).toFixed(2)}`).join(" · ")} (+ GST)</p>}
          <p className="tiny muted">WhatsApp provider (WATI, AiSensy or Meta): API Keys &amp; Services. Templates: WhatsApp Ops → Template mapping.</p>
        </section>
      </div>
      <section className="card p0 mt16"><h2 className="b small card-h" style={{ margin: 0 }}>COD subscriptions</h2>
        <ul className="plain-list">{subs.length === 0 && <li className="small muted">No customer has subscribed yet.</li>}{subs.map(({ n, o }) => <li key={n.id} className="row between"><span className="small">{o.businessName}</span><span className={`chip ${n.enabled ? "c-active" : "c-draft"}`}>{n.enabled ? "Subscribed" : "Off"}</span></li>)}</ul>
      </section>
      <section className="card p0 mt16"><h2 className="b small card-h" style={{ margin: 0 }}>COD confirmation queue &amp; exceptions</h2>
        <ul className="plain-list">{exceptions.length === 0 && <li className="small muted">Empty.</li>}{exceptions.map(({ c, o }) => <li key={c.id} className="row between"><span className="small">{o.businessName} · {c.orderId}</span><span className="chip c-pending">{c.status}</span></li>)}</ul>
      </section>
    </>
  );
}
