import { getSetting } from "@/server/quotes/service";
import { SITE } from "@/lib/site";
import { t } from "@/server/content";

/** Paragraphs separated by blank lines; a line like "3. Wallet and charges" starts a section. */
function Body({ text }: { text: string }) {
  return <div className="mt16" style={{ lineHeight: 1.75 }}>{text.split(/\n\s*\n/).map((para, i) => {
    const [first, ...rest] = para.split("\n");
    if (/^\d{1,2}\.\s+\S/.test(first)) return <div key={i} style={{ marginTop: 20 }}><h2 style={{ fontSize: 18, margin: "0 0 6px" }}>{first}</h2>{rest.length > 0 && <p style={{ whiteSpace: "pre-wrap", margin: 0 }}>{rest.join("\n")}</p>}</div>;
    return <p key={i} style={{ whiteSpace: "pre-wrap", margin: "12px 0 0" }}>{para}</p>;
  })}</div>;
}

/** Policy text: Admin → Website Content → Policies (published), else an older saved policy_<slug>, else the default. */
export async function PolicyPage({ slug, title }: { slug: "privacy" | "terms" | "refund" | "shipping"; title: string }) {
  const p = await getSetting<{ body: string; updatedAt?: string } | null>(`policy_${slug}`, null);
  const text = p.value?.body?.trim() || (await t(`public.policy.${slug}`));
  return (
    <section className="vs-sec">
      <div className="vs-wrap vs-legal" style={{ maxWidth: 820 }}>
        <span className="vs-eyebrow">POLICY</span>
        <h1 className="vs-h2">{title}</h1>
        {text
          ? <Body text={text} />
          : <p className="muted mt16">This policy is being updated. For questions, contact <a className="link" href={`mailto:${SITE.email}`}>{SITE.email}</a> or call {SITE.phone} ({SITE.hours}).</p>}
      </div>
    </section>
  );
}
