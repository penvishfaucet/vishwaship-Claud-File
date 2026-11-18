import Link from "next/link";
import { and, desc, eq } from "drizzle-orm";
import { AdminOpForm } from "@/components/admin/AdminOpForm";
import { formatINR } from "@/lib/money";
import { can } from "@/server/auth/rbac";
import { requireStaff } from "@/server/auth/session";
import { ensureDelhiveryAccount } from "@/server/carriers/delhivery";
import { getDb, schema } from "@/server/db/client";
import { paymentConfig } from "@/server/payment-modes";
import { DELHIVERY_B2B_COMPONENT_RULES, priceQuote } from "@/server/pricing/engine";
import { adapterFor } from "@/server/providers/registry";
import { effectiveMarkup, getSetting } from "@/server/quotes/service";

const EP = "/api/admin/carriers/delhivery";
const FOD_LABEL: Record<string, [string, string]> = { pending_activation: ["Pending Delhivery Activation", "c-pending"], active: ["Active", "c-active"], not_supported: ["Not supported (B2C API)", "c-draft"] };

export default async function DelhiveryAdmin({ searchParams }: { searchParams: Promise<{ svc?: string }> }) {
  const sp = await searchParams;
  const service = sp.svc === "b2c" ? "b2c" : "b2b";
  const st = await requireStaff("integrations.read");
  const writeInt = can(st.role, "integrations.write"), writePrice = can(st.role, "pricing.write"), fin = can(st.role, "finance.adjust");
  const acct = await ensureDelhiveryAccount(service);
  const cfg = (acct.configPublic ?? {}) as Record<string, unknown>;
  const pay = paymentConfig(acct, adapterFor(acct));
  const hints = (acct.secretsHint ?? {}) as Record<string, string>;
  const markup = await effectiveMarkup(acct.adapter, service === "b2b" ? "B2B" : "B2C", null);
  const gst = (await getSetting<number>("gst_bps", 1800)).value;
  const example = priceQuote({ provider: acct.adapter, carrierCode: "delhivery", carrierName: "Delhivery", serviceName: "example", mode: service === "b2b" ? "B2B" : "B2C", components: [{ code: "freight", label: "Base freight", amount: 100_000 }], taxInclusive: false, taxRateBps: 1800, chargeableWeightGrams: 20_000 }, markup, { gstBps: gst, componentRules: service === "b2b" ? DELHIVERY_B2B_COMPONENT_RULES : undefined });
  const rc = (cfg.rateCard ?? {}) as Record<string, number>;
  const bill = (cfg.billingAddress ?? {}) as Record<string, string>;
  const db = await getDb();
  const ships = await db.select({ s: schema.shipments, o: schema.orders, org: schema.orgs.businessName }).from(schema.shipments).innerJoin(schema.orders, eq(schema.orders.id, schema.shipments.orderId)).innerJoin(schema.orgs, eq(schema.orgs.id, schema.shipments.orgId))
    .where(and(eq(schema.shipments.providerAccountId, acct.id))).orderBy(desc(schema.shipments.createdAt)).limit(30);
  const syncs = await db.select({ w: schema.warehouseProviderSync, name: schema.warehouses.label }).from(schema.warehouseProviderSync).innerJoin(schema.warehouses, eq(schema.warehouses.id, schema.warehouseProviderSync.warehouseId)).where(eq(schema.warehouseProviderSync.providerAccountId, acct.id)).limit(30);
  const [fodLabel, fodChip] = FOD_LABEL[pay.fodStatus];
  const Chip = ({ ok, on, off }: { ok: boolean; on: string; off: string }) => <span className={`chip ${ok ? "c-active" : "c-draft"}`}>{ok ? on : off}</span>;
  return (
    <>
      <div className="page-h">
        <div><p className="small muted" style={{ margin: 0 }}><Link className="link-navy" href="/admin/carriers/">Courier Integrations</Link> / Delhivery Direct</p><h1>Delhivery Direct {service.toUpperCase()}</h1>
          <p className="small muted" style={{ margin: "4px 0 0" }}>B2B and B2C are separate Delhivery accounts with separate credentials, payment modes and pricing.</p></div>
      </div>
      <nav className="tabs"><Link href="/admin/carriers/delhivery/?svc=b2b" className={service === "b2b" ? "on" : ""}>B2B (LTL / freight)</Link><Link href="/admin/carriers/delhivery/?svc=b2c" className={service === "b2c" ? "on" : ""}>B2C (parcel)</Link></nav>

      <div className="split" style={{ gap: 16, alignItems: "start" }}>
        <section className="card" style={{ padding: 16 }}>
          <h2 className="b" style={{ fontSize: 15, marginTop: 0 }}>Connection</h2>
          <dl className="kv-list">
            <dt>Service</dt><dd><Chip ok={acct.status === "enabled"} on="Enabled for customers" off="Disabled" /></dd>
            <dt>Environment</dt><dd>{acct.mode === "live" ? "Production" : "Test / staging"} · <span className="mono tiny">{service === "b2b" ? (acct.mode === "live" ? "ltl-clients-api.delhivery.com" : "ltl-clients-api-dev.delhivery.com") : (acct.mode === "live" ? "track.delhivery.com" : "staging-express.delhivery.com")}</span></dd>
            <dt>Credentials</dt><dd className="mono small">{Object.keys(hints).length ? Object.entries(hints).map(([k, v]) => `${k}: ${v}`).join(" · ") : "Not set"}</dd>
            <dt>Last test</dt><dd className="small">{acct.lastTestAt ? <><span className={`chip ${acct.lastTestOk ? "c-active" : "c-failed"}`}>{acct.lastTestOk ? "Passed" : "Failed"}</span> {acct.lastTestMessage} · {acct.lastTestAt.toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}</> : "Never"}</dd>
          </dl>
          <AdminOpForm endpoint={EP} op="credentials" submit="Save credentials" disabled={!writeInt} extra={{ service }} fields={[
            { name: "mode", label: "Environment", type: "select", value: acct.mode, options: [["test", "Test / staging"], ["live", "Production"]] },
            ...(service === "b2b" ? [{ name: "username", label: "B2B API username" }, { name: "password", label: "B2B API password" }] : [{ name: "apiToken", label: "B2C API token", wide: true }]),
          ]} />
          <div className="row wrap mt8" style={{ gap: 8 }}>
            <AdminOpForm endpoint={EP} op="test" submit="Test connection" disabled={!writeInt} extra={{ service }} fields={[]} />
            {Object.keys(hints).length > 0 && <AdminOpForm endpoint={EP} op="clear" submit="Remove credentials" disabled={!writeInt} extra={{ service }} fields={[]} confirmText="Remove the saved Delhivery credentials and disable this service?" />}
            <AdminOpForm endpoint={EP} op="status" submit={acct.status === "enabled" ? "Disable service" : "Enable service"} disabled={!writeInt} extra={{ service, status: acct.status === "enabled" ? "disabled" : "enabled" }} fields={[]} confirmText={acct.status === "enabled" ? "Customers will stop seeing Delhivery rates. Continue?" : undefined} />
          </div>
          <p className="tiny muted mt8">Secrets are encrypted on the server and never shown again. Enabling requires a passed connection test.</p>
        </section>

        <section className="card" style={{ padding: 16 }}>
          <h2 className="b" style={{ fontSize: 15, marginTop: 0 }}>Payment modes</h2>
          <table className="tbl"><tbody>
            <tr><td className="small b">Prepaid</td><td><Chip ok={pay.prepaid} on="Enabled" off="Off" /></td><td className="tiny muted">Sender pays freight from the wallet</td></tr>
            <tr><td className="small b">COD</td><td><Chip ok={pay.cod} on="Enabled" off="Off" /></td><td className="tiny muted">Receiver pays the goods value; freight billed to sender</td></tr>
            <tr><td className="small b">FOD</td><td><span className={`chip ${pay.fodStatus === "active" && pay.fod ? "c-active" : fodChip}`}>{pay.fodStatus === "active" ? (pay.fod ? "Active" : "Activated, switched off") : fodLabel}</span></td><td className="tiny muted">Receiver pays freight at delivery · basis: {pay.fodBasis === "carrier_freight" ? "Delhivery freight from receiver, margin from sender" : "full Vishwaship rate from receiver"}</td></tr>
          </tbody></table>
          <AdminOpForm endpoint={EP} op="payments" submit="Save payment modes" disabled={!writeInt} extra={{ service }} fields={[
            { name: "prepaid", label: "Prepaid", type: "checkbox", value: pay.prepaid }, { name: "cod", label: "COD", type: "checkbox", value: pay.cod },
            ...(service === "b2b" ? [
              { name: "fod", label: "FOD for customers", type: "checkbox" as const, value: pay.fod },
              { name: "fodStatus", label: "Delhivery FOD activation", type: "select" as const, value: pay.fodStatus === "not_supported" ? "pending_activation" : pay.fodStatus, options: [["pending_activation", "Pending Delhivery Activation"], ["active", "Activated & collection flow verified"]] as Array<[string, string]> },
              { name: "fodBasis", label: "FOD collection basis", type: "select" as const, value: pay.fodBasis, options: [["carrier_freight", "Delhivery collects its freight; sender pays Vishwaship margin"], ["vishwaship_rate", "Delhivery collects full Vishwaship rate (needs written confirmation)"]] as Array<[string, string]> },
            ] : []),
          ]} />
          {service === "b2b" && pay.fodStatus !== "active" && <p className="small note mt8"><b>To activate FOD</b>, ask your Delhivery B2B account manager to: (1) enable <code>freight_mode = &quot;fod&quot;</code> on your client account for the lanes you need; (2) confirm in writing who collects the FOD amount, whether it can include Vishwaship’s markup, and how/when it is settled to you; (3) share the FOD charge (if any). Then set “Activated” here and switch FOD on.</p>}
          {service === "b2c" && <p className="small note mt8">Delhivery’s B2C API documents only Prepaid, COD, Pickup (reverse) and REPL. FOD stays unavailable for B2C unless Delhivery provides an account-specific method in writing.</p>}
        </section>
      </div>

      <div className="split mt16" style={{ gap: 16, alignItems: "start" }}>
        <section className="card" style={{ padding: 16 }}>
          <h2 className="b" style={{ fontSize: 15, marginTop: 0 }}>Pricing</h2>
          <p className="small">{service === "b2b" ? "B2B Freight Markup (%)" : "B2C markup (%)"}: <b>{markup.bps / 100}%</b> {markup.ruleVersion ? <span className="tiny muted">version {markup.ruleVersion}</span> : <span className="tiny muted">default</span>}</p>
          <p className="small muted">Example: base freight ₹1,000 → Vishwaship {service === "b2b" ? "freight" : "price"} <b>{formatINR(example.sellingSubtotal)}</b> + GST {formatINR(example.gst)} = {formatINR(example.total)}.{service === "b2b" ? " Only the base freight is marked up; fuel, docket, ROV, ODA, COD and FOD charges pass through at cost." : ""}</p>
          <AdminOpForm endpoint={EP} op="markup" submit="Save markup" disabled={!writePrice} extra={{ service }} confirmText="New quotes will use this markup immediately. Booked shipments keep their confirmed price. Continue?" fields={[{ name: "pct", label: service === "b2b" ? "B2B Freight Markup (%)" : "B2C markup (%)", type: "number", step: "0.01", value: markup.bps / 100 }]} />
          <p className="tiny muted mt8">{service === "b2b" ? "Independent of B2C pricing." : "Independent of the B2B 25% default."} Per-customer overrides: Customers → customer → Pricing.</p>
        </section>

        <section className="card" style={{ padding: 16 }}>
          <h2 className="b" style={{ fontSize: 15, marginTop: 0 }}>Rate source</h2>
          <AdminOpForm endpoint={EP} op="rates" submit="Save rate settings" disabled={!writePrice} extra={{ service }} fields={[
            { name: "rateSource", label: "Quote from", type: "select", value: String(cfg.rateSource ?? "api"), options: [["api", service === "b2b" ? "Delhivery Freight Estimator API" : "Delhivery Shipping Cost API"], ["rate_card", "Approved contract rate card (below)"]] },
            ...(service === "b2c" ? [{ name: "shippingMode", label: "B2C mode", type: "select" as const, value: String(cfg.shippingMode ?? "S"), options: [["S", "Surface"], ["E", "Express"]] as Array<[string, string]> }] : []),
            { name: "volDivisor", label: "Volumetric divisor", type: "number", value: Number(cfg.volDivisor ?? 5000) },
            { name: "pickupStartTime", label: "Pickup start time", value: String(cfg.pickupStartTime ?? "11:00:00") },
            ...(service === "b2b" ? [
              { name: "rovInsurance", label: "ROV carrier risk", type: "checkbox" as const, value: !!cfg.rovInsurance },
              { name: "perKg", label: "Card: ₹ per kg", type: "number" as const, step: "0.01", value: (rc.perKgPaise ?? 0) / 100 }, { name: "minKg", label: "Card: min kg", type: "number" as const, value: rc.minKg ?? 20 },
              { name: "docket", label: "Card: docket ₹", type: "number" as const, step: "0.01", value: (rc.docketPaise ?? 0) / 100 }, { name: "fuelPct", label: "Card: fuel %", type: "number" as const, step: "0.01", value: rc.fuelPct ?? 0 },
              { name: "codFee", label: "Card: COD min ₹", type: "number" as const, step: "0.01", value: (rc.codFeePaise ?? 0) / 100 }, { name: "codPct", label: "Card: COD %", type: "number" as const, step: "0.01", value: rc.codPct ?? 0 },
              { name: "fodFee", label: "Card: FOD charge ₹", type: "number" as const, step: "0.01", value: (rc.fodFeePaise ?? 0) / 100 },
            ] : [
              { name: "first500", label: "Card: first 500 g ₹", type: "number" as const, step: "0.01", value: (rc.first500Paise ?? 0) / 100 }, { name: "addl500", label: "Card: each extra 500 g ₹", type: "number" as const, step: "0.01", value: (rc.addl500Paise ?? 0) / 100 },
              { name: "codFee", label: "Card: COD min ₹", type: "number" as const, step: "0.01", value: (rc.codFeePaise ?? 0) / 100 }, { name: "codPct", label: "Card: COD %", type: "number" as const, step: "0.01", value: rc.codPct ?? 0 },
            ]),
          ]} />
          <p className="tiny muted mt8">Every quote records its pricing source (API or contract card) for audit.</p>
        </section>
      </div>

      {service === "b2b" && (
        <section className="card mt16" style={{ padding: 16 }}>
          <h2 className="b" style={{ fontSize: 15, marginTop: 0 }}>Billing address sent with manifests</h2>
          <p className="small muted">Delhivery requires a billing address (with GST or PAN) on B2B manifests for retail accounts.</p>
          <AdminOpForm endpoint={EP} op="billing" submit="Save billing address" disabled={!writeInt} extra={{ service: "b2b" }} fields={[
            { name: "name", label: "Contact name", value: bill.name ?? "" }, { name: "company", label: "Company", value: bill.company ?? "" }, { name: "phone", label: "Phone", value: bill.phone ?? "" },
            { name: "address", label: "Address", value: bill.address ?? "", wide: true }, { name: "city", label: "City", value: bill.city ?? "" }, { name: "state", label: "State", value: bill.state ?? "" }, { name: "pin", label: "PIN", value: bill.pin ?? "" },
            { name: "gst_number", label: "GST number", value: bill.gst_number ?? "" }, { name: "pan_number", label: "PAN", value: bill.pan_number ?? "" },
          ]} />
        </section>
      )}

      <section className="card p0 mt16">
        <h2 className="b small card-h" style={{ margin: 0 }}>Recent Delhivery {service.toUpperCase()} shipments &amp; reconciliation</h2>
        {ships.length === 0 ? <p className="small muted" style={{ padding: 16 }}>None yet.</p> : (
          <div className="tbl-wrap"><table className="tbl"><thead><tr><th>Booked</th><th>Customer</th><th>Order</th><th>LR / AWB</th><th>Mode</th><th>Status</th><th style={{ textAlign: "right" }}>Carrier cost</th><th style={{ textAlign: "right" }}>Sender charged</th><th style={{ textAlign: "right" }}>Receiver pays</th><th>FOD</th></tr></thead>
            <tbody>{ships.map(({ s, o, org }) => (
              <tr key={s.id}><td className="small">{s.createdAt.toLocaleDateString("en-IN")}</td><td className="small">{org}</td><td className="small">{o.orderNumber}</td><td className="mono tiny">{s.lrNumber ?? s.awb ?? <span className="chip c-pending">Pending</span>}</td><td className="small">{o.paymentType.toUpperCase()}</td><td className="small">{s.bookingStatus === "pending" ? "Awaiting Delhivery" : s.status.replace(/_/g, " ")}</td>
                <td style={{ textAlign: "right" }} className="small">{formatINR(s.costPaise)}</td><td style={{ textAlign: "right" }} className="small">{formatINR(s.sellPaise)}</td><td style={{ textAlign: "right" }} className="small">{s.receiverFreightPaise ? formatINR(s.receiverFreightPaise) : o.paymentType === "cod" ? `COD ${formatINR(o.codAmountPaise)}` : "—"}</td>
                <td>{s.freightPayer === "receiver" ? <AdminOpForm endpoint={EP} op="fod_status" submit="Set" disabled={!fin} extra={{ service, shipmentId: s.id }} fields={[{ name: "status", label: "", type: "select", value: s.fodStatus ?? "pending_collection", options: [["pending_collection", "Pending collection"], ["collected", "Collected by Delhivery"], ["settled", "Settled"], ["disputed", "Disputed"]] }]} /> : <span className="tiny muted">—</span>}</td></tr>
            ))}</tbody></table></div>
        )}
      </section>

      {syncs.length > 0 && <section className="card p0 mt16"><h2 className="b small card-h" style={{ margin: 0 }}>Registered pickup warehouses</h2><ul className="plain-list">{syncs.map(({ w, name }) => <li key={w.id} className="row between small"><span>{name} → <span className="mono">{w.providerWarehouseRef ?? "—"}</span></span><span className={`chip ${w.status === "registered" ? "c-active" : "c-failed"}`}>{w.status}{w.lastError ? ` · ${w.lastError}` : ""}</span></li>)}</ul></section>}

      <section className="card mt16" style={{ padding: 16 }}>
        <h2 className="b" style={{ fontSize: 15, marginTop: 0 }}>Setup checklist</h2>
        <ol className="small" style={{ paddingLeft: 18, margin: 0 }}>
          {service === "b2b" ? <>
            <li>From your Delhivery B2B account manager: API <b>username + password</b> (test and production), confirmation that Freight Estimator, Manifest, Pickup Request, Label, Track and Cancel APIs are enabled for your client.</li>
            <li>Ask whether your account is a retail (B2BR) client — if so <code>freight_mode</code>, <code>billing_address</code>, <code>fm_pickup</code>, <code>rov_insurance</code> and invoice copies are mandatory on manifests.</li>
            <li>Enter credentials above → Test connection → set the billing address → Enable service.</li>
            <li>For FOD: complete the activation request above. For status push, send Delhivery the webhook form (lastmile-integration@delhivery.com); until then Vishwaship polls tracking every 30 minutes.</li>
          </> : <>
            <li>From Delhivery ONE (Settings → API setup): the B2C <b>API token</b> for staging and production.</li>
            <li>Enter the token above → Test connection → Enable service. Pickup warehouses are registered automatically on first booking (named <code>VS-&lt;warehouse ID&gt;</code>).</li>
            <li>Choose Surface or Express and keep Prepaid / COD switched to what your Delhivery contract allows.</li>
          </>}
        </ol>
      </section>
    </>
  );
}
