import Link from "next/link";
import { and, eq, inArray, isNotNull, ne } from "drizzle-orm";
import { AdminOpForm } from "@/components/admin/AdminOpForm";
import { carrierLogo } from "@/lib/site";
import { can } from "@/server/auth/rbac";
import { requireStaff } from "@/server/auth/session";
import { ensureDelhiveryAccount } from "@/server/carriers/delhivery";
import { CAP_LABEL, CARRIER_SPECS, REQUIRED_CAPS, partnerCodeFor } from "@/server/carriers/specs";
import { SETUP_LABEL, isVerified, setupState } from "@/server/carriers/verification";
import { getDb, schema } from "@/server/db/client";

const EP = "/api/admin/carriers/accounts";
const LOGO: Record<string, string> = { shipmozo: "", delhivery_b2c: "delhivery", delhivery_b2b: "delhivery", ekart: "ekart", tci: "tci-express", bluedart: "blue-dart", shiporax: "", shiprocket: "" };

export default async function CourierIntegrations() {
  const st = await requireStaff("integrations.read");
  const write = can(st.role, "integrations.write");
  await ensureDelhiveryAccount("b2c");
  await ensureDelhiveryAccount("b2b");
  const db = await getDb();
  const accounts = (await db.select().from(schema.providerAccounts).where(and(eq(schema.providerAccounts.category, "shipping"), ne(schema.providerAccounts.status, "archived"))))
    .filter((a) => a.adapter !== "demo").sort((a, b) => a.label.localeCompare(b.label));
  const syncErr = accounts.length ? await db.select({ acct: schema.shipments.providerAccountId }).from(schema.shipments).where(and(inArray(schema.shipments.providerAccountId, accounts.map((a) => a.id)), isNotNull(schema.shipments.lastSyncError))) : [];
  const stuck = accounts.length ? await db.select({ acct: schema.shipments.providerAccountId }).from(schema.shipments).where(and(inArray(schema.shipments.providerAccountId, accounts.map((a) => a.id)), eq(schema.shipments.bookingStatus, "pending"))) : [];
  const count = (rows: Array<{ acct: string }>, id: string) => rows.filter((r) => r.acct === id).length;
  const missingServices = Object.values(CARRIER_SPECS).flatMap((sp) => sp.services.map((m) => ({ sp, m }))).filter(({ sp, m }) =>
    !accounts.some((a) => a.adapter === sp.adapter && (sp.adapter.startsWith("delhivery_") || (a.configPublic as Record<string, unknown>)?.service === m)));

  return (
    <>
      <div className="page-h">
        <div><h1>Courier Integrations</h1>
          <p className="small muted" style={{ margin: "4px 0 0" }}>Each row is one provider account and service. B2B and B2C are verified and switched on separately. An account takes customer bookings only after authentication, rates, booking, label and tracking are verified in its current environment.</p></div>
      </div>

      <section className="card p0">
        <div className="tbl-wrap"><table className="tbl">
          <thead><tr><th>Provider / service</th><th>Route</th><th>Environment</th><th>Status</th><th>Verified</th><th>Last success</th><th>Problems</th><th /></tr></thead>
          <tbody>{accounts.map((a) => {
            const cfg = (a.configPublic ?? {}) as Record<string, unknown>;
            const spec = CARRIER_SPECS[a.adapter];
            const service = (cfg.service as string) ?? (a.adapter === "delhivery_b2b" ? "B2B" : a.adapter === "delhivery_b2c" ? "B2C" : "—");
            const state = setupState(a);
            const [label, chip] = SETUP_LABEL[state];
            const logo = carrierLogo(String(cfg.logoCode ?? LOGO[a.adapter] ?? ""));
            const done = REQUIRED_CAPS.filter((c) => isVerified(a, c)).length;
            const probs = count(syncErr, a.id) + count(stuck, a.id);
            return (
              <tr key={a.id}>
                <td><span className="row" style={{ gap: 8, alignItems: "center" }}>{logo ? <img src={logo} alt="" style={{ height: 22, width: 44, objectFit: "contain" }} /> : <span className="chip c-draft" style={{ minWidth: 44, textAlign: "center" }}>{String(cfg.brandName ?? a.label).slice(0, 2).toUpperCase()}</span>}<span><b className="small">{String(cfg.brandName ?? spec?.name ?? a.label)}</b> <span className="chip c-draft">{service}</span>{partnerCodeFor(a.adapter, cfg) ? <span className="tiny mono muted" style={{ display: "block" }}>{partnerCodeFor(a.adapter, cfg)}</span> : null}</span></span></td>
                <td className="small">{(spec?.route ?? cfg.route) === "aggregator" ? `Aggregator (${spec?.name ?? "custom"})` : "Direct"}</td>
                <td className="small">{a.mode === "live" ? "Production" : "Sandbox"}</td>
                <td><span className={`chip ${chip}`}>{label}</span></td>
                <td className="small" title={REQUIRED_CAPS.map((c) => `${CAP_LABEL[c]}: ${isVerified(a, c) ? "verified" : "pending"}`).join("\n")}>{done}/{REQUIRED_CAPS.length}</td>
                <td className="small">{a.lastSuccessAt ? a.lastSuccessAt.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "—"}</td>
                <td>{probs ? <span className="chip c-failed">{probs}</span> : <span className="tiny muted">—</span>}</td>
                <td><Link className="btn btn-sm btn-outline" href={`/admin/carriers/${a.id}/`}>Manage</Link></td>
              </tr>
            );
          })}</tbody>
        </table></div>
      </section>

      {write && (
        <section className="card mt16" style={{ padding: 16 }}>
          <h2 className="b" style={{ fontSize: 15, marginTop: 0 }}>Add an integration</h2>
          <p className="small muted">Pick a provider and service. Providers marked “documentation required” can be set up and their credentials stored now; they are activated only after their adapter is built from the provider’s API document and verified.</p>
          <AdminOpForm endpoint={EP} op="create" submit="Add" fields={[
            { name: "adapter", label: "Provider", type: "select", value: missingServices[0]?.sp.adapter ?? "shipmozo", options: [
              ...Object.values(CARRIER_SPECS).filter((s) => !s.adapter.startsWith("delhivery_")).map((s) => [s.adapter, `${s.name}${s.build === "documentation_required" ? " — documentation required" : ""}`] as [string, string]),
              ["custom", "Other courier partner (new API — stays in setup until its adapter is built)"],
            ] },
            { name: "service", label: "Service", type: "select", value: "B2C", options: [["B2C", "B2C (parcel)"], ["B2B", "B2B (cargo / multi-carton)"]] },
            { name: "brandName", label: "Name shown in Admin (optional)", placeholder: "e.g. Shipmozo B2B" },
            { name: "logoCode", label: "Logo code (optional)", placeholder: "e.g. ekart" },
          ]} />
          {missingServices.length > 0 && <p className="tiny muted mt8">Not added yet: {missingServices.map(({ sp, m }) => `${sp.name} ${m}`).join(" · ")}</p>}
          <p className="tiny muted">A future partner that speaks the Shipmozo API (same hosts) can be added as another Shipmozo account with its own name and keys.</p>
        </section>
      )}
    </>
  );
}
