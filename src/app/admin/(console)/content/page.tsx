import Link from "next/link";
import { eq } from "drizzle-orm";
import { revertContent, saveContent } from "@/server/admin/module-actions";
import { can } from "@/server/auth/rbac";
import { requireStaff } from "@/server/auth/session";
import { CONTENT_KEYS, type ContentKey } from "@/server/content";
import { getDb, schema } from "@/server/db/client";

const LOCALES = [{ code: "en", label: "English" }, { code: "hi", label: "हिन्दी (Hindi)" }];

export default async function ContentPage({ searchParams }: { searchParams: Promise<{ locale?: string; ok?: string; err?: string; group?: string }> }) {
  const sp = await searchParams;
  const s = await requireStaff("customers.read");
  const write = can(s.role, "content.write");
  const group = sp.group === "nav" ? "nav" : sp.group === "policies" ? "policies" : "pages";
  const inGroup = (k: string) => (group === "nav" ? k.startsWith("nav.") : group === "policies" ? k.startsWith("public.policy.") : !k.startsWith("nav.") && !k.startsWith("public.policy."));
  const locale = LOCALES.some((l) => l.code === sp.locale) ? sp.locale! : "en";
  const db = await getDb();
  const rows = await db.select().from(schema.contentBlocks).where(eq(schema.contentBlocks.locale, locale));
  return (
    <>
      <div className="page-h"><div><h1>Content</h1><p className="small muted" style={{ margin: "4px 0 0" }}>Customer-facing labels, help text and banners. Save a draft, then publish — published text appears in the portal immediately, no deployment needed. Hindi falls back to English, then to the built-in default.</p></div></div>
      <nav className="tabs">{LOCALES.map((l) => <Link key={l.code} href={`/admin/content/?locale=${l.code}&group=${group}`} className={locale === l.code ? "on" : ""}>{l.label}</Link>)}</nav>
      <nav className="pills mb12" aria-label="Content group"><Link className={group === "pages" ? "pill on" : "pill"} href={`/admin/content/?locale=${locale}&group=pages`}>Page text &amp; support details</Link><Link className={group === "nav" ? "pill on" : "pill"} href={`/admin/content/?locale=${locale}&group=nav`}>Customer sidebar menu (names &amp; order fixed)</Link><Link className={group === "policies" ? "pill on" : "pill"} href={`/admin/content/?locale=${locale}&group=policies`}>Policies (privacy, terms, refund, shipping)</Link></nav>
      {sp.ok && <p className="note small mb12">{sp.ok}</p>}
      {sp.err && <p className="note small mb12 t-debit">{sp.err}</p>}
      <div className="col" style={{ gap: 12 }}>
        {(Object.keys(CONTENT_KEYS) as ContentKey[]).filter(inGroup).map((key) => {
          const row = rows.find((r) => r.key === key);
          const live = row?.published ?? null;
          const hasDraft = row && row.draft !== row.published;
          return (
            <section key={key} id={key} className="card" style={{ padding: 16 }}>
              <div className="row between wrap" style={{ gap: 8 }}>
                <div><b className="small">{CONTENT_KEYS[key].label}</b><div className="tiny muted mono">{key}</div></div>
                <span className="row" style={{ gap: 6 }}>
                  <span className={`chip ${live !== null ? "c-active" : "c-draft"}`}>{live !== null ? "Published" : "Default"}</span>
                  {hasDraft && <span className="chip c-pending">Unpublished draft</span>}
                </span>
              </div>
              <p className="tiny muted" style={{ margin: "6px 0" }}>Live text: {((live ?? CONTENT_KEYS[key].default) || "").slice(0, 240) || <i>(empty — hidden)</i>}{(live ?? CONTENT_KEYS[key].default).length > 240 ? "…" : ""}</p>
              {write ? (
                <div className="row wrap" style={{ gap: 8, alignItems: "end" }}>
                  <form action={saveContent} className="row wrap" style={{ gap: 8, alignItems: "end", flex: 1 }}>
                    <input type="hidden" name="key" value={key} /><input type="hidden" name="locale" value={locale} />
                    <textarea name="draft" className="input" rows={group === "policies" ? 22 : 2} style={{ flex: 1, minWidth: 260, ...(group === "policies" ? { width: "100%", fontFamily: "inherit" } : {}) }} defaultValue={row?.draft ?? live ?? (locale === "en" ? CONTENT_KEYS[key].default : "")} aria-label={`${CONTENT_KEYS[key].label} (${locale})`} maxLength={group === "policies" ? 40000 : 2000} />
                    <button className="btn btn-sm btn-outline">Save draft</button>
                  </form>
                  <form action={saveContent}>
                    <input type="hidden" name="key" value={key} /><input type="hidden" name="locale" value={locale} /><input type="hidden" name="publish" value="1" />
                    <input type="hidden" name="draft" value={row?.draft ?? live ?? CONTENT_KEYS[key].default} />
                    <button className="btn btn-sm btn-orange" disabled={!hasDraft && live !== null}>Publish draft</button>
                  </form>
                  {row && <form action={revertContent}><input type="hidden" name="key" value={key} /><input type="hidden" name="locale" value={locale} /><button className="btn btn-sm btn-outline">Revert to default</button></form>}
                </div>
              ) : <p className="tiny muted">You can view but not edit content.</p>}
              {row?.publishedAt && <p className="tiny muted" style={{ margin: "6px 0 0" }}>Last published {row.publishedAt.toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}</p>}
            </section>
          );
        })}
      </div>
    </>
  );
}
