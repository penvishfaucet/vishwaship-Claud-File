import { desc, eq } from "drizzle-orm";
import { MapPin } from "lucide-react";
import { AddressForm } from "@/components/portal/AddressForm";
import { getDb, schema } from "@/server/db/client";
import { portalContext } from "@/server/portal/context";

export default async function AddressesPage({ searchParams }: { searchParams: Promise<{ add?: string }> }) {
  const sp = await searchParams;
  const ctx = await portalContext();
  const db = await getDb();
  const rows = await db.select().from(schema.warehouses).where(eq(schema.warehouses.orgId, ctx.org.id)).orderBy(desc(schema.warehouses.isDefault));
  const syncs = await db.select().from(schema.warehouseProviderSync);
  return (
    <>
      <div className="page-h"><h1>Pickup Addresses</h1><div className="actions"><a className="btn btn-orange" href="/portal/addresses/?add=1"><MapPin size={16} /> Add Pickup Address</a></div></div>
      {sp.add && <AddressForm />}
      {rows.length === 0 && !sp.add && <div className="card empty"><p className="muted">No pickup addresses yet.</p><a className="btn btn-orange btn-sm" href="/portal/addresses/?add=1">Add Pickup Address</a></div>}
      <div className="grid3" style={{ gap: 12 }}>
        {rows.map((w) => {
          const s = syncs.filter((x) => x.warehouseId === w.id);
          return (
            <article key={w.id} className="card" style={{ padding: 16 }}>
              <div className="row between"><b>{w.label}</b>{w.isDefault && <span className="chip c-active">Default</span>}</div>
              <p className="small" style={{ margin: "8px 0" }}>{w.contactName} · {w.mobile}<br />{w.line1}{w.line2 ? `, ${w.line2}` : ""}<br />{w.city}, {w.state} {w.pincode}</p>
              <div className="row wrap" style={{ gap: 6 }}>
                <span className={`chip ${w.mobileVerifiedAt ? "c-verified" : "c-pending"}`}>{w.mobileVerifiedAt ? "Mobile verified (OTP)" : "Mobile not verified"}</span>
                <span className={`chip ${w.active ? "c-active" : "c-cancelled"}`}>{w.active ? "Active" : "Inactive"}</span>
              </div>
              <div className="tiny muted mt8">Courier registration: {s.length ? s.map((x) => `${x.providerAccountId.replace("pa_", "")} ${x.status}`).join(", ") : "not synced yet"}</div>
              {!w.mobileVerifiedAt && <AddressForm verifyId={w.id} mobile={w.mobile} />}
            </article>
          );
        })}
      </div>
    </>
  );
}
