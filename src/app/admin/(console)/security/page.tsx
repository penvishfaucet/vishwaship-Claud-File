import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, count, eq, gte, like } from "drizzle-orm";
import { audit } from "@/server/audit";
import { can } from "@/server/auth/rbac";
import { requireStaff } from "@/server/auth/session";
import { getDb, schema } from "@/server/db/client";
import { OTP_GUARD_DEFAULTS, type OtpGuardConfig, otpGuardConfig } from "@/server/security/otp-guard";

export const metadata = { title: "Security — Admin" };
export const dynamic = "force-dynamic";

const FIELDS: Array<[keyof OtpGuardConfig, string, string]> = [
  ["perMobile15m", "Per mobile number, every 15 minutes", "3"],
  ["perMobileDay", "Per mobile number, per day", "8"],
  ["perIpHour", "Per network (IP), per hour", "10"],
  ["perIpDay", "Per network (IP), per day", "30"],
  ["siteDay", "Whole website, per day (Firebase bill cap)", "500"],
];

async function save(fd: FormData) {
  "use server";
  const s = await requireStaff("integrations.write");
  const next = {} as OtpGuardConfig;
  for (const [k] of FIELDS) {
    const v = Number(fd.get(k));
    if (!Number.isInteger(v) || v < 1 || v > 100_000) redirect("/admin/security/?err=1");
    next[k] = v;
  }
  const db = await getDb();
  await db.insert(schema.pricingSettings).values({ key: "otp_guard", value: next })
    .onConflictDoUpdate({ target: schema.pricingSettings.key, set: { value: next, updatedAt: new Date() } });
  await audit({ actorUserId: s.userId, actorKind: "staff", action: "security.otp_guard_updated", details: next });
  revalidatePath("/admin/security/");
  redirect("/admin/security/?saved=1");
}

export default async function SecurityPage({ searchParams }: { searchParams: Promise<{ saved?: string; err?: string }> }) {
  const sp = await searchParams;
  const s = await requireStaff("integrations.read");
  const write = can(s.role, "integrations.write");
  const cfg = await otpGuardConfig();
  const db = await getDb();
  const today = new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
  const [site] = await db.select({ c: schema.rateLimits.count }).from(schema.rateLimits).where(eq(schema.rateLimits.key, `otp:site:${today}`));
  const since = new Date(Date.now() - 86_400_000);
  const [blocked] = await db.select({ n: count() }).from(schema.auditLog).where(and(eq(schema.auditLog.action, "otp.blocked"), gte(schema.auditLog.createdAt, since)));
  const [failedLogins] = await db.select({ n: count() }).from(schema.auditLog).where(and(like(schema.auditLog.action, "%login_failed%"), gte(schema.auditLog.createdAt, since)));
  const h = await headers();
  const ipHeaders = ["x-forwarded-for", "x-real-ip", "cf-connecting-ip", "true-client-ip", "x-client-ip", "forwarded", "x-vercel-forwarded-for"].map((k) => [k, h.get(k) ?? "—"]);

  return (
    <>
      <div className="page-h"><div><h1>Security</h1><p className="small muted" style={{ margin: "4px 0 0" }}>OTP limits that protect the Firebase SMS bill, and checks for login abuse.</p></div></div>

      <div className="grid3 mb16" style={{ gap: 12 }}>
        <div className="card" style={{ padding: 16 }}><div className="small muted">OTP SMS allowed today</div><div className="b" style={{ fontSize: 24 }}>{site?.c ?? 0} <span className="small muted">/ {cfg.siteDay}</span></div></div>
        <div className="card" style={{ padding: 16 }}><div className="small muted">OTP requests blocked (24 h)</div><div className="b" style={{ fontSize: 24 }}>{blocked?.n ?? 0}</div></div>
        <div className="card" style={{ padding: 16 }}><div className="small muted">Failed logins (24 h)</div><div className="b" style={{ fontSize: 24 }}>{failedLogins?.n ?? 0}</div></div>
      </div>

      <section className="card mb16" style={{ padding: 16 }}>
        <h2 className="b" style={{ fontSize: 15, margin: "0 0 6px" }}>OTP limits</h2>
        <p className="small muted" style={{ margin: "0 0 12px", maxWidth: 820 }}>Checked on the server before Firebase sends any SMS (login, signup, store buyer login, pickup number check). Every OTP also needs the visible “I’m not a robot” check. When the daily site cap is reached, mobile OTP pauses and people can still log in with email.</p>
        <form action={save} className="row wrap" style={{ gap: 12, alignItems: "end" }}>
          {FIELDS.map(([k, label]) => (
            <div key={k} className="field"><label htmlFor={`og-${k}`}>{label}</label><input id={`og-${k}`} name={k} type="number" min="1" className="input" defaultValue={cfg[k] ?? OTP_GUARD_DEFAULTS[k]} style={{ width: 120 }} disabled={!write} /></div>
          ))}
          {write && <button className="btn btn-orange btn-sm">Save</button>}
        </form>
        {sp.saved && <p className="small t-credit mt8" role="status">Saved.</p>}
        {sp.err && <p className="small err mt8" role="alert">Every limit must be a whole number from 1.</p>}
      </section>

      <section className="card mb16" style={{ padding: 16 }}>
        <h2 className="b" style={{ fontSize: 15, margin: "0 0 6px" }}>Firebase console — do these once (owner)</h2>
        <ol className="small" style={{ margin: 0, paddingLeft: 18, lineHeight: 1.8 }}>
          <li>Authentication → Settings → <b>SMS region policy</b> → Allow → <b>India only</b>.</li>
          <li>Google Cloud → Billing → <b>Budgets &amp; alerts</b>: a monthly budget with email alerts at 50% / 90% / 100%.</li>
          <li>Authentication → Settings → <b>Authorized domains</b>: keep only vishwaship.in, vishwaship.com and the Firebase defaults.</li>
          <li>Optional, strongest: enable <b>reCAPTCHA SMS defense</b> (Authentication → Settings → reCAPTCHA) to block SMS toll fraud.</li>
        </ol>
      </section>

      <section className="card" style={{ padding: 16 }}>
        <h2 className="b" style={{ fontSize: 15, margin: "0 0 6px" }}>Visitor IP check (for the developer)</h2>
        <p className="small muted" style={{ margin: "0 0 8px" }}>How the hosting passes your IP to the app. Used to make IP-based limits impossible to fake.</p>
        <div className="tbl-wrap"><table className="tbl"><tbody>{ipHeaders.map(([k, v]) => <tr key={k}><td className="b small">{k}</td><td className="small" style={{ fontFamily: "var(--mono)", wordBreak: "break-all" }}>{v}</td></tr>)}</tbody></table></div>
      </section>
    </>
  );
}
