import { redirect } from "next/navigation";
import { and, desc, eq } from "drizzle-orm";
import { audit } from "@/server/audit";
import { can } from "@/server/auth/rbac";
import { requireStaff } from "@/server/auth/session";
import { getDb, schema } from "@/server/db/client";
import { signedLink } from "@/server/storage";
import { newId } from "@/server/util/ids";

async function decide(fd: FormData) {
  "use server";
  const s = await requireStaff("kyc.review");
  const docId = String(fd.get("docId"));
  const status = String(fd.get("status")) as "approved" | "changes_requested" | "rejected";
  const reason = String(fd.get("reason") ?? "").trim();
  if (!["approved", "changes_requested", "rejected"].includes(status)) return;
  if (status !== "approved" && reason.length < 5) redirect("/admin/kyc/?err=reason");
  const db = await getDb();
  const [doc] = await db.select().from(schema.kycDocuments).where(eq(schema.kycDocuments.id, docId));
  if (!doc) return;
  await db.update(schema.kycDocuments).set({ status, reviewerId: s.userId, reviewReason: reason || null, reviewedAt: new Date() }).where(eq(schema.kycDocuments.id, docId));
  // Org status: approved when every required doc's latest version is approved.
  const docs = await db.select().from(schema.kycDocuments).where(eq(schema.kycDocuments.orgId, doc.orgId)).orderBy(desc(schema.kycDocuments.createdAt));
  const latest = (t: string) => docs.find((d) => d.docType === t);
  const req = ["pan", "aadhaar", "cancelled_cheque"].map(latest);
  const orgStatus = req.some((d) => d?.status === "rejected") ? "rejected" : req.some((d) => d?.status === "changes_requested") ? "changes_requested" : req.every((d) => d?.status === "approved") ? "approved" : "pending";
  await db.update(schema.orgs).set({ kycStatus: orgStatus }).where(eq(schema.orgs.id, doc.orgId));
  await db.insert(schema.inAppAlerts).values({ id: newId("al"), orgId: doc.orgId, kind: "kyc", title: `KYC ${doc.docType.replace("_", " ")}: ${status.replace("_", " ")}${reason ? ` — ${reason}` : ""}`, href: "/portal/kyc/" });
  await audit({ actorUserId: s.userId, actorKind: "staff", orgId: doc.orgId, action: `kyc.${status}`, targetType: "kyc_document", targetId: docId, details: { reason } });
  redirect("/admin/kyc/");
}

export default async function AdminKyc({ searchParams }: { searchParams: Promise<{ org?: string; err?: string }> }) {
  const sp = await searchParams;
  const s = await requireStaff("kyc.review");
  const canView = can(s.role, "kyc.documents.read");
  const db = await getDb();
  const rows = await db.select({ d: schema.kycDocuments, o: schema.orgs }).from(schema.kycDocuments).innerJoin(schema.orgs, eq(schema.orgs.id, schema.kycDocuments.orgId))
    .where(sp.org ? and(eq(schema.kycDocuments.orgId, sp.org)) : eq(schema.kycDocuments.status, "pending")).orderBy(desc(schema.kycDocuments.createdAt));
  if (canView && rows.length) await audit({ actorUserId: s.userId, actorKind: "staff", action: "kyc.queue_viewed", details: { count: rows.length } });
  return (
    <>
      <div className="page-h"><h1>KYC review</h1></div>
      {sp.err && <p className="err small" role="alert">A reason is required when requesting changes or rejecting.</p>}
      {rows.length === 0 ? <div className="card empty"><p className="muted">No documents waiting for review.</p></div> : (
        <div className="col" style={{ gap: 12 }}>
          {rows.map(({ d, o }) => (
            <section key={d.id} className="card split" style={{ padding: 16, gap: 16 }}>
              <div>
                <b>{o.businessName}</b> <span className="tiny muted mono">{o.id}</span>
                <dl className="kv-list mt8"><dt>Document</dt><dd>{d.docType.replace("_", " ")}</dd><dt>Number</dt><dd className="mono">{d.maskedNumber}</dd><dt>File</dt><dd>{d.mime} · {(d.sizeBytes / 1024).toFixed(0)} KB</dd><dt>Status</dt><dd>{d.status}</dd></dl>
                {canView ? <a className="btn btn-sm btn-outline mt8" href={signedLink(d.storageKey)} target="_blank" rel="noopener">View document (5-min link)</a> : <p className="tiny muted">Document preview restricted for your role.</p>}
              </div>
              {d.status === "pending" && (
                <form action={decide} className="col" style={{ gap: 8 }}>
                  <input type="hidden" name="docId" value={d.id} />
                  <div className="field"><label htmlFor={`r-${d.id}`}>Reason (required unless approving)</label><input id={`r-${d.id}`} name="reason" className="input" /></div>
                  <div className="field"><label htmlFor={`s-${d.id}`}>Decision</label>
                    <select id={`s-${d.id}`} name="status" className="select" defaultValue="approved"><option value="approved">Approve</option><option value="changes_requested">Request changes</option><option value="rejected">Reject</option></select>
                  </div>
                  <button className="btn btn-sm btn-navy" style={{ alignSelf: "start" }}>Submit decision</button>
                </form>
              )}
            </section>
          ))}
        </div>
      )}
    </>
  );
}
