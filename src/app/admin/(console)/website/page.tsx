import { WebsiteEditor } from "@/components/admin/WebsiteEditor";
import { can } from "@/server/auth/rbac";
import { requireStaff } from "@/server/auth/session";
import { b2bThresholdGrams, getEditorState } from "@/server/site/content";

export const dynamic = "force-dynamic";

export default async function WebsiteContentPage() {
  const s = await requireStaff("customers.read");
  const write = can(s.role, "content.write");
  return (
    <>
      <div className="page-h"><div><h1>Website Content</h1><p className="small muted" style={{ margin: "4px 0 0" }}>Home, Rate Calculator, Customer Care and About Us. Save a draft, preview it (only you see drafts), then publish. Uploaded images and videos are stored in the database and survive redeploys.</p></div></div>
      {write ? <WebsiteEditor initial={await getEditorState()} thresholdGrams={await b2bThresholdGrams()} /> : <p className="note small">You can view the website, but your role cannot edit its content.</p>}
    </>
  );
}
