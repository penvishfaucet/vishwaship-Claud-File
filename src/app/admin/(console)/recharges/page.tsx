import Link from "next/link";
import { redirect } from "next/navigation";
import { type SQL, and, asc, desc, eq, gte, ilike, inArray, lte, or, sql } from "drizzle-orm";
import { AlertTriangle, ExternalLink } from "lucide-react";
import { can } from "@/server/auth/rbac";
import { requireStaff } from "@/server/auth/session";
import { getDb, schema } from "@/server/db/client";
import { approveManual, pendingManualCount, rejectManual, requestInfo } from "@/server/payments/recharge";
import { reconcileRecharge } from "@/server/payments/reconcile";
import { formatINR } from "@/lib/money";
import { METHOD_LABEL, bpsLabel, rechargeStatus } from "@/lib/recharge";

export const dynamic = "force-dynamic";
const ist = (d: Date | null | undefined) => (d ? d.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—");
type SP = { id?: string; q?: string; method?: string; status?: string; from?: string; to?: string; org?: string; credited?: string; ok?: string; err?: string };

async function decide(fd: FormData) {
  "use server";
  const s = await requireStaff("finance.adjust");
  const id = String(fd.get("id") ?? "");
  const op = String(fd.get("op") ?? "");
  const note = String(fd.get("note") ?? "");
  const r = op === "approve" ? await approveManual(id, s.userId, note) : op === "reject" ? await rejectManual(id, s.userId, note) : op === "info" ? await requestInfo(id, s.userId, note) : { ok: false, message: "Unknown action" };
  redirect(`/admin/recharges/?id=${encodeURIComponent(id)}&${r.ok ? "ok" : "err"}=${encodeURIComponent(r.message)}`);
}

/** Ask the gateway again about a pending online payment (credits exactly once if it was captured). */
async function recheck(fd: FormData) {
  "use server";
  await requireStaff("finance.read");
  const id = String(fd.get("id") ?? "");
  const st = await reconcileRecharge(id);
  redirect(`/admin/recharges/?id=${encodeURIComponent(id)}&ok=${encodeURIComponent(`Checked with the gateway: ${rechargeStatus(st ?? "unknown").label}`)}`);
}

export default async function RechargesAdmin({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const s = await requireStaff("finance.read");
  const canDecide = can(s.role, "finance.adjust");
  const db = await getDb();
  const R = schema.recharges, O = schema.orgs;
  const conds: SQL[] = [];
  if (sp.method && ["razorpay", "cashfree", "manual", "demo"].includes(sp.method)) conds.push(eq(R.method, sp.method));
  if (sp.status === "open") conds.push(inArray(R.status, ["pending_verification", "info_required"]));
  else if (sp.status) conds.push(eq(R.status, sp.status));
  if (sp.org) conds.push(eq(R.orgId, sp.org));
  // credited in the wallet ledger (the ledger entry is the proof, not the recharge status)
  if (sp.credited === "yes") conds.push(sql`exists (select 1 from ${schema.ledgerEntries} l where l.idempotency_key = 'recharge:' || ${R.id})`);
  if (sp.credited === "no") conds.push(sql`not exists (select 1 from ${schema.ledgerEntries} l where l.idempotency_key = 'recharge:' || ${R.id})`);
  if (sp.from && /^\d{4}-\d{2}-\d{2}$/.test(sp.from)) conds.push(gte(R.createdAt, new Date(`${sp.from}T00:00:00+05:30`)));
  if (sp.to && /^\d{4}-\d{2}-\d{2}$/.test(sp.to)) conds.push(lte(R.createdAt, new Date(`${sp.to}T23:59:59+05:30`)));
  if (sp.q?.trim()) {
    const q = `%${sp.q.trim().replace(/[%_]/g, "")}%`;
    conds.push(or(ilike(R.requestNumber, q), ilike(R.utr, q), ilike(R.razorpayPaymentId, q), ilike(R.providerPaymentId, q), ilike(R.providerOrderId, q), ilike(R.razorpayOrderId, q), ilike(O.businessName, q), ilike(O.id, q))!);
  }
  const rows = await db.select({ r: R, o: O }).from(R).innerJoin(O, eq(O.id, R.orgId)).where(conds.length ? and(...conds) : undefined).orderBy(desc(R.createdAt)).limit(300);
  const pending = await pendingManualCount();
  const creditedRows = rows.length ? await db.select({ key: schema.ledgerEntries.idempotencyKey, at: schema.ledgerEntries.createdAt, amount: schema.ledgerEntries.amountPaise }).from(schema.ledgerEntries).where(inArray(schema.ledgerEntries.idempotencyKey, rows.map(({ r }) => `recharge:${r.id}`))) : [];
  const creditOf = new Map(creditedRows.map((c) => [c.key.slice("recharge:".length), c]));
  const customers = await db.select({ id: O.id, name: O.businessName }).from(O).orderBy(O.businessName).limit(2000);
  const sel = sp.id ? (await db.select({ r: R, o: O }).from(R).innerJoin(O, eq(O.id, R.orgId)).where(eq(R.id, sp.id)))[0] : undefined;
  const events = sel ? await db.select({ e: schema.rechargeEvents, u: schema.users.name }).from(schema.rechargeEvents).leftJoin(schema.users, eq(schema.users.id, schema.rechargeEvents.actorUserId)).where(eq(schema.rechargeEvents.rechargeId, sel.r.id)).orderBy(asc(schema.rechargeEvents.createdAt)) : [];
  const dupes = sel?.r.utr ? await db.select({ id: R.id, n: R.requestNumber, status: R.status, org: R.orgId }).from(R).where(and(eq(R.utr, sel.r.utr))) : [];
  const [ticket] = sel?.r.ticketId ? await db.select({ number: schema.tickets.number }).from(schema.tickets).where(eq(schema.tickets.id, sel.r.ticketId)) : [];
  const [decider] = sel?.r.decidedBy ? await db.select({ name: schema.users.name }).from(schema.users).where(eq(schema.users.id, sel.r.decidedBy)) : [];
  const ledger = sel ? (await db.select({ id: schema.ledgerEntries.id, at: schema.ledgerEntries.createdAt, amount: schema.ledgerEntries.amountPaise }).from(schema.ledgerEntries).where(eq(schema.ledgerEntries.idempotencyKey, `recharge:${sel.r.id}`)))[0] : undefined;
  const qs = (p: Partial<SP>) => `/admin/recharges/?${new URLSearchParams(Object.entries({ q: sp.q, method: sp.method, status: sp.status, from: sp.from, to: sp.to, org: sp.org, credited: sp.credited, ...p }).filter(([, v]) => v) as [string, string][]).toString()}`;
  const open = sel && ["pending_verification", "info_required"].includes(sel.r.status) && sel.r.method === "manual";
  return (
    <>
      <div className="page-h">
        <div><h1>Wallet Recharges</h1><p className="small muted" style={{ margin: "4px 0 0" }}>Online gateway payments and Manual UPI requests. Verify manual payments against the actual UPI / bank statement before approving.</p></div>
        <div className="actions"><Link className={`btn ${sp.status === "open" ? "btn-navy" : "btn-outline"}`} href={qs({ status: "open", id: undefined })}>Pending verification <span className="chip c-pending" style={{ marginLeft: 6 }}>{pending}</span></Link><Link className="btn btn-outline" href="/admin/payments/">Payment Settings</Link></div>
      </div>
      {sp.ok && <p className="note small mb12" role="status">{sp.ok}</p>}
      {sp.err && <p className="note small mb12 t-debit" role="alert">{sp.err}</p>}
      <form className="row wrap mb12" style={{ gap: 8 }} role="search">
        <label className="sr-only" htmlFor="rq">Search</label><input id="rq" name="q" className="input" defaultValue={sp.q} placeholder="Customer, account ID, Request ID, Razorpay payment / order ID, UTR" style={{ maxWidth: 340 }} />
        <label className="sr-only" htmlFor="ro">Customer</label><select id="ro" name="org" className="select" defaultValue={sp.org ?? ""} style={{ maxWidth: 220 }}><option value="">All customers</option>{customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
        <label className="sr-only" htmlFor="rcr">Wallet credited</label><select id="rcr" name="credited" className="select" defaultValue={sp.credited ?? ""} style={{ maxWidth: 190 }}><option value="">Credited or not</option><option value="yes">Credited in wallet</option><option value="no">Not credited</option></select>
        <label className="sr-only" htmlFor="rm">Method</label><select id="rm" name="method" className="select" defaultValue={sp.method ?? ""} style={{ maxWidth: 170 }}><option value="">All methods</option><option value="manual">Manual UPI</option><option value="razorpay">Razorpay</option><option value="cashfree">Cashfree</option><option value="demo">Demo</option></select>
        <label className="sr-only" htmlFor="rs">Status</label><select id="rs" name="status" className="select" defaultValue={sp.status ?? ""} style={{ maxWidth: 210 }}><option value="">All statuses</option><option value="open">Needs action (manual)</option>{["payment_pending", "pending_verification", "info_required", "credited", "rejected", "failed", "cancelled", "expired", "mismatch"].map((k) => <option key={k} value={k}>{rechargeStatus(k).label}</option>)}</select>
        <label className="sr-only" htmlFor="rf">From</label><input id="rf" type="date" name="from" className="input" defaultValue={sp.from} style={{ maxWidth: 160 }} />
        <label className="sr-only" htmlFor="rt">To</label><input id="rt" type="date" name="to" className="input" defaultValue={sp.to} style={{ maxWidth: 160 }} />
        <button className="btn btn-navy">Filter</button>{(sp.q || sp.method || sp.status || sp.from || sp.to || sp.org || sp.credited) && <Link className="btn btn-outline" href="/admin/recharges/">Clear</Link>}
      </form>

      <div className="split" style={{ gap: 16, alignItems: "start" }}>
        <div className="card p0 tbl-wrap"><table className="tbl">
          <thead><tr><th>Request</th><th>Customer</th><th>Method</th><th className="r">Amount</th><th className="r">Paid</th><th>Reference</th><th>Status</th><th>Wallet ledger</th></tr></thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={8} className="small muted">No recharges match.</td></tr>}
            {rows.map(({ r, o }) => {
              const st = rechargeStatus(r.status);
              return (
                <tr key={r.id} style={sel?.r.id === r.id ? { background: "var(--orange-soft)" } : undefined}>
                  <td><Link className="b link-navy" href={qs({ id: r.id })}>{r.requestNumber ?? r.id.slice(0, 12)}</Link><div className="tiny muted">{ist(r.createdAt)}</div></td>
                  <td className="small"><Link className="link-navy" href={`/admin/customers/${o.id}/?tab=wallet`}>{o.businessName}</Link><div className="tiny muted mono">{o.id}</div></td>
                  <td className="small">{METHOD_LABEL[r.method] ?? r.method}</td>
                  <td className="r b">{formatINR(r.amountPaise)}</td>
                  <td className="r small">{r.paidPaise != null ? formatINR(r.paidPaise) : "—"}</td>
                  <td className="tiny mono">{r.utr ?? r.razorpayPaymentId ?? r.providerPaymentId ?? "—"}{r.utrDuplicate && <span className="chip c-failed" style={{ marginLeft: 4 }}>Dup UTR</span>}</td>
                  <td><span className={`chip ${st.chip}`}>{st.label}</span></td>
                  <td className="small nowrap">{creditOf.get(r.id) ? <Link className="t-credit" href={`/admin/customers/${o.id}/?tab=wallet`} title="Open the customer's passbook">✓ Credited {formatINR(creditOf.get(r.id)!.amount)}</Link> : <span className="muted">Not credited</span>}</td>
                </tr>
              );
            })}
          </tbody>
        </table></div>

        {sel && (
          <section className="card" style={{ padding: 18 }} aria-labelledby="rc-h">
            <div className="row between wrap" style={{ gap: 8 }}>
              <h2 id="rc-h" style={{ fontSize: 18, margin: 0 }}>{sel.r.requestNumber ?? sel.r.id}</h2>
              <span className={`chip ${rechargeStatus(sel.r.status).chip}`}>{rechargeStatus(sel.r.status).label}</span>
            </div>
            {sel.r.utrDuplicate && (
              <p className="note small t-debit" role="alert" style={{ marginTop: 10 }}><AlertTriangle size={14} aria-hidden /> <b>Duplicate UTR:</b> {sel.r.utr} also appears on {dupes.filter((d) => d.id !== sel.r.id).map((d) => `${d.n ?? d.id} (${rechargeStatus(d.status).label}${d.org !== sel.r.orgId ? ", other customer" : ""})`).join(", ") || "another request"}. Check the bank statement before approving.</p>
            )}
            <dl className="kv-list mt12">
              <dt>Customer</dt><dd><Link className="link-navy" href={`/admin/customers/${sel.o.id}/`}>{sel.o.businessName}</Link> <span className="tiny muted mono">{sel.o.id}</span> · <Link className="link-navy" href={`/admin/customers/${sel.o.id}/?tab=wallet`}>Wallet history</Link></dd>
              <dt>Method</dt><dd>{METHOD_LABEL[sel.r.method] ?? sel.r.method}</dd>
              {ticket && <><dt>Linked ticket</dt><dd><Link className="link-navy" href={`/admin/tickets/?open=${sel.r.ticketId}`}>{ticket.number} <ExternalLink size={12} aria-hidden /></Link></dd></>}
              <dt>Wallet credit (requested)</dt><dd className="b">{formatINR(sel.r.amountPaise)}</dd>
              {sel.r.method === "manual" && <><dt>Discount</dt><dd>{bpsLabel(sel.r.discountBps)} = {formatINR(sel.r.discountPaise)}</dd><dt>Expected payable</dt><dd className="b">{formatINR(sel.r.payablePaise ?? sel.r.amountPaise)}</dd></>}
              <dt>{sel.r.method === "manual" ? "Customer-reported paid" : "Gateway amount"}</dt><dd className={sel.r.method === "manual" && sel.r.paidPaise !== sel.r.payablePaise ? "t-debit b" : undefined}>{sel.r.paidPaise != null ? formatINR(sel.r.paidPaise) : "—"}{sel.r.method === "manual" && sel.r.paidPaise != null && sel.r.paidPaise !== sel.r.payablePaise ? " (differs from expected)" : ""}</dd>
              <dt>{sel.r.method === "manual" ? "UTR / reference" : "Payment reference"}</dt><dd className="mono">{sel.r.utr ?? sel.r.razorpayPaymentId ?? sel.r.providerPaymentId ?? "—"}</dd>
              {sel.r.method !== "manual" && <><dt>Gateway order</dt><dd className="mono tiny">{sel.r.razorpayOrderId ?? sel.r.providerOrderId ?? "—"}</dd></>}
              {sel.r.paidAt && <><dt>Paid on (reported)</dt><dd>{ist(sel.r.paidAt)}</dd></>}
              <dt>Submitted</dt><dd>{ist(sel.r.createdAt)}</dd>
              {sel.r.remarks && <><dt>Customer remarks</dt><dd style={{ whiteSpace: "pre-wrap" }}>{sel.r.remarks}</dd></>}
              {sel.r.decidedAt && <><dt>{sel.r.status === "rejected" ? "Rejected" : sel.r.status === "credited" ? "Approved / credited" : "Updated"}</dt><dd>{ist(sel.r.decidedAt)}{decider ? ` by ${decider.name}` : ""}</dd></>}
              {sel.r.decisionNote && <><dt>Note / reason</dt><dd style={{ whiteSpace: "pre-wrap" }}>{sel.r.decisionNote}</dd></>}
              <dt>Wallet ledger</dt><dd>{ledger ? <span className="t-credit">✓ Credited {formatINR(ledger.amount)} on {ist(ledger.at)} <span className="tiny mono muted">({ledger.id})</span></span> : <span className="muted">Not credited{sel.r.status === "credited" ? " — check: status says credited but no ledger entry" : ""}</span>}</dd>
            </dl>
            {sel.r.proofKey && (
              <div className="mt12">
                <h3 className="small b">Payment screenshot</h3>
                {sel.r.proofMime === "application/pdf"
                  ? <a className="btn btn-outline btn-sm" href={`/api/admin/recharges/${sel.r.id}/proof/`} target="_blank" rel="noopener noreferrer">Open PDF</a>
                  : <a href={`/api/admin/recharges/${sel.r.id}/proof/`} target="_blank" rel="noopener noreferrer"><img src={`/api/admin/recharges/${sel.r.id}/proof/`} alt="Payment screenshot submitted by the customer" style={{ maxWidth: "100%", maxHeight: 480, borderRadius: 10, border: "1px solid var(--line)", display: "block" }} /></a>}
              </div>
            )}
            {open && canDecide && (
              <div className="col mt16" style={{ gap: 10 }}>
                <form action={decide} className="col" style={{ gap: 6 }}>
                  <input type="hidden" name="id" value={sel.r.id} /><input type="hidden" name="op" value="approve" />
                  <label className="small" htmlFor="an">Approval note (optional, internal)</label><input id="an" name="note" className="input" placeholder="e.g. Matched in HDFC statement 18 Nov" />
                  <button className="btn btn-green">Approve and Credit Wallet {formatINR(sel.r.amountPaise)}</button>
                </form>
                <form action={decide} className="col" style={{ gap: 6 }}>
                  <input type="hidden" name="id" value={sel.r.id} /><input type="hidden" name="op" value="info" />
                  <label className="small" htmlFor="inf">Request more information (sent to the customer)</label><textarea id="inf" name="note" className="textarea" rows={2} placeholder="e.g. Screenshot is unclear — please upload the full UPI receipt" />
                  <button className="btn btn-outline">Request More Information</button>
                </form>
                <form action={decide} className="col" style={{ gap: 6 }}>
                  <input type="hidden" name="id" value={sel.r.id} /><input type="hidden" name="op" value="reject" />
                  <label className="small" htmlFor="rj">Reject with reason (sent to the customer)</label><textarea id="rj" name="note" className="textarea" rows={2} placeholder="e.g. No matching payment received for this UTR" />
                  <button className="btn btn-red">Reject</button>
                </form>
              </div>
            )}
            {sel.r.method !== "manual" && sel.r.status === "payment_pending" && (
              <form action={recheck} className="mt12"><input type="hidden" name="id" value={sel.r.id} /><button className="btn btn-outline btn-sm">Re-check with {METHOD_LABEL[sel.r.method] ?? "gateway"}</button><span className="tiny muted" style={{ marginLeft: 8 }}>Credits the wallet once if the payment was captured.</span></form>
            )}
            {open && !canDecide && <p className="small muted mt12">Approving needs the Finance “adjust” permission.</p>}
            {events.length > 0 && (
              <div className="mt16"><h3 className="small b">History</h3>
                <ul className="plain-list">{events.map(({ e, u }) => <li key={e.id} className="small"><b>{e.action.replace(/_/g, " ")}</b> · {e.actorKind}{u ? ` (${u})` : ""} · <span className="muted">{ist(e.createdAt)}</span>{e.note ? <div className="tiny muted" style={{ whiteSpace: "pre-wrap" }}>{e.note}</div> : null}</li>)}</ul>
              </div>
            )}
          </section>
        )}
      </div>
    </>
  );
}
