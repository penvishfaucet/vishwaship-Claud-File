import { redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { audit } from "@/server/audit";
import { ROLE_PERMISSIONS, type StaffRole } from "@/server/auth/rbac";
import { requireStaff, revokeAllSessions } from "@/server/auth/session";
import { getDb, schema } from "@/server/db/client";
import { sha256 } from "@/server/security/crypto";
import { newId, randomToken } from "@/server/util/ids";

const ROLES: StaffRole[] = ["owner", "operations", "finance", "support", "readonly"];
/** 10-digit Indian mobile (the form Firebase OTP login returns), "" when empty, null when invalid. */
const cleanMobile = (v: FormDataEntryValue | null) => {
  const d = String(v ?? "").replace(/\D/g, "").replace(/^(91|0)(?=\d{10}$)/, "");
  return !d ? "" : /^[6-9]\d{9}$/.test(d) ? d : null;
};

async function invite(fd: FormData) {
  "use server";
  const s = await requireStaff("staff.manage");
  const email = String(fd.get("email") ?? "").trim().toLowerCase();
  const name = String(fd.get("name") ?? "").trim();
  const role = String(fd.get("role")) as StaffRole;
  const mobile = cleanMobile(fd.get("mobile"));
  if (!/^\S+@\S+\.\S+$/.test(email) || name.length < 2 || !ROLES.includes(role) || mobile === null) redirect("/admin/staff/?err=invalid");
  const db = await getDb();
  const [dup] = await db.select().from(schema.users).where(and(eq(schema.users.kind, "staff"), eq(schema.users.email, email)));
  if (dup) redirect("/admin/staff/?err=exists");
  if (mobile) {
    const [dm] = await db.select({ id: schema.users.id }).from(schema.users).where(and(eq(schema.users.kind, "staff"), eq(schema.users.mobile, mobile)));
    if (dm) redirect("/admin/staff/?err=mobile_taken");
  }
  const id = newId("usr");
  await db.insert(schema.users).values({ id, kind: "staff", name, email, mobile: mobile || null, staffRole: role, mustResetPassword: true });
  const token = randomToken(32);
  await db.insert(schema.oneTimeTokens).values({ id: sha256(token), userId: id, purpose: "staff_invite", expiresAt: new Date(Date.now() + 24 * 3600_000) });
  await audit({ actorUserId: s.userId, actorKind: "staff", action: "staff.invite", targetType: "user", targetId: id, details: { role } });
  // Email delivery is via the configured email provider; until then the owner shares the link securely.
  redirect(`/admin/staff/?invite=${encodeURIComponent(`${process.env.APP_URL ?? "http://localhost:3000"}/admin/setup-password/?token=${token}`)}`);
}

async function manage(fd: FormData) {
  "use server";
  const s = await requireStaff("staff.manage");
  const id = String(fd.get("id")), action = String(fd.get("op"));
  if (id === s.userId && action !== "revoke" && action !== "mobile") redirect("/admin/staff/?err=self");
  const db = await getDb();
  if (action === "mobile") {
    // Login with Mobile OTP on the Admin login page signs in the staff user whose number this is.
    const mobile = cleanMobile(fd.get("mobile"));
    if (mobile === null) redirect("/admin/staff/?err=mobile");
    if (mobile) {
      const [dm] = await db.select({ id: schema.users.id }).from(schema.users).where(and(eq(schema.users.kind, "staff"), eq(schema.users.mobile, mobile)));
      if (dm && dm.id !== id) redirect("/admin/staff/?err=mobile_taken");
    }
    await db.update(schema.users).set({ mobile: mobile || null, mobileVerifiedAt: null }).where(and(eq(schema.users.id, id), eq(schema.users.kind, "staff")));
    await audit({ actorUserId: s.userId, actorKind: "staff", action: "staff.mobile", targetType: "user", targetId: id, details: { set: !!mobile } });
    redirect("/admin/staff/?ok=1");
  } else if (action === "role") {
    const role = String(fd.get("role")) as StaffRole;
    if (!ROLES.includes(role)) return;
    await db.update(schema.users).set({ staffRole: role }).where(and(eq(schema.users.id, id), eq(schema.users.kind, "staff")));
    await revokeAllSessions(id);
  } else if (action === "deactivate") {
    await db.update(schema.users).set({ active: false }).where(and(eq(schema.users.id, id), eq(schema.users.kind, "staff")));
    await revokeAllSessions(id);
  } else if (action === "activate") {
    await db.update(schema.users).set({ active: true }).where(eq(schema.users.id, id));
  } else if (action === "revoke") {
    await revokeAllSessions(id);
  } else return;
  await audit({ actorUserId: s.userId, actorKind: "staff", action: `staff.${action}`, targetType: "user", targetId: id, details: { role: fd.get("role") } });
  redirect("/admin/staff/?ok=1");
}

export default async function Staff({ searchParams }: { searchParams: Promise<{ invite?: string; err?: string; ok?: string; role?: string }> }) {
  const sp = await searchParams;
  const me = await requireStaff("staff.manage");
  const db = await getDb();
  const staff = (await db.select().from(schema.users).where(eq(schema.users.kind, "staff"))).filter((u) => !sp.role || u.staffRole === sp.role);
  return (
    <>
      <div className="page-h"><h1>Staff &amp; Roles</h1></div>
      <form action={invite} className="card row wrap mb12" style={{ padding: 14, gap: 8, alignItems: "end" }}>
        <div className="field"><label htmlFor="in">Name</label><input id="in" name="name" className="input" required /></div>
        <div className="field"><label htmlFor="ie">Email</label><input id="ie" name="email" type="email" className="input" required /></div>
        <div className="field"><label htmlFor="im">Mobile (for OTP login)</label><input id="im" name="mobile" className="input" inputMode="numeric" maxLength={14} placeholder="10-digit mobile" /></div>
        <div className="field"><label htmlFor="ir">Role</label><select id="ir" name="role" className="select" defaultValue="support">{ROLES.map((r) => <option key={r}>{r}</option>)}</select></div>
        <button className="btn btn-orange">Invite Staff</button>
      </form>
      {sp.invite && <div className="note mb12" role="status"><b>Invite created.</b> Share this single-use link securely (expires in 24 h): <span className="mono small" style={{ wordBreak: "break-all" }}>{sp.invite}</span></div>}
      {sp.err && <p className="err small" role="alert">{{ invalid: "Check name, email and role.", exists: "A staff user with that email exists.", self: "You can’t change your own role or deactivate yourself.", mobile: "Enter a valid 10-digit Indian mobile number (or leave it empty).", mobile_taken: "Another staff user already has this mobile number." }[sp.err]}</p>}
      <p className="small muted mb12">Staff sign in on the Admin login page with <b>Continue with Google</b> (a Google account with the email below), <b>Login with Mobile OTP</b> (the mobile below), or email + password. No authenticator app is needed.</p>
      <div className="pills mb12"><a className={!sp.role ? "pill on" : "pill"} href="/admin/staff/">All</a>{ROLES.map((r) => <a key={r} className={sp.role === r ? "pill on" : "pill"} href={`/admin/staff/?role=${r}`}>{r}</a>)}</div>
      <div className="card p0 tbl-wrap"><table className="tbl"><thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Status</th><th>Mobile (OTP login)</th><th>Actions</th></tr></thead>
        <tbody>{staff.map((u) => (
          <tr key={u.id}>
            <td>{u.name}{u.id === me.userId ? " (you)" : ""}</td><td className="small">{u.email}</td>
            <td><form action={manage} className="row" style={{ gap: 4 }}><input type="hidden" name="id" value={u.id} /><input type="hidden" name="op" value="role" /><select aria-label={`Role for ${u.name}`} name="role" className="select" defaultValue={u.staffRole ?? "readonly"} disabled={u.id === me.userId}>{ROLES.map((r) => <option key={r}>{r}</option>)}</select>{u.id !== me.userId && <button className="btn btn-sm btn-outline">Set</button>}</form></td>
            <td><span className={`chip ${u.active ? "c-active" : "c-cancelled"}`}>{u.active ? (u.mustResetPassword ? "Invited" : "Active") : "Deactivated"}</span></td>
            <td><form action={manage} className="row" style={{ gap: 4 }}><input type="hidden" name="id" value={u.id} /><input type="hidden" name="op" value="mobile" /><input aria-label={`Mobile for ${u.name}`} name="mobile" className="input" inputMode="numeric" maxLength={14} placeholder="10-digit mobile" defaultValue={u.mobile ?? ""} style={{ width: 150 }} /><button className="btn btn-sm btn-outline">Save</button></form></td>
            <td><div className="row" style={{ gap: 4 }}>
              <form action={manage}><input type="hidden" name="id" value={u.id} /><input type="hidden" name="op" value="revoke" /><button className="btn btn-sm btn-outline">Revoke sessions</button></form>
              {u.id !== me.userId && <form action={manage}><input type="hidden" name="id" value={u.id} /><input type="hidden" name="op" value={u.active ? "deactivate" : "activate"} /><button className={u.active ? "btn btn-sm btn-red" : "btn btn-sm btn-green"}>{u.active ? "Deactivate" : "Activate"}</button></form>}
            </div></td>
          </tr>
        ))}</tbody></table></div>
      <section className="card mt16" style={{ padding: 16 }}>
        <h2 className="b small" style={{ marginTop: 0 }}>Role matrix</h2>
        <div className="tbl-wrap"><table className="tbl"><thead><tr><th>Permission</th>{ROLES.map((r) => <th key={r}>{r}</th>)}</tr></thead>
          <tbody>{ROLE_PERMISSIONS.owner.map((p) => <tr key={p}><td className="mono tiny">{p}</td>{ROLES.map((r) => <td key={r}>{ROLE_PERMISSIONS[r].includes(p) ? "✓" : ""}</td>)}</tr>)}</tbody></table></div>
      </section>
    </>
  );
}
