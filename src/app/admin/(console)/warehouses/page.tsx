import Link from "next/link";
import { revalidatePath } from "next/cache";
import { desc, eq, ilike, or } from "drizzle-orm";
import { audit } from "@/server/audit";
import { can } from "@/server/auth/rbac";
import { requireStaff } from "@/server/auth/session";
import { getDb, schema } from "@/server/db/client";
import { pickupOtpRequired, setPickupOtpRequired } from "@/server/warehouses";

async function toggleOtp(fd: FormData) {
  "use server";
  const s = await requireStaff("customers.write");
  const on = fd.get("on") === "1";
  await setPickupOtpRequired(on);
  await audit({ actorUserId: s.userId, actorKind: "staff", action: on ? "warehouse.otp_required_on" : "warehouse.otp_required_off" });
  revalidatePath("/admin/warehouses/");
}

export default async function AdminWarehouses({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const sp = await searchParams;
  const st = await requireStaff("customers.read");
  const otpOn = await pickupOtpRequired();
  const db = await getDb();
  const q = sp.q?.trim();
  const rows = await db.select({ w: schema.warehouses, org: schema.orgs }).from(schema.warehouses).innerJoin(schema.orgs, eq(schema.orgs.id, schema.warehouses.orgId))
    .where(q ? or(ilike(schema.warehouses.label, `%${q}%`), ilike(schema.warehouses.pincode, `%${q}%`), ilike(schema.warehouses.city, `%${q}%`), ilike(schema.orgs.businessName, `%${q}%`), ilike(schema.warehouses.code, `%${q}%`)) : undefined)
    .orderBy(desc(schema.warehouses.createdAt)).limit(200);
  return (
    <>
      <div className="page-h"><div><h1>Warehouses</h1><p className="small muted" style={{ margin: "4px 0 0" }}>All customers’ pickup addresses, verification and courier sync state. Deactivated addresses stay here for history.</p></div></div>
      <section className="card row between wrap mb12" style={{ padding: 12, gap: 8 }}>
        <span className="small"><b>Pickup mobile OTP verification:</b> {otpOn ? <span className="chip c-active">Required before booking</span> : <span className="chip c-draft">Off — customers can book without OTP</span>}</span>
        {can(st.role, "customers.write") && <form action={toggleOtp}><input type="hidden" name="on" value={otpOn ? "0" : "1"} /><button className="btn btn-sm btn-outline">{otpOn ? "Turn off" : "Require OTP again"}</button></form>}
      </section>
      <form className="card row wrap mb12" style={{ padding: 12, gap: 8 }}>
        <input name="q" className="input" defaultValue={q} placeholder="Customer, title, ID, city or PIN" style={{ flex: 1, minWidth: 220 }} aria-label="Search warehouses" />
        <button className="btn btn-navy">Search</button>
      </form>
      {rows.length === 0 ? <div className="card empty"><p className="muted">No warehouses found.</p></div> : (
        <div className="card p0 tbl-wrap"><table className="tbl"><thead><tr><th>ID</th><th>Customer</th><th>Title</th><th>Address</th><th>Mobile</th><th>Status</th><th>Created</th></tr></thead>
          <tbody>{rows.map(({ w, org }) => (
            <tr key={w.id}>
              <td className="small mono">{w.code ?? "—"}</td>
              <td className="small"><Link className="link-navy" href={`/admin/customers/${org.id}/`}>{org.businessName}</Link></td>
              <td className="small">{w.label}{w.isDefault && <span className="chip c-active" style={{ marginLeft: 6 }}>Default</span>}</td>
              <td className="small">{w.line1}, {w.city}, {w.state} {w.pincode}</td>
              <td className="small">{w.mobileVerifiedAt ? "Verified" : <span className="t-debit">Not verified</span>}</td>
              <td><span className={`chip ${w.active ? "c-active" : "c-draft"}`}>{w.active ? "Active" : "Inactive"}</span></td>
              <td className="small">{w.createdAt.toLocaleDateString("en-IN")}</td>
            </tr>
          ))}</tbody></table></div>
      )}
    </>
  );
}
