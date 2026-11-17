import Link from "next/link";
import { eq, isNotNull } from "drizzle-orm";
import { AdminOpForm } from "@/components/admin/AdminOpForm";
import { CourierAvailability } from "@/components/admin/CourierAvailability";
import { CARRIERS } from "@/lib/site";
import { can } from "@/server/auth/rbac";
import { requireStaff } from "@/server/auth/session";
import { courierAvailability } from "@/server/couriers";
import { getDb, schema } from "@/server/db/client";
import { DEFAULT_ZONES } from "@/server/price-list";
import { getSetting } from "@/server/quotes/service";

export default async function AdminCouriers() {
  const s = await requireStaff("pricing.read");
  const write = can(s.role, "pricing.write");
  const db = await getDb();
  const avail = await courierAvailability();
  const seen = await db.selectDistinct({ code: schema.quotes.carrierCode }).from(schema.quotes).where(isNotNull(schema.quotes.carrierCode));
  const prefs = await db.select().from(schema.orgSettings).where(eq(schema.orgSettings.key, "courier_prefs"));
  const optedOut = (code: string) => prefs.filter((p) => ((p.value as { disabled?: string[] }).disabled ?? []).includes(code)).length;
  const codes = [...new Set([...CARRIERS.map((c) => c.code), ...seen.map((x) => x.code)])];
  const couriers = codes.map((code) => ({ code, name: CARRIERS.find((c) => c.code === code)?.name ?? code, offered: seen.some((x) => x.code === code), optedOut: optedOut(code) })).sort((a, b) => Number(b.offered) - Number(a.offered) || a.name.localeCompare(b.name));
  const zones = (await getSetting("price_list_zones", DEFAULT_ZONES)).value;
  return (
    <>
      <div className="page-h"><div><h1>Couriers &amp; Rate Cards</h1><p className="small muted" style={{ margin: "4px 0 0" }}>Courier availability for all customers, sample routes for customers’ Shipment Price List, and where margins are set.</p></div></div>
      <section className="card p0 mb16"><h2 className="b small card-h" style={{ margin: 0 }}>Courier availability</h2><CourierAvailability couriers={couriers} disabled={avail.disabled} write={write} /></section>
      <section className="card mb16" style={{ padding: 16 }}>
        <h2 className="b" style={{ fontSize: 15, marginTop: 0 }}>Price list zones</h2>
        <p className="small muted">Each zone is priced to a sample delivery PIN (empty = the customer’s own pickup PIN). Customers see their own personalised selling rates per zone and weight slab.</p>
        {zones.map((z, i) => (
          <AdminOpForm key={z.zone} op="price_list_zones" submit={`Save zone ${z.zone}`} disabled={!write} extra={{ zones: zones.map((x, j) => (j === i ? undefined : x)).filter(Boolean) }}
            fields={[{ name: "zone", label: "Zone", type: "hidden", value: z.zone }, { name: "label", label: `Zone ${z.zone} name`, value: z.label }, { name: "pin", label: "Sample PIN", value: z.pin, placeholder: "pickup PIN" }]} />
        ))}
        <p className="tiny muted">Saving one zone keeps the others. Customers’ price lists refresh within 12 hours (or immediately when they press Refresh).</p>
      </section>
      <section className="card" style={{ padding: 16 }}>
        <h2 className="b" style={{ fontSize: 15, marginTop: 0 }}>Margins &amp; personalised rates</h2>
        <p className="small">Global margin (B2B and B2C) and component rules: <Link className="link" href="/admin/pricing/">Pricing</Link>. Personalised margin for one customer: Customers → customer → <b>Pricing</b> tab. Notification credit prices: <Link className="link" href="/admin/notifications/">Notifications</Link>.</p>
      </section>
    </>
  );
}
