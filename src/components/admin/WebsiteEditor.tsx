"use client";
import { useState } from "react";
import { PhotoCropper } from "@/components/admin/PhotoCropper";
import { completeMobile, type SectionKey, type SiteContent, type TeamMember } from "@/lib/site-content";

type SecState = { value: unknown; published: boolean; unpublished: boolean; publishedAt: string | null };
type Tab = "home" | "about" | "care" | "office" | "partners" | "links" | "offers" | "calc";
const TABS: Array<[Tab, string]> = [["home", "Home"], ["partners", "Courier carousel"], ["care", "Customer Care & team"], ["office", "Head office & map"], ["about", "About Us"], ["links", "Navigation, links & footer"], ["offers", "Offers & features"], ["calc", "Calculator"]];
const TAB_SECTIONS: Record<Tab, SectionKey[]> = { home: ["home"], about: ["about"], care: ["care", "team"], office: ["office"], partners: ["partners"], links: ["links", "footer"], offers: ["offers", "features"], calc: [] };
const PREVIEW: Record<Tab, string> = { home: "/", about: "/about-us/", care: "/customer-care/", office: "/customer-care/", partners: "/", links: "/", offers: "/shipping-rate-calculator/", calc: "/shipping-rate-calculator/" };

async function upload(file: Blob, name: string): Promise<string> {
  const fd = new FormData();
  fd.append("file", file, name);
  fd.append("name", name);
  const r = await fetch("/api/admin/site/assets/", { method: "POST", body: fd });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j?.error?.message ?? "Upload failed");
  return j.url as string;
}

function Field({ label, value, onChange, area, hint, type = "text" }: { label: string; value: string; onChange: (v: string) => void; area?: boolean; hint?: string; type?: string }) {
  const id = `f-${label.replace(/\W+/g, "-").toLowerCase()}`;
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {area ? <textarea id={id} className="input" rows={3} value={value} onChange={(e) => onChange(e.target.value)} /> : <input id={id} type={type} className="input" value={value} onChange={(e) => onChange(e.target.value)} />}
      {hint && <span className="tiny muted">{hint}</span>}
    </div>
  );
}

function MediaField({ label, value, onChange, accept, hint }: { label: string; value: string; onChange: (v: string) => void; accept: string; hint?: string }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  return (
    <div className="field">
      <label>{label}</label>
      <div className="row wrap" style={{ gap: 10, alignItems: "center" }}>
        {value && (accept.startsWith("video") ? <video src={value} muted style={{ width: 160, borderRadius: 8 }} /> : <img src={value} alt="" style={{ height: 64, maxWidth: 180, objectFit: "contain", borderRadius: 8, border: "1px solid var(--line)" }} />)}
        <label className="btn btn-outline btn-sm" style={{ cursor: "pointer" }}>{busy ? "Uploading…" : value ? "Replace" : "Upload"}
          <input type="file" accept={accept} hidden onChange={async (e) => {
            const f = e.target.files?.[0]; e.target.value = "";
            if (!f) return;
            setBusy(true); setErr("");
            try { onChange(await upload(f, f.name)); } catch (x) { setErr((x as Error).message); } finally { setBusy(false); }
          }} />
        </label>
        {value && <button type="button" className="btn btn-outline btn-sm" onClick={() => onChange("")}>Remove</button>}
      </div>
      <input className="input mono" style={{ marginTop: 6, fontSize: 12 }} value={value} onChange={(e) => onChange(e.target.value)} aria-label={`${label} URL`} />
      {hint && <span className="tiny muted">{hint}</span>}
      {err && <span className="tiny err">{err}</span>}
    </div>
  );
}

export function WebsiteEditor({ initial, thresholdGrams }: { initial: Record<SectionKey, SecState>; thresholdGrams: number }) {
  const [tab, setTab] = useState<Tab>("home");
  const [st, setSt] = useState(initial);
  const [data, setData] = useState<SiteContent>(Object.fromEntries(Object.entries(initial).map(([k, v]) => [k, v.value])) as SiteContent);
  const [dirty, setDirty] = useState<Set<SectionKey>>(new Set());
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [kg, setKg] = useState(String(thresholdGrams / 1000));
  const [crop, setCrop] = useState<{ file: File; memberId: string } | null>(null);

  function upd<S extends SectionKey>(s: S, patch: Partial<SiteContent[S]>) {
    setData((d) => ({ ...d, [s]: { ...d[s], ...patch } }));
    setDirty((x) => new Set(x).add(s));
    setNote(null);
  }
  const team = data.team.members;
  const setTeam = (members: TeamMember[]) => upd("team", { members });
  const setMember = (id: string, patch: Partial<TeamMember>) => setTeam(team.map((m) => (m.id === id ? { ...m, ...patch } : m)));
  const move = <T,>(arr: T[], i: number, d: number) => { const a = [...arr]; const j = i + d; if (j < 0 || j >= a.length) return a; [a[i], a[j]] = [a[j], a[i]]; return a; };

  async function save(publish: boolean) {
    const secs = TAB_SECTIONS[tab];
    setBusy(true); setNote(null);
    try {
      for (const s of secs) {
        const r = await fetch("/api/admin/site/", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ op: "save", section: s, data: data[s], publish }) });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(`${s}: ${j?.error?.message ?? r.status}`);
        setSt((x) => ({ ...x, [s]: { ...x[s], published: x[s].published || publish, unpublished: !publish, publishedAt: publish ? new Date().toISOString() : x[s].publishedAt } }));
      }
      setDirty((x) => { const n = new Set(x); secs.forEach((s) => n.delete(s)); return n; });
      setNote({ ok: true, text: publish ? "Published — the public page now shows these changes." : "Draft saved. Use Preview to check it, then Publish." });
    } catch (e) { setNote({ ok: false, text: (e as Error).message }); } finally { setBusy(false); }
  }
  async function saveThreshold() {
    setBusy(true); setNote(null);
    try {
      const r = await fetch("/api/admin/site/", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ op: "threshold", kg: Number(kg) }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j?.error?.message ?? "Could not save");
      setNote({ ok: true, text: `Saved: under ${Number(kg)} kg → B2C, ${Number(kg)} kg or more → B2B (calculator and Create Shipment).` });
    } catch (e) { setNote({ ok: false, text: (e as Error).message }); } finally { setBusy(false); }
  }

  const secs = TAB_SECTIONS[tab];
  const status = secs.map((s) => st[s]);
  const h = data.home;
  return (
    <>
      <nav className="tabs" aria-label="Website sections">{TABS.map(([k, l]) => <button key={k} type="button" className={tab === k ? "on" : ""} onClick={() => { setTab(k); setNote(null); }} style={{ background: "none", border: 0, cursor: "pointer", font: "inherit" }}>{l}{TAB_SECTIONS[k].some((s) => dirty.has(s)) ? " •" : ""}</button>)}</nav>

      {secs.length > 0 && (
        <div className="card row wrap between mb12" style={{ padding: 12, gap: 10, position: "sticky", top: 8, zIndex: 5 }}>
          <span className="small">
            {status.some((s) => s.unpublished) || secs.some((s) => dirty.has(s)) ? <span className="chip c-pending">Unpublished changes</span> : status.every((s) => s.published) ? <span className="chip c-active">Published</span> : <span className="chip c-draft">Using defaults</span>}
            {secs.some((s) => dirty.has(s)) && <span className="tiny muted" style={{ marginLeft: 8 }}>Not saved yet</span>}
          </span>
          <span className="row wrap" style={{ gap: 8 }}>
            <button type="button" className="btn btn-outline btn-sm" disabled={busy} onClick={() => save(false)}>Save draft</button>
            <a className="btn btn-outline btn-sm" href={`${PREVIEW[tab]}?preview=1`} target="_blank" rel="noopener noreferrer">Preview draft ↗</a>
            <button type="button" className="btn btn-orange btn-sm" disabled={busy} onClick={() => save(true)}>Publish</button>
          </span>
        </div>
      )}
      {note && <p className={`note small mb12 ${note.ok ? "" : "t-debit"}`} role="status">{note.text}</p>}

      {tab === "home" && (
        <div className="col" style={{ gap: 14 }}>
          <section className="card" style={{ padding: 16 }}><h2 className="small b">Hero</h2>
            <div className="split" style={{ gap: 12 }}><Field label="Slogan line 1" value={h.heroLine1} onChange={(v) => upd("home", { heroLine1: v })} /><Field label="Slogan line 2 (orange)" value={h.heroLine2} onChange={(v) => upd("home", { heroLine2: v })} /></div>
            <Field label="Supporting text" area value={h.heroText} onChange={(v) => upd("home", { heroText: v })} />
            <div className="split" style={{ gap: 12 }}><Field label="Primary button (→ Rate Calculator)" value={h.primaryCta} onChange={(v) => upd("home", { primaryCta: v })} /><Field label="Create Account button" value={h.secondaryCta} onChange={(v) => upd("home", { secondaryCta: v })} /></div>
            <div className="split" style={{ gap: 12 }}><Field label="Login button (returning visitors)" value={h.loginCta} onChange={(v) => upd("home", { loginCta: v })} /><Field label="Dashboard button (signed-in customers)" value={h.dashboardCta} onChange={(v) => upd("home", { dashboardCta: v })} /></div>
            <Field label="Track box heading (hero)" value={h.trackHeading} onChange={(v) => upd("home", { trackHeading: v })} />
            <MediaField label="Hero background video (optional; MP4/WebM, muted, max 20 MB)" accept="video/mp4,video/webm" value={h.heroVideoUrl} onChange={(v) => upd("home", { heroVideoUrl: v })} hint="Keep it short (10–20 s) and compressed. Visitors with reduced motion or data saver see the poster." />
            <MediaField label="Hero background — desktop (wide)" accept="image/png,image/jpeg,image/webp" value={h.heroPosterUrl} onChange={(v) => upd("home", { heroPosterUrl: v })} hint="About 1920×800 WebP/JPG under 400 KB. Keep the truck/warehouse on the right; the left is washed white behind the text." />
            <MediaField label="Hero background — phone (portrait)" accept="image/png,image/jpeg,image/webp" value={h.heroMobileUrl} onChange={(v) => upd("home", { heroMobileUrl: v })} hint="About 780×1100. Light/empty at the top (behind the text), subject in the lower half." />
            <Field label="Offer line under the buttons" value={h.offerLine} onChange={(v) => upd("home", { offerLine: v })} hint="Separate items with • — e.g. COD Available • Parcels from ₹28 • Cargo from ₹8/kg. Hidden when Offers are switched off for Home." />
          </section>
          <section className="card" style={{ padding: 16 }}><h2 className="small b">Sections</h2>
            <Field label="Courier carousel heading" value={h.partnersHeading} onChange={(v) => upd("home", { partnersHeading: v })} />
            <Field label="Services heading" value={h.servicesHeading} onChange={(v) => upd("home", { servicesHeading: v })} />
            <div className="split" style={{ gap: 12 }}><Field label="B2C card title" value={h.b2cTitle} onChange={(v) => upd("home", { b2cTitle: v })} /><Field label="B2B card title" value={h.b2bTitle} onChange={(v) => upd("home", { b2bTitle: v })} /></div>
            <div className="split" style={{ gap: 12 }}><Field label="B2C card text" area value={h.b2cText} onChange={(v) => upd("home", { b2cText: v })} /><Field label="B2B card text" area value={h.b2bText} onChange={(v) => upd("home", { b2bText: v })} /></div>
            <Field label="Calculator heading" value={h.calcHeading} onChange={(v) => upd("home", { calcHeading: v })} />
            <Field label="Calculator text" area value={h.calcText} onChange={(v) => upd("home", { calcText: v })} />
            <Field label="Journey heading" value={h.journeyHeading} onChange={(v) => upd("home", { journeyHeading: v })} />
            <Field label="Features heading" value={h.featuresHeading} onChange={(v) => upd("home", { featuresHeading: v })} />
            <Field label="Customer care heading" value={h.careHeading} onChange={(v) => upd("home", { careHeading: v })} />
            <Field label="Customer care text" area value={h.careText} onChange={(v) => upd("home", { careText: v })} />
            <Field label="Final call-to-action title" value={h.ctaTitle} onChange={(v) => upd("home", { ctaTitle: v })} />
            <Field label="Final call-to-action text" area value={h.ctaText} onChange={(v) => upd("home", { ctaText: v })} />
          </section>
        </div>
      )}

      {tab === "partners" && (
        <section className="card" style={{ padding: 16 }}>
          <p className="small muted" style={{ marginTop: 0 }}>Shared by the Home and Rate Calculator carousels. The original logos are always kept — hide one instead of deleting it. The ID is the courier code used to show logos next to calculator results.</p>
          <div className="col" style={{ gap: 10 }}>
            {data.partners.items.map((p, i) => (
              <div key={p.id} className="row wrap" style={{ gap: 10, alignItems: "end", borderBottom: "1px solid var(--line)", paddingBottom: 10 }}>
                <div style={{ width: 120, height: 52, border: "1px solid var(--line)", borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center", padding: 4, background: "#fff", opacity: p.visible ? 1 : 0.4 }}>{p.logoUrl ? <img src={p.logoUrl} alt="" style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }} /> : <span className="tiny muted">No logo</span>}</div>
                <div className="field" style={{ flex: "1 1 140px" }}><label>Name</label><input className="input" value={p.name} onChange={(e) => upd("partners", { items: data.partners.items.map((x) => (x.id === p.id ? { ...x, name: e.target.value } : x)) })} /><span className="tiny muted mono">{p.id}</span></div>
                <div className="field" style={{ flex: "2 1 220px" }}><label>Link (optional, https://…)</label><input className="input" value={p.link} placeholder="https://" onChange={(e) => upd("partners", { items: data.partners.items.map((x) => (x.id === p.id ? { ...x, link: e.target.value } : x)) })} /></div>
                <label className="btn btn-outline btn-sm" style={{ cursor: "pointer" }}>Logo<input type="file" hidden accept="image/png,image/jpeg,image/webp" onChange={async (e) => { const f = e.target.files?.[0]; e.target.value = ""; if (!f) return; try { const u = await upload(f, f.name); upd("partners", { items: data.partners.items.map((x) => (x.id === p.id ? { ...x, logoUrl: u } : x)) }); } catch (x) { setNote({ ok: false, text: (x as Error).message }); } }} /></label>
                <label className="small row" style={{ gap: 6, alignItems: "center", minHeight: 36 }}><input type="checkbox" checked={p.visible} onChange={(e) => upd("partners", { items: data.partners.items.map((x) => (x.id === p.id ? { ...x, visible: e.target.checked } : x)) })} />Visible</label>
                <span className="row" style={{ gap: 4 }}>
                  <button type="button" className="btn btn-outline btn-sm" aria-label={`Move ${p.name} up`} disabled={i === 0} onClick={() => upd("partners", { items: move(data.partners.items, i, -1) })}>↑</button>
                  <button type="button" className="btn btn-outline btn-sm" aria-label={`Move ${p.name} down`} disabled={i === data.partners.items.length - 1} onClick={() => upd("partners", { items: move(data.partners.items, i, 1) })}>↓</button>
                </span>
              </div>
            ))}
          </div>
          <AddPartner onAdd={(id, name) => {
            if (data.partners.items.some((x) => x.id === id)) { setNote({ ok: false, text: `A partner with ID "${id}" already exists` }); return; }
            upd("partners", { items: [...data.partners.items, { id, name, logoUrl: "", link: "", visible: true }] });
          }} />
        </section>
      )}

      {tab === "care" && (
        <div className="col" style={{ gap: 14 }}>
          <section className="card" style={{ padding: 16 }}>
            <Field label="Page heading" value={data.care.heading} onChange={(v) => upd("care", { heading: v })} />
            <Field label="Supporting copy" area value={data.care.intro} onChange={(v) => upd("care", { intro: v })} />
            <Field label="Office section heading" value={data.care.officeHeading} onChange={(v) => upd("care", { officeHeading: v })} />
          </section>
          {team.map((m, i) => {
            const ok = completeMobile(m.phone);
            return (
              <section key={m.id} className="card" style={{ padding: 16 }}>
                <div className="row wrap between" style={{ gap: 8 }}>
                  <b className="small">{m.region || "New"} — {m.name || "Unnamed"}</b>
                  <span className="row wrap" style={{ gap: 6 }}>
                    {ok ? <span className="chip c-active">Contact buttons live</span> : <span className="chip c-pending">Draft: number incomplete — no contact buttons</span>}
                    {!m.visible && <span className="chip c-draft">Hidden</span>}
                  </span>
                </div>
                <div className="row wrap" style={{ gap: 14, alignItems: "flex-start", marginTop: 10 }}>
                  <div style={{ textAlign: "center" }}>
                    <div style={{ width: 88, height: 88, borderRadius: "50%", overflow: "hidden", background: "#0b1f3a", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: 26 }}>{m.photoUrl ? <img src={m.photoUrl} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : m.name.split(" ").map((w) => w[0]).join("").slice(0, 2)}</div>
                    <label className="btn btn-outline btn-sm" style={{ cursor: "pointer", marginTop: 8 }}>Photo<input type="file" hidden accept="image/png,image/jpeg,image/webp" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) setCrop({ file: f, memberId: m.id }); }} /></label>
                    {m.photoUrl && <button type="button" className="btn btn-outline btn-sm" style={{ marginTop: 4 }} onClick={() => setMember(m.id, { photoUrl: "" })}>Remove</button>}
                  </div>
                  <div style={{ flex: 1, minWidth: 240 }}>
                    <div className="split" style={{ gap: 10 }}><Field label="Name" value={m.name} onChange={(v) => setMember(m.id, { name: v })} /><Field label="Region" value={m.region} onChange={(v) => setMember(m.id, { region: v })} /></div>
                    <Field label="Role" value={m.role} onChange={(v) => setMember(m.id, { role: v })} />
                    <div className="split" style={{ gap: 10 }}>
                      <Field label="Mobile (10 digits)" value={m.phone} onChange={(v) => setMember(m.id, { phone: v })} hint={ok ? `Call button: +91 ${ok}` : "Incomplete — kept as a draft"} />
                      <Field label="WhatsApp (10 digits, optional)" value={m.whatsapp} onChange={(v) => setMember(m.id, { whatsapp: v })} hint={completeMobile(m.whatsapp) ? `wa.me/91${completeMobile(m.whatsapp)}` : "No WhatsApp button"} />
                    </div>
                    <Field label="Admin note (not shown publicly)" value={m.note} onChange={(v) => setMember(m.id, { note: v })} />
                    <div className="row wrap" style={{ gap: 12, alignItems: "center", marginTop: 6 }}>
                      <label className="small row" style={{ gap: 6 }}><input type="checkbox" checked={m.visible} onChange={(e) => setMember(m.id, { visible: e.target.checked })} />Visible</label>
                      <label className="small row" style={{ gap: 6 }}><input type="checkbox" checked={m.featured} onChange={(e) => setMember(m.id, { featured: e.target.checked })} />Featured (large card first)</label>
                      <button type="button" className="btn btn-outline btn-sm" disabled={i === 0} onClick={() => setTeam(move(team, i, -1))}>↑ Up</button>
                      <button type="button" className="btn btn-outline btn-sm" disabled={i === team.length - 1} onClick={() => setTeam(move(team, i, 1))}>↓ Down</button>
                      <button type="button" className="btn btn-outline btn-sm" onClick={() => { if (confirm(`Remove ${m.name || "this member"} from the team list? (Publish to apply.)`)) setTeam(team.filter((x) => x.id !== m.id)); }}>Remove</button>
                    </div>
                  </div>
                </div>
              </section>
            );
          })}
          <button type="button" className="btn btn-outline" onClick={() => setTeam([...team, { id: `m-${Date.now().toString(36)}`, name: "", role: "", region: "", phone: "", whatsapp: "", photoUrl: "", featured: false, visible: false, note: "" }])}>+ Add team member</button>
        </div>
      )}

      {tab === "office" && (
        <section className="card" style={{ padding: 16 }}>
          <Field label="Office name" value={data.office.name} onChange={(v) => upd("office", { name: v })} />
          <Field label="Address (one line per row)" area value={data.office.lines.join("\n")} onChange={(v) => upd("office", { lines: v.split("\n").slice(0, 6).length ? v.split("\n").slice(0, 6) : [""] })} />
          <Field label="Map search text (used until coordinates are set)" value={data.office.mapQuery} onChange={(v) => upd("office", { mapQuery: v })} />
          <div className="split" style={{ gap: 10 }}><Field label="Latitude (exact pin, optional)" value={data.office.lat} onChange={(v) => upd("office", { lat: v })} hint="e.g. 29.9457" /><Field label="Longitude" value={data.office.lng} onChange={(v) => upd("office", { lng: v })} hint="e.g. 78.0642" /></div>
          <Field label="Google Maps link for “Open in Google Maps” (optional)" value={data.office.mapUrl} onChange={(v) => upd("office", { mapUrl: v })} hint="Paste the share link from Google Maps once the office pin is created. Empty = search link." />
        </section>
      )}

      {tab === "about" && (
        <section className="card" style={{ padding: 16 }}>
          <Field label="Heading" value={data.about.heading} onChange={(v) => upd("about", { heading: v })} />
          <Field label="Intro" value={data.about.intro} onChange={(v) => upd("about", { intro: v })} />
          {data.about.paragraphs.map((p, i) => <Field key={i} label={`Paragraph ${i + 1}`} area value={p} onChange={(v) => upd("about", { paragraphs: data.about.paragraphs.map((x, j) => (j === i ? v : x)) })} />)}
          <div className="row" style={{ gap: 8 }}>
            {data.about.paragraphs.length < 8 && <button type="button" className="btn btn-outline btn-sm" onClick={() => upd("about", { paragraphs: [...data.about.paragraphs, ""] })}>+ Paragraph</button>}
            {data.about.paragraphs.length > 1 && <button type="button" className="btn btn-outline btn-sm" onClick={() => upd("about", { paragraphs: data.about.paragraphs.slice(0, -1) })}>Remove last paragraph</button>}
          </div>
          <MediaField label="Header image" accept="image/png,image/jpeg,image/webp" value={data.about.imageUrl} onChange={(v) => upd("about", { imageUrl: v })} />
          <Field label="Closing text (under the slogan)" value={data.about.closingText} onChange={(v) => upd("about", { closingText: v })} />
        </section>
      )}

      {tab === "links" && (
        <div className="col" style={{ gap: 14 }}>
          <section className="card" style={{ padding: 16 }}><h2 className="small b">Account links (header &amp; footer)</h2>
            <Field label="Customer Login / Login" value={data.links.customerLogin} onChange={(v) => upd("links", { customerLogin: v })} hint="Confirmed: https://vishwaship.in/login/" />
            <Field label="Sign Up / Create Account" value={data.links.signUp} onChange={(v) => upd("links", { signUp: v })} hint="Confirmed: https://vishwaship.in/signup/" />
            <Field label="Admin / Franchise Login" value={data.links.franchiseLogin} onChange={(v) => upd("links", { franchiseLogin: v })} hint="Confirmed: https://vishwaship.in/admin/login/" />
          </section>
          <section className="card" style={{ padding: 16 }}><h2 className="small b">Footer &amp; support details</h2>
            <Field label="Tagline" value={data.footer.tagline} onChange={(v) => upd("footer", { tagline: v })} />
            <div className="split" style={{ gap: 10 }}><Field label="Phone" value={data.footer.phone} onChange={(v) => upd("footer", { phone: v })} /><Field label="Email" value={data.footer.email} onChange={(v) => upd("footer", { email: v })} /></div>
            <Field label="Support hours" value={data.footer.hours} onChange={(v) => upd("footer", { hours: v })} />
          </section>
        </div>
      )}

      {tab === "offers" && (
        <div className="col" style={{ gap: 14 }}>
          <section className="card" style={{ padding: 16 }}><h2 className="small b">Starting-price offers</h2>
            <p className="small muted">Shown as highlights only. Rate cards always show the live calculated price for the entered shipment.</p>
            <label className="check"><input type="checkbox" checked={data.offers.visible} onChange={(e) => upd("offers", { visible: e.target.checked })} /> Show offers</label>
            <div className="row wrap" style={{ gap: 16, margin: "8px 0" }}>
              <label className="check"><input type="checkbox" checked={data.offers.showOnHome} onChange={(e) => upd("offers", { showOnHome: e.target.checked })} /> Home page</label>
              <label className="check"><input type="checkbox" checked={data.offers.showOnCalculator} onChange={(e) => upd("offers", { showOnCalculator: e.target.checked })} /> Rate Calculator</label>
              <label className="check"><input type="checkbox" checked={data.offers.showOnDashboard} onChange={(e) => upd("offers", { showOnDashboard: e.target.checked })} /> Customer Dashboard</label>
            </div>
            <Field label="COD message" value={data.offers.codText} onChange={(v) => upd("offers", { codText: v })} hint="Leave empty to hide this item." />
            <div className="split" style={{ gap: 12 }}><Field label="Parcel text" value={data.offers.parcelLabel} onChange={(v) => upd("offers", { parcelLabel: v })} /><Field label="Parcel starting price" value={data.offers.parcelPrice} onChange={(v) => upd("offers", { parcelPrice: v })} /></div>
            <div className="split" style={{ gap: 12 }}><Field label="Cargo text" value={data.offers.cargoLabel} onChange={(v) => upd("offers", { cargoLabel: v })} /><Field label="Cargo starting price" value={data.offers.cargoPrice} onChange={(v) => upd("offers", { cargoPrice: v })} /></div>
            <Field label="Supporting text" area value={data.offers.note} onChange={(v) => upd("offers", { note: v })} />
          </section>
          <section className="card" style={{ padding: 16 }}><h2 className="small b">Public features</h2>
            <label className="check"><input type="checkbox" checked={data.features.calculator} onChange={(e) => upd("features", { calculator: e.target.checked })} /> Rate Calculator available to visitors</label>
            <label className="check"><input type="checkbox" checked={data.features.tracking} onChange={(e) => upd("features", { tracking: e.target.checked })} /> Public Track Shipment available</label>
            <Field label="Message when a feature is switched off" value={data.features.unavailableText} onChange={(v) => upd("features", { unavailableText: v })} />
          </section>
        </div>
      )}

      {tab === "calc" && (
        <section className="card" style={{ padding: 16 }}>
          <h2 className="small b">Automatic B2C / B2B selection</h2>
          <p className="small muted">Total actual shipment weight below this value selects B2C; this value or more selects B2B. Used by the public Rate Calculator and the customer Create Shipment screen. Saved immediately (no publish step).</p>
          <div className="row wrap" style={{ gap: 10, alignItems: "end" }}>
            <Field label="Threshold (kg)" type="number" value={kg} onChange={setKg} />
            <button type="button" className="btn btn-orange btn-sm" disabled={busy || !(Number(kg) >= 0.5)} onClick={saveThreshold}>Save threshold</button>
          </div>
          <p className="small muted">Pricing (margins, the 25% Delhivery B2B markup, customer-specific rates) is managed in Admin → Pricing and Delhivery Direct.</p>
        </section>
      )}

      {crop && <PhotoCropper file={crop.file} onCancel={() => setCrop(null)} onDone={async (blob) => {
        const id = crop.memberId; setCrop(null); setBusy(true);
        try { const u = await upload(blob, `team-${id}.jpg`); setMember(id, { photoUrl: u }); setNote({ ok: true, text: "Photo uploaded — Save draft or Publish to apply." }); }
        catch (e) { setNote({ ok: false, text: (e as Error).message }); } finally { setBusy(false); }
      }} />}
    </>
  );
}

function AddPartner({ onAdd }: { onAdd: (id: string, name: string) => void }) {
  const [name, setName] = useState("");
  const id = name.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
  return (
    <div className="row wrap" style={{ gap: 8, alignItems: "end", marginTop: 14 }}>
      <div className="field" style={{ flex: 1, minWidth: 200 }}><label htmlFor="np">Add a partner</label><input id="np" className="input" placeholder="Courier name" value={name} onChange={(e) => setName(e.target.value)} />{id && <span className="tiny muted mono">ID: {id}</span>}</div>
      <button type="button" className="btn btn-outline btn-sm" disabled={!id} onClick={() => { onAdd(id, name.trim()); setName(""); }}>+ Add</button>
    </div>
  );
}
