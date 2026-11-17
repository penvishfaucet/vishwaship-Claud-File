import { desc, eq } from "drizzle-orm";
import { KycUpload } from "@/components/portal/KycUpload";
import { getDb, schema } from "@/server/db/client";
import { portalContext } from "@/server/portal/context";
import { KYC_DOCS } from "@/lib/kyc";

export default async function KycPage() {
  const ctx = await portalContext();
  const db = await getDb();
  const docs = await db.select().from(schema.kycDocuments).where(eq(schema.kycDocuments.orgId, ctx.org.id)).orderBy(desc(schema.kycDocuments.createdAt));
  return (
    <>
      <div className="page-h"><div><h1>KYC</h1><p className="small muted" style={{ margin: "4px 0 0" }}>Status: <span className="chip c-pending">{ctx.org.kycStatus.replace("_", " ")}</span></p></div></div>
      <p className="small muted">Documents are encrypted and visible only to Vishwaship KYC reviewers. Accepted: PDF, JPG or PNG up to 5 MB.</p>
      <div className="grid2" style={{ gap: 12 }}>
        {KYC_DOCS.map((d) => {
          const latest = docs.find((x) => x.docType === d.type);
          return (
            <section key={d.type} className="card" style={{ padding: 16 }}>
              <div className="row between"><b>{d.label}{d.required ? "" : " (if applicable)"}</b>{latest && <span className={`chip ${latest.status === "approved" ? "c-verified" : latest.status === "rejected" ? "c-rejected" : "c-pending"}`}>{latest.status.replace("_", " ")}</span>}</div>
              {latest && <p className="tiny muted" style={{ margin: "6px 0" }}>Uploaded {latest.createdAt.toLocaleDateString("en-IN")} · {latest.maskedNumber ?? ""}{latest.reviewReason ? ` · Reviewer: ${latest.reviewReason}` : ""}</p>}
              {(!latest || latest.status === "changes_requested" || latest.status === "rejected") && <KycUpload docType={d.type} numberLabel={d.numberLabel} />}
            </section>
          );
        })}
      </div>
    </>
  );
}
