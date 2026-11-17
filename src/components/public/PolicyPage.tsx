import { getSetting } from "@/server/quotes/service";
import { SITE } from "@/lib/site";

/** Policy text is owner-managed content (settings key policy_<slug>); never invented here. */
export async function PolicyPage({ slug, title }: { slug: string; title: string }) {
  const p = await getSetting<{ body: string; updatedAt?: string } | null>(`policy_${slug}`, null);
  return (
    <section className="vs-sec">
      <div className="vs-wrap vs-legal" style={{ maxWidth: 820 }}>
        <span className="vs-eyebrow">POLICY</span>
        <h1 className="vs-h2">{title}</h1>
        {p.value?.body
          ? <div className="mt16" style={{ whiteSpace: "pre-wrap", lineHeight: 1.75 }}>{p.value.body}</div>
          : <p className="muted mt16">This policy is being updated. For questions, contact <a className="link" href={`mailto:${SITE.email}`}>{SITE.email}</a> or call {SITE.phone} ({SITE.hours}).</p>}
      </div>
    </section>
  );
}
