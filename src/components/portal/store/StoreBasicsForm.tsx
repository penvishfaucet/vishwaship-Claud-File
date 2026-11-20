"use client";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { slugify } from "@/lib/store-themes";
import { Msg, api } from "./ui";

/** Onboarding step 1: store name + URL. Creates the store the first time. */
export function StoreBasicsForm({ initial, appUrl, exists }: { initial: { name: string; slug: string }; appUrl: string; exists: boolean }) {
  const router = useRouter();
  const [name, setName] = useState(initial.name);
  const [slug, setSlug] = useState(initial.slug);
  const [touched, setTouched] = useState(exists);
  const [check, setCheck] = useState<{ ok: boolean; message: string | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok?: string; err?: string } | null>(null);

  useEffect(() => { if (!touched) setSlug(slugify(name)); }, [name, touched]);
  useEffect(() => {
    if (slug.length < 3) { setCheck(null); return; }
    const t = setTimeout(async () => {
      const r = await api<{ ok: boolean; message: string | null }>("GET", `/api/portal/store?slug=${encodeURIComponent(slug)}`);
      if (r.ok) setCheck(r.data);
    }, 350);
    return () => clearTimeout(t);
  }, [slug]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setMsg(null);
    const r = await api(exists ? "PATCH" : "POST", "/api/portal/store", { name, slug });
    setBusy(false);
    if (!r.ok) { setMsg({ err: r.error }); return; }
    router.push("/portal/store/setup/2/");
    router.refresh();
  }

  return (
    <form className="card" style={{ padding: 20, maxWidth: 640 }} onSubmit={submit}>
      <div className="field"><label htmlFor="sname">Store name <span className="req">*</span></label>
        <input id="sname" className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} required placeholder="e.g. Asha Handlooms" /></div>
      <div className="field" style={{ marginTop: 14 }}><label htmlFor="sslug">Store link <span className="req">*</span></label>
        <input id="sslug" className="input" value={slug}
          onChange={(e) => { setTouched(true); setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "")); }} maxLength={40} required aria-describedby="slugurl slughelp" aria-invalid={check ? !check.ok : undefined} />
        <span id="slugurl" className="small" style={{ wordBreak: "break-all" }}>{appUrl.replace(/^https?:\/\//, "")}/s/<b>{slug || "your-store"}</b>/</span>
        <span id="slughelp" className="small" style={{ color: check && !check.ok ? "var(--red)" : check?.ok ? "var(--green)" : "var(--muted)" }} aria-live="polite">
          {check ? (check.ok ? "This link is available" : check.message) : "Lowercase letters, numbers and hyphens. You can connect your own domain later."}
        </span>
      </div>
      <Msg m={msg} />
      <div className="row" style={{ marginTop: 18, gap: 8 }}>
        <button className="btn btn-orange" disabled={busy || !name.trim() || (check !== null && !check.ok)}>{busy ? "Saving…" : exists ? "Save & continue" : "Create store & continue"}</button>
      </div>
    </form>
  );
}
