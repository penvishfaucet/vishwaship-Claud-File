import Link from "next/link";
import { notFound } from "next/navigation";
import { and, desc, eq, inArray, isNotNull, ne, or } from "drizzle-orm";
import { AdminOpForm } from "@/components/admin/AdminOpForm";
import { formatINR } from "@/lib/money";
import { carrierLogo } from "@/lib/site";
import { can } from "@/server/auth/rbac";
import { requireStaff } from "@/server/auth/session";
import { CAP_LABEL, CARRIER_SPECS, REQUIRED_CAPS, SHOWN_CAPS, partnerCodeFor } from "@/server/carriers/specs";
import { SETUP_LABEL, capRecords, isVerified, missingRequired, setupState } from "@/server/carriers/verification";
import { getDb, schema } from "@/server/db/client";
import { pickMarkup } from "@/server/pricing/engine";
import { adapterFor } from "@/server/providers/registry";
import { loadMarkupRows } from "@/server/quotes/service";

const EP = "/api/admin/carriers/accounts";
const fmt = (d: Date | string | null | undefined) => (d ? new Date(d).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "—");
const CAP_CHIP: Record<string, [string, string]> = {
  live_verified: ["Verified (production)", "c-active"], sandbox_verified: ["Verified (sandbox)", "c-active"], failed: ["Failed", "c-failed"],
  pending: ["Pending", "c-draft"], unsupported: ["Not offered", "c-draft"], documentation_required: ["Documentation required", "c-pending"],
};

type RateRow = { courier: string; carrier: string; courierId: string | null; preTaxPaise: number; withGstPaise: number; panelPaise: number | null; diffPaise: number | null; chargeableGrams: number; etaDays: number | null; pickup: string | null };

export default async function CourierAccount({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const st = await requireStaff("integrations.read");
  const write = can(st.role, "integrations.write");
  const db = await getDb();
  const [a] = await db.select().from(schema.providerAccounts).where(and(eq(schema.providerAccounts.id, id), eq(schema.providerAccounts.category, "shipping")));
  if (!a) notFound();
  const cfg = (a.configPublic ?? {}) as Record<string, unknown>;
  const spec = CARRIER_SPECS[a.adapter];
  const service = ((cfg.service as string) ?? (a.adapter === "delhivery_b2b" ? "B2B" : "B2C")) as "B2C" | "B2B";
  const state = setupState(a);
  const [stateLabel, stateChip] = SETUP_LABEL[state];
  const caps = capRecords(a);
  const missing = missingRequired(a);
  const docOnly = state === "documentation_required";
  const hints = (a.secretsHint ?? {}) as Record<string, unknown>;
  const hintEnv = ("test" in hints || "live" in hints ? hints : { [a.mode]: hints }) as Record<string, Record<string, string> | undefined>;
  const pubFields = (cfg.accountFields ?? {}) as Record<string, Record<string, string> | undefined>;
  const baseUrl = (cfg.baseUrl ?? {}) as Record<string, string>;
  const brand = String(cfg.brandName ?? spec?.name ?? a.label);
  const logo = carrierLogo(String(cfg.logoCode ?? (a.adapter.startsWith("delhivery") ? "delhivery" : a.adapter === "bluedart" ? "blue-dart" : a.adapter === "tci" ? "tci-express" : a.adapter)));
  const markup = pickMarkup(await loadMarkupRows(), a.adapter, service, null);
  const pilots = (cfg.pilotOrgIds as string[] | undefined) ?? [];
  const pilotOrgs = pilots.length ? await db.select({ id: schema.orgs.id, name: schema.orgs.businessName }).from(schema.orgs).where(inArray(schema.orgs.id, pilots)) : [];
  const rc = cfg.lastRateCheck as { id?: string; at: string; env?: string; error?: string; panelIncludesGst?: boolean; inputs: { originPincode: string; destinationPincode: string; paymentType: string; packages: Array<{ count: number; actualWeightGrams: number; lengthMm: number; breadthMm: number; heightMm: number }> }; rows?: RateRow[]; raw?: Record<string, string> | null } | undefined;

  // Monitoring: shipments with sync errors or awaiting provider IDs, and reconciliation jobs for this account.
  const problems = await db.select({ s: schema.shipments, o: schema.orders }).from(schema.shipments).innerJoin(schema.orders, eq(schema.orders.id, schema.shipments.orderId))
    .where(and(eq(schema.shipments.providerAccountId, a.id), or(isNotNull(schema.shipments.lastSyncError), eq(schema.shipments.bookingStatus, "pending")))).orderBy(desc(schema.shipments.createdAt)).limit(30);
  const recent = await db.select({ s: schema.shipments, o: schema.orders }).from(schema.shipments).innerJoin(schema.orders, eq(schema.orders.id, schema.shipments.orderId))
    .where(eq(schema.shipments.providerAccountId, a.id)).orderBy(desc(schema.shipments.createdAt)).limit(15);
  const openJobs = (await db.select().from(schema.jobs).where(and(eq(schema.jobs.queue, "booking.reconcile"), ne(schema.jobs.status, "done"))).limit(300));
  const jobQuotes = openJobs.length ? await db.select({ id: schema.quotes.id }).from(schema.quotes).where(and(eq(schema.quotes.providerAccountId, a.id), inArray(schema.quotes.id, openJobs.map((j) => String((j.payload as Record<string, unknown>).quoteId ?? ""))))) : [];
  const mine = openJobs.filter((j) => jobQuotes.some((q) => q.id === (j.payload as Record<string, unknown>).quoteId));
  const jobOrders = mine.length ? await db.select({ id: schema.orders.id, n: schema.orders.orderNumber }).from(schema.orders).where(inArray(schema.orders.id, mine.map((j) => String((j.payload as Record<string, unknown>).orderId)))) : [];
  const whs = await db.select({ w: schema.warehouseProviderSync, label: schema.warehouses.label, pin: schema.warehouses.pincode }).from(schema.warehouseProviderSync).innerJoin(schema.warehouses, eq(schema.warehouses.id, schema.warehouseProviderSync.warehouseId)).where(eq(schema.warehouseProviderSync.providerAccountId, a.id)).limit(50);

  return (
    <>
      <div className="page-h">
        <div>
          <p className="small muted" style={{ margin: 0 }}><Link className="link-navy" href="/admin/carriers/">Courier Integrations</Link> / {brand} {service}</p>
          <div className="row wrap" style={{ gap: 10, alignItems: "center" }}>
            {logo && <img src={logo} alt="" style={{ height: 28 }} />}
            <h1 style={{ margin: 0 }}>{brand} {service}</h1>
            <span className={`chip ${stateChip}`}>{stateLabel}</span>
          </div>
          <p className="small muted" style={{ margin: "4px 0 0" }}>
            {(spec?.route ?? cfg.route) === "aggregator" ? <>Booking route: <b>aggregator</b> — orders go to {spec?.name ?? brand}, which hands them to the courier you pick. Kept separate from any direct account of the same courier.</> : <>Booking route: <b>direct</b> carrier account.</>}
            {" "}Environment: <b>{a.mode === "live" ? "Production" : "Sandbox"}</b>{spec && !spec.sandbox ? " (no separate sandbox — tests run on the live account)" : ""}. Account ID <span className="mono">{a.id}</span>.
          </p>
        </div>
        {a.adapter.startsWith("delhivery_") && <div className="actions"><Link className="btn btn-outline" href={`/admin/carriers/delhivery/?svc=${a.adapter === "delhivery_b2b" ? "b2b" : "b2c"}`}>Delhivery payment modes, rate card &amp; billing</Link></div>}
      </div>

      {docOnly && (
        <section className="card mb16" style={{ padding: 16, borderColor: "var(--orange)" }}>
          <h2 className="b" style={{ fontSize: 15, marginTop: 0 }}>Documentation required</h2>
          <p className="small">Credentials can be stored now. This provider cannot quote or book until its adapter is written from the official API document for your account and every capability below is verified.</p>
          <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>{Object.entries(spec?.missing ?? { general: "API documentation for this provider" }).map(([k, v]) => <li key={k}><b>{k === "general" ? "General" : CAP_LABEL[k as keyof typeof CAP_LABEL] ?? k}:</b> {v}</li>)}</ul>
        </section>
      )}

      <div className="split" style={{ gap: 16, alignItems: "start" }}>
        <section className="card" style={{ padding: 16 }}>
          <h2 className="b" style={{ fontSize: 15, marginTop: 0 }}>Capability verification</h2>
          <p className="tiny muted">A passed authentication alone leaves the rest pending. Rates verify through a Rate check against the provider panel; booking, label, pickup and tracking verify from a real pilot booking (or by AWB below).</p>
          <table className="tbl"><tbody>{SHOWN_CAPS.map((c) => {
            const r = caps[c];
            const verified = isVerified(a, c);
            const [l, chip] = docOnly ? CAP_CHIP.documentation_required : verified ? CAP_CHIP[r!.state] : r?.state === "failed" ? CAP_CHIP.failed : r?.state === "unsupported" ? CAP_CHIP.unsupported : r && (r.state === "sandbox_verified") && a.mode === "live" ? ["Sandbox only — verify in production", "c-pending"] : CAP_CHIP.pending;
            return (
              <tr key={c}>
                <td className="small b">{CAP_LABEL[c]}{REQUIRED_CAPS.includes(c) ? <span className="tiny muted"> · required</span> : null}</td>
                <td><span className={`chip ${chip}`}>{l}</span></td>
                <td className="tiny muted">{r?.at ? fmt(r.at) : ""}{r?.evidence ? ` · ${r.evidence}` : ""}{r?.message ? <><br />{r.message}</> : null}</td>
              </tr>
            );
          })}</tbody></table>
          {!docOnly && write && (
            <div className="col mt12" style={{ gap: 10 }}>
              <AdminOpForm endpoint={EP} op="test_auth" submit="Test authentication" extra={{ id: a.id }} fields={[]} />
              <AdminOpForm endpoint={EP} op="test_serviceability" submit="Check serviceability" extra={{ id: a.id }} fields={[{ name: "from", label: "Pickup PIN", value: "122001" }, { name: "to", label: "Delivery PIN", value: "110001" }]} />
              <AdminOpForm endpoint={EP} op="test_track" submit="Verify tracking" extra={{ id: a.id }} fields={[{ name: "awb", label: "AWB / LR booked on this account", placeholder: "e.g. 1234567890" }]} />
              <AdminOpForm endpoint={EP} op="test_label" submit="Verify label" extra={{ id: a.id }} fields={[{ name: "awb", label: "AWB booked on this account", placeholder: "e.g. 1234567890" }]} />
            </div>
          )}
          {a.lastTestMessage && <p className="small mt8">Last connection test: {a.lastTestOk ? "✓" : "✗"} {a.lastTestMessage} · {fmt(a.lastTestAt)}</p>}
        </section>

        <section className="card" style={{ padding: 16 }}>
          <h2 className="b" style={{ fontSize: 15, marginTop: 0 }}>Activation</h2>
          <dl className="kv-list">
            <dt>Status</dt><dd><span className={`chip ${stateChip}`}>{stateLabel}</span></dd>
            <dt>Required checks</dt><dd className="small">{missing.length && !docOnly ? `Pending: ${missing.map((m) => CAP_LABEL[m]).join(", ")}` : docOnly ? "Adapter not built yet" : "All verified"}</dd>
            <dt>Last success</dt><dd className="small">{fmt(a.lastSuccessAt)}</dd>
            <dt>Markup now</dt><dd className="small">{markup.bps / 100}% ({markup.source === "provider_default" ? "provider / service default" : "global default"}) · customer overrides win · <Link className="link-navy" href="/admin/pricing/">Pricing</Link></dd>
          </dl>
          {write && !docOnly && (
            <div className="row wrap mt8" style={{ gap: 8 }}>
              {a.status !== "enabled" && a.status !== "paused" && missing.length === 0 && <AdminOpForm endpoint={EP} op="status" submit="Activate" extra={{ id: a.id, action: "activate" }} fields={[]} confirmText={`Customers will see ${brand} ${service} rates and can book it. Continue?`} />}
              {a.status !== "paused" && missing.length > 0 && isVerified(a, "authenticate") && !(a.status === "enabled" && cfg.activatedEarly) && <AdminOpForm endpoint={EP} op="status" submit="Activate now" extra={{ id: a.id, action: "activate_now" }} fields={[]} confirmText={`Show ${brand} ${service} live rates to all customers and allow bookings now? Not yet verified: ${missing.map((m) => CAP_LABEL[m]).join(", ")} — these verify from the first real bookings.`} />}
              {missing.length > 0 && !isVerified(a, "authenticate") && a.status !== "enabled" && <p className="tiny muted" style={{ flexBasis: "100%" }}>Save the keys and pass <b>Test authentication</b> to unlock <b>Activate now</b>.</p>}
              {a.status === "enabled" && <AdminOpForm endpoint={EP} op="status" submit="Pause new bookings" extra={{ id: a.id, action: "pause" }} fields={[]} confirmText="New quotes and bookings stop immediately. Existing shipments keep tracking. Continue?" />}
              {a.status === "paused" && <AdminOpForm endpoint={EP} op="status" submit="Resume" extra={{ id: a.id, action: "resume" }} fields={[]} />}
              {a.status !== "disabled" && <AdminOpForm endpoint={EP} op="status" submit="Back to setup" extra={{ id: a.id, action: "disable" }} fields={[]} confirmText="Stops quotes and bookings (pilot customers excepted). Continue?" />}
            </div>
          )}
          <p className="tiny muted mt8">Paused: no new quotes or bookings; booked shipments keep syncing tracking every 30 minutes.</p>

          <h3 className="small b mt16">Pilot customers (verification bookings)</h3>
          <p className="tiny muted">While in setup, only these customers see this service (marked “verification”) so a real booking can verify booking, label, pickup and tracking. {pilotOrgs.length ? `Now: ${pilotOrgs.map((o) => o.name).join(", ")}` : "None."}</p>
          {write && !docOnly && <AdminOpForm endpoint={EP} op="pilots" submit="Save pilots" extra={{ id: a.id }} fields={[{ name: "customers", label: "Customer emails or account IDs", value: pilots.join(", "), wide: true }]} />}
        </section>
      </div>

      <div className="split mt16" style={{ gap: 16, alignItems: "start" }}>
        <section className="card" style={{ padding: 16 }}>
          <h2 className="b" style={{ fontSize: 15, marginTop: 0 }}>Credentials</h2>
          <p className="tiny muted">Encrypted on the server, write-only, shown masked. Leave a field blank to keep its saved value. Sandbox and production are stored separately.</p>
          {(["test", "live"] as const).filter((m) => m === "live" || spec?.sandbox !== false).map((m) => (
            <div key={m} className="mt8">
              <h3 className="small b" style={{ margin: "8px 0 4px" }}>{m === "live" ? "Production" : "Sandbox"} {a.mode === m ? <span className="chip c-active">in use</span> : null}</h3>
              <p className="tiny mono muted" style={{ margin: "0 0 6px" }}>{(spec?.fields ?? []).map((f) => `${f.label}: ${f.secret ? hintEnv[m]?.[f.key] ?? "not set" : pubFields[m]?.[f.key] ?? "not set"}`).join(" · ") || "No fields"}</p>
              {write && <AdminOpForm endpoint={EP} op="credentials" submit={`Save ${m === "live" ? "production" : "sandbox"}`} extra={{ id: a.id, env: m }} fields={(spec?.fields ?? []).map((f) => ({ name: f.key, label: f.label, placeholder: f.secret ? (hintEnv[m]?.[f.key] ?? "Not set") : (pubFields[m]?.[f.key] ?? ""), wide: true }))} />}
              {write && hintEnv[m] && Object.keys(hintEnv[m]!).length > 0 && <AdminOpForm endpoint={EP} op="clear_credentials" submit="Remove" extra={{ id: a.id, env: m }} fields={[]} confirmText={`Remove the saved ${m === "live" ? "production" : "sandbox"} credentials?`} />}
            </div>
          ))}
          {write && spec?.sandbox !== false && <div className="mt12"><AdminOpForm endpoint={EP} op="environment" submit="Switch environment" extra={{ id: a.id }} fields={[{ name: "mode", label: "Use", type: "select", value: a.mode, options: [["test", "Sandbox"], ["live", "Production"]] }]} confirmText="Verification is per environment: capabilities must pass again before activation. Continue?" /></div>}
        </section>

        <section className="card" style={{ padding: 16 }}>
          <h2 className="b" style={{ fontSize: 15, marginTop: 0 }}>Service settings</h2>
          <dl className="kv-list">
            <dt>Partner code</dt><dd className="mono">{partnerCodeFor(a.adapter, cfg) ?? "—"} <span className="tiny muted">(shown in small print on every customer rate from this account)</span></dd>
            <dt>Service</dt><dd>{service}{spec?.serviceNotes?.[service] ? <span className="tiny muted"><br />{spec.serviceNotes[service]}</span> : null}</dd>
            <dt>Base URL</dt><dd className="mono tiny">{baseUrl[a.mode] ?? spec?.defaultBaseUrl?.[a.mode as "test" | "live"] ?? "—"}<br /><span className="muted">Approved hosts: {spec?.hosts[a.mode as "test" | "live"].join(", ") || "none yet"}</span></dd>
            <dt>Webhooks</dt><dd className="small">{spec?.webhooks ?? "—"}{adapterFor(a)?.parseTrackingWebhook && <><br /><span className="mono tiny" style={{ wordBreak: "break-all" }}>{(process.env.APP_URL ?? "https://vishwaship.in").replace(/\/+$/, "")}/api/webhooks/tracking/{a.id}/?token=&lt;your webhook token&gt;</span></>}</dd>
            <dt>Documents</dt><dd className="small">{spec?.docs ?? "—"}</dd>
          </dl>
          {write && <AdminOpForm endpoint={EP} op="config" submit="Save settings" extra={{ id: a.id }} fields={[
            { name: "brandName", label: "Name", value: brand }, { name: "logoCode", label: "Logo code", value: String(cfg.logoCode ?? "") },
            { name: "partnerCode", label: "Courier partner code (shown on customer rates)", value: String(cfg.partnerCode ?? ""), placeholder: partnerCodeFor(a.adapter, { ...cfg, partnerCode: "" }) ?? "e.g. VISW001B2C" },
            ...(spec?.baseUrlEditable ? [{ name: "baseUrlTest", label: "Sandbox base URL", value: baseUrl.test ?? "", wide: true }, { name: "baseUrlLive", label: "Production base URL", value: baseUrl.live ?? "", wide: true }] : []),
            ...(a.adapter === "shiporax" ? [
              { name: "gstTreatment", label: "Shipora X rates (total) are", type: "select" as const, value: String(cfg.gstTreatment ?? "auto"), options: [["auto", "Not set — no rates until chosen"], ["exclusive", "Excluding GST (Vishwaship adds 18%)"], ["inclusive", "Including GST"]] as Array<[string, string]> },
              { name: "courierIds", label: "Offer only these courierIds (blank = all)", value: ((cfg.courierIds as string[] | undefined) ?? []).join(", "), wide: true },
            ] : []),
            ...(a.adapter === "shiprocket" ? [
              { name: "gstTreatment", label: "Shiprocket rates are", type: "select" as const, value: String(cfg.gstTreatment ?? "exclusive"), options: [["exclusive", "Excluding GST (Vishwaship adds 18%)"], ["inclusive", "Including GST"]] as Array<[string, string]> },
              { name: "courierIds", label: "Offer only these courier_company_ids (blank = all)", value: ((cfg.courierIds as string[] | undefined) ?? []).join(", "), wide: true },
              { name: "noAutoPickup", label: "Don't request pickup automatically after booking", type: "checkbox" as const, value: cfg.autoPickup === false },
            ] : []),
            ...(a.adapter === "shipmozo" ? [
              { name: "typeOfPackage", label: "type_of_package", value: String(cfg.typeOfPackage ?? (service === "B2B" ? "MPS" : "SPS")) },
              { name: "rovType", label: "rov_type", value: String(cfg.rovType ?? "ROV_OWNER") },
              { name: "gstTreatment", label: "Rate basis when GST is not in the response", type: "select" as const, value: String(cfg.gstTreatment ?? "auto"), options: [["auto", "Read from response (refuse if unclear)"], ["exclusive", "Rates exclude GST"], ["inclusive", "Rates include GST"]] as Array<[string, string]> },
              { name: "courierIds", label: "Offer only these courier_ids (blank = all)", value: ((cfg.courierIds as string[] | undefined) ?? []).join(", "), wide: true },
              { name: "skipManualPickup", label: "Don't auto-request pickup when Shipmozo says manual", type: "checkbox" as const, value: !!cfg.skipManualPickup },
              ...(service === "B2B" ? [{ name: "mpsBookingVerified", label: "Offer rates and book orders with 2 or more cartons (check the first booking's package count in the Shipmozo panel)", type: "checkbox" as const, value: !!cfg.mpsBookingVerified, wide: true }] : []),
            ] : []),
            { name: "webhookNote", label: "Webhook notes", value: String(cfg.webhookNote ?? ""), wide: true },
          ]} />}
        </section>
      </div>

      {!docOnly && (
        <section className="card mt16" style={{ padding: 16 }}>
          <h2 className="b" style={{ fontSize: 15, marginTop: 0 }}>Rate check (live quote vs. provider panel)</h2>
          <p className="small muted">Run the same shipment in the {spec?.name ?? "provider"} panel on the same account, then enter each courier’s panel amount as <span className="mono">courier_id=amount</span> or <span className="mono">Service name=amount</span>. Rates are marked verified only when every entered amount matches the API within ₹1.</p>
          {write && <AdminOpForm endpoint={EP} op="rate_check" submit="Run rate check" extra={{ id: a.id }} fields={[
            { name: "from", label: "Pickup PIN", value: rc?.inputs.originPincode ?? "122001" }, { name: "to", label: "Delivery PIN", value: rc?.inputs.destinationPincode ?? "110001" },
            { name: "weightKg", label: "Total weight (kg)", type: "number", step: "0.01", value: rc ? rc.inputs.packages.reduce((t, p) => t + p.actualWeightGrams * p.count, 0) / 1000 : 0.5 },
            { name: "lengthCm", label: "L (cm)", type: "number", value: rc ? rc.inputs.packages[0].lengthMm / 10 : 22 }, { name: "widthCm", label: "W (cm)", type: "number", value: rc ? rc.inputs.packages[0].breadthMm / 10 : 10 }, { name: "heightCm", label: "H (cm)", type: "number", value: rc ? rc.inputs.packages[0].heightMm / 10 : 10 },
            { name: "boxes", label: "Boxes", type: "number", value: rc?.inputs.packages[0].count ?? 1 },
            { name: "payment", label: "Payment", type: "select", value: rc?.inputs.paymentType ?? "prepaid", options: [["prepaid", "Prepaid"], ["cod", "COD"], ["fod", "FOD (freight on delivery)"]] },
            { name: "codRupees", label: "COD ₹", type: "number", value: 0 }, { name: "valueRupees", label: "Declared value ₹", type: "number", value: 1000 },
            { name: "panel", label: "Panel amounts (optional)", type: "textarea", placeholder: "12=118.00\nDelhivery Surface=96.40" },
            { name: "panelIncludesGst", label: "Panel amounts include GST", type: "checkbox", value: rc?.panelIncludesGst ?? true },
          ]} />}
          {rc && (
            <div className="mt12">
              <p className="tiny muted">Last check {rc.id ?? ""} · {fmt(rc.at)} · {rc.env === "live" ? "production" : "sandbox"} · {rc.inputs.originPincode} → {rc.inputs.destinationPincode} · {rc.inputs.paymentType}</p>
              {rc.raw && <details className="mb8"><summary className="small link-navy">Raw provider responses (for mapping checks — no credentials)</summary>{Object.entries(rc.raw).map(([k, v]) => <div key={k}><p className="tiny b" style={{ margin: "6px 0 2px" }}>{k}</p><pre className="mono tiny" style={{ whiteSpace: "pre-wrap", wordBreak: "break-all", maxHeight: 240, overflow: "auto", background: "var(--gray-soft)", padding: 8, borderRadius: 8 }}>{v}</pre></div>)}</details>}
              {rc.error ? <p className="small err">{rc.error}</p> : (
                <div className="tbl-wrap"><table className="tbl"><thead><tr><th>Courier (courier_id)</th><th style={{ textAlign: "right" }}>API pre-tax</th><th style={{ textAlign: "right" }}>API incl. GST</th><th style={{ textAlign: "right" }}>Panel</th><th>Result</th><th>Chargeable</th><th>ETA</th><th>Pickup</th><th style={{ textAlign: "right" }}>Customer @ {markup.bps / 100}%</th></tr></thead>
                  <tbody>{(rc.rows ?? []).map((r, i) => (
                    <tr key={i}><td className="small">{r.courier}{r.courierId ? <span className="mono tiny muted"> ({r.courierId})</span> : null}</td><td style={{ textAlign: "right" }} className="small">{formatINR(r.preTaxPaise)}</td><td style={{ textAlign: "right" }} className="small">{formatINR(r.withGstPaise)}</td>
                      <td style={{ textAlign: "right" }} className="small">{r.panelPaise === null ? "—" : formatINR(r.panelPaise)}</td>
                      <td>{r.diffPaise === null ? <span className="chip c-draft">Not compared</span> : Math.abs(r.diffPaise) <= 100 ? <span className="chip c-active">Match</span> : <span className="chip c-failed">Differs {formatINR(r.diffPaise)}</span>}</td>
                      <td className="small">{(r.chargeableGrams / 1000).toFixed(2)} kg</td><td className="small">{r.etaDays ? `${r.etaDays} d` : "—"}</td><td className="small">{r.pickup ?? "—"}</td>
                      <td style={{ textAlign: "right" }} className="small b">{formatINR(Math.round(r.preTaxPaise * (1 + markup.bps / 10000)))}</td></tr>
                  ))}</tbody></table></div>
              )}
            </div>
          )}
        </section>
      )}

      <section className="card p0 mt16">
        <h2 className="b small card-h" style={{ margin: 0 }}>Failed jobs &amp; provider errors</h2>
        {problems.length === 0 && mine.length === 0 ? <p className="small muted" style={{ padding: 16 }}>Nothing failing.</p> : (
          <div className="tbl-wrap"><table className="tbl"><thead><tr><th>Vishwaship shipment / order</th><th>Provider ref</th><th>AWB / LR</th><th>Problem</th><th>Last sync</th><th /></tr></thead>
            <tbody>
              {problems.map(({ s, o }) => (
                <tr key={s.id}><td className="small"><span className="mono">{s.id}</span><br />{o.orderNumber}</td><td className="mono tiny">{s.providerOrderRef ?? "—"}</td><td className="mono tiny">{s.awb ?? "—"}{s.lrNumber && s.lrNumber !== s.awb ? ` / ${s.lrNumber}` : ""}</td>
                  <td className="small">{s.bookingStatus === "pending" ? "Awaiting AWB / LR from the provider" : s.lastSyncError}{s.syncFailures > 1 ? <span className="tiny muted"> ({s.syncFailures}×)</span> : null}</td><td className="small">{fmt(s.lastSyncAt)}</td>
                  <td>{s.awb && <AdminOpForm endpoint={EP} op="refresh_shipment" submit="Sync now" extra={{ id: a.id, shipmentId: s.id }} fields={[]} />}</td></tr>
              ))}
              {mine.map((j) => { const p = j.payload as Record<string, string>; return (
                <tr key={j.id}><td className="small">Order {jobOrders.find((o) => o.id === p.orderId)?.n ?? p.orderId}<br /><span className="mono tiny">{p.shipmentId ?? "no shipment yet"}</span></td><td className="mono tiny">{p.orderId}</td><td>—</td>
                  <td className="small">Booking reconciliation · {j.status}{j.lastError ? ` · ${j.lastError}` : ""} · attempt {j.attempts}</td><td className="small">next {fmt(j.runAt)}</td>
                  <td>{write && <AdminOpForm endpoint={EP} op="retry_job" submit="Reconcile now" extra={{ id: a.id, jobId: j.id }} fields={[]} />}</td></tr>
              ); })}
            </tbody></table></div>
        )}
        <p className="tiny muted" style={{ padding: "0 16px 12px" }}>Reconcile always asks the provider by the Vishwaship order reference first, so a retry never creates a second booking or wallet charge.</p>
      </section>

      <div className="split mt16" style={{ gap: 16, alignItems: "start" }}>
        <section className="card p0">
          <h2 className="b small card-h" style={{ margin: 0 }}>Recent shipments</h2>
          {recent.length === 0 ? <p className="small muted" style={{ padding: 16 }}>None yet.</p> : (
            <div className="tbl-wrap"><table className="tbl"><thead><tr><th>Order</th><th>AWB / LR</th><th>Status</th><th>Last sync</th><th style={{ textAlign: "right" }}>Cost → charged</th></tr></thead>
              <tbody>{recent.map(({ s, o }) => <tr key={s.id}><td className="small">{o.orderNumber}<br /><span className="tiny muted">{s.serviceName}</span></td><td className="mono tiny">{s.awb ?? "pending"}{s.lrNumber && s.lrNumber !== s.awb ? ` / ${s.lrNumber}` : ""}</td><td className="small">{s.status.replace(/_/g, " ")}</td><td className="small">{fmt(s.lastSyncAt)}</td><td style={{ textAlign: "right" }} className="small">{formatINR(s.costPaise)} → {formatINR(s.sellPaise)}</td></tr>)}</tbody></table></div>
          )}
        </section>
        <section className="card" style={{ padding: 16 }}>
          <h2 className="b" style={{ fontSize: 15, marginTop: 0 }}>Pickup warehouse mapping</h2>
          <p className="tiny muted">Registered automatically on the first booking from each pickup address{a.adapter === "shipmozo" ? " (create-warehouse, title VS-<warehouse code>)" : ""}. Map one manually to reuse an existing provider warehouse.</p>
          <ul className="plain-list">{whs.map(({ w, label, pin }) => <li key={w.id} className="row between small"><span>{label} ({pin}) → <span className="mono">{w.providerWarehouseRef ?? "—"}</span></span><span className="row" style={{ gap: 6 }}><span className={`chip ${w.status === "registered" ? "c-active" : "c-failed"}`}>{w.status}{w.lastError ? ` · ${w.lastError}` : ""}</span>{write && !docOnly && w.status !== "registered" && <AdminOpForm endpoint={EP} op="register_warehouse" submit="Register now" extra={{ id: a.id, warehouseId: w.warehouseId }} fields={[]} />}</span></li>)}{whs.length === 0 && <li className="small muted">None yet.</li>}</ul>
          {write && !docOnly && <AdminOpForm endpoint={EP} op="map_warehouse" submit="Map" extra={{ id: a.id }} fields={[{ name: "warehouseId", label: "Vishwaship warehouse ID", placeholder: "wh_…" }, { name: "providerRef", label: "Provider warehouse ID / name" }]} />}
        </section>
      </div>

      {!docOnly && Object.keys(spec?.missing ?? {}).length > 0 && (
        <section className="card mt16" style={{ padding: 16 }}>
          <h2 className="b" style={{ fontSize: 15, marginTop: 0 }}>Open questions for {spec?.name}</h2>
          <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>{Object.entries(spec!.missing).map(([k, v]) => <li key={k}><b>{k === "general" ? "General" : CAP_LABEL[k as keyof typeof CAP_LABEL] ?? k}:</b> {v}</li>)}</ul>
        </section>
      )}
    </>
  );
}
