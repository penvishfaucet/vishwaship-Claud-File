"use client";
import { ChevronDown, ChevronUp, Eye, EyeOff, Monitor, Plus, RotateCcw, Smartphone, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import {
  FONT_CHOICES, SECTION_FIELDS, SECTION_LABEL, SECTION_TYPES, THEMES, type SectionType, type StoreSection, type ThemeConfig, defaultTheme,
} from "@/lib/store-themes";
import { ImageUpload, Msg, api, mediaSrc } from "./ui";

type Version = { id: string; version: number; themeKey: string; createdAt: string; note: string | null };
type Props = {
  initial: { themeKey: string; config: ThemeConfig };
  slug: string;
  mode: "step" | "full";
  status?: { status: string; publishedAt: string | null; customDesign: boolean; hasUnpublished: boolean };
  versions?: Version[];
};

const COLOR_LABEL: Record<keyof ThemeConfig["colors"], string> = { primary: "Buttons & highlights", accent: "Accent", background: "Background", text: "Text" };

export function ThemeEditor({ initial, slug, mode, status, versions = [] }: Props) {
  const router = useRouter();
  const [themeKey, setThemeKey] = useState(initial.themeKey);
  const [c, setC] = useState<ThemeConfig>(initial.config);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok?: string; err?: string } | null>(null);
  const [device, setDevice] = useState<"desktop" | "mobile">("desktop");
  const [open, setOpen] = useState<string | null>(null);
  const [frameKey, setFrameKey] = useState(0);
  const [restoreId, setRestoreId] = useState("");
  const locked = !!status?.customDesign;
  const frame = useRef<HTMLIFrameElement>(null);

  const upd = (next: ThemeConfig) => { setC(next); setDirty(true); };
  const setSection = (id: string, patch: Partial<StoreSection>) => upd({ ...c, sections: c.sections.map((s) => (s.id === id ? { ...s, ...patch } : s)) });
  const move = (i: number, d: -1 | 1) => { const a = [...c.sections]; const j = i + d; if (j < 0 || j >= a.length) return; [a[i], a[j]] = [a[j], a[i]]; upd({ ...c, sections: a }); };

  function pickTheme(key: string) {
    if (locked || key === themeKey) return;
    if (dirty && !confirm("Switch theme? Colours, fonts and sections will change to the new theme. Your logo stays.")) return;
    const d = defaultTheme(key);
    setThemeKey(key); upd({ ...d, logo: c.logo });
  }

  async function save(completeStep = false) {
    setBusy("save"); setMsg(null);
    const r = await api("PUT", "/api/portal/store/theme", { themeKey, config: c, completeStep });
    setBusy(null);
    if (!r.ok) { setMsg({ err: r.error }); return false; }
    setDirty(false); setFrameKey((k) => k + 1);
    if (!completeStep) setMsg({ ok: "Draft saved. Buyers see changes only after you publish." });
    router.refresh();
    return true;
  }

  async function act(action: "publish" | "unpublish" | "restore") {
    if (action === "publish" && dirty && !(await save())) return;
    if (action === "restore" && !restoreId) return;
    if (action === "restore" && dirty && !confirm("Restoring replaces your unsaved changes. Continue?")) return;
    setBusy(action); setMsg(null);
    const r = await api<{ version?: number }>("POST", "/api/portal/store/theme", { action, versionId: restoreId || undefined });
    setBusy(null);
    if (!r.ok) { setMsg({ err: r.error }); return; }
    if (action === "restore") { setMsg({ ok: `Version ${r.data.version} copied into your draft. Publish to make it live.` }); window.location.reload(); return; }
    setMsg({ ok: action === "publish" ? `Published (version ${r.data.version}). Your store is live.` : "Store unpublished. Buyers can't open it now." });
    setFrameKey((k) => k + 1); router.refresh();
  }

  async function continueStep() {
    if (await save(true)) { router.push("/portal/store/setup/3/"); router.refresh(); }
  }

  const themePicker = (
    <div className="os-theme-grid" role="radiogroup" aria-label="Theme">
      {THEMES.map((t) => (
        <button key={t.key} type="button" role="radio" aria-checked={t.key === themeKey} className={`os-theme${t.key === themeKey ? " on" : ""}`} onClick={() => pickTheme(t.key)} disabled={locked && t.key !== themeKey}>
          <b>{t.name}</b>
          <div className="sw">{Object.entries(t.config.colors).map(([k, col]) => <span key={k} style={{ background: col }} />)}</div>
          <span className="small muted">{t.tagline}</span>
        </button>
      ))}
    </div>
  );

  const brand = (
    <>
      <div className="field"><label>Logo</label>
        <div className="row" style={{ gap: 10, alignItems: "center" }}>
          {c.logo && <img src={mediaSrc(c.logo)} alt="Store logo" style={{ height: 44, maxWidth: 160, objectFit: "contain", border: "1px solid var(--line)", borderRadius: 8, padding: 4, background: "#fff" }} />}
          <ImageUpload label={c.logo ? "Change logo" : "Upload logo"} onDone={(id) => upd({ ...c, logo: id })} />
          {c.logo && <button type="button" className="link small" onClick={() => upd({ ...c, logo: null })}>Remove</button>}
        </div>
        <span className="small muted">PNG with transparent background works best. Under 1.5 MB.</span>
      </div>
      <div className="grid2" style={{ marginTop: 12 }}>
        {(Object.keys(COLOR_LABEL) as Array<keyof ThemeConfig["colors"]>).map((k) => (
          <div className="field" key={k}><label htmlFor={`col-${k}`}>{COLOR_LABEL[k]}</label>
            <div className="row" style={{ gap: 6 }}>
              <input id={`col-${k}`} type="color" value={c.colors[k]} onChange={(e) => upd({ ...c, colors: { ...c.colors, [k]: e.target.value } })} style={{ width: 44, height: 36, border: 0, background: "none", padding: 0 }} />
              <input className="input" value={c.colors[k]} aria-label={`${COLOR_LABEL[k]} hex`} onChange={(e) => /^#[0-9a-fA-F]{0,6}$/.test(e.target.value) && upd({ ...c, colors: { ...c.colors, [k]: e.target.value } })} style={{ flex: 1, minWidth: 0 }} />
            </div>
          </div>
        ))}
        <div className="field"><label htmlFor="fh">Heading font</label>
          <select id="fh" className="input select" value={c.fonts.heading} onChange={(e) => upd({ ...c, fonts: { ...c.fonts, heading: e.target.value as ThemeConfig["fonts"]["heading"] } })}>{FONT_CHOICES.map((f) => <option key={f}>{f}</option>)}</select></div>
        <div className="field"><label htmlFor="fb">Body font</label>
          <select id="fb" className="input select" value={c.fonts.body} onChange={(e) => upd({ ...c, fonts: { ...c.fonts, body: e.target.value as ThemeConfig["fonts"]["body"] } })}>{FONT_CHOICES.map((f) => <option key={f}>{f}</option>)}</select></div>
        <div className="field"><label htmlFor="rad">Corners</label>
          <select id="rad" className="input select" value={c.radius} onChange={(e) => upd({ ...c, radius: e.target.value as ThemeConfig["radius"] })}><option value="none">Square</option><option value="soft">Soft</option><option value="round">Round</option></select></div>
      </div>
    </>
  );

  if (mode === "step") {
    return (
      <div className="card" style={{ padding: 20, maxWidth: 860 }}>
        <h3 style={{ marginBottom: 10 }}>Choose a theme</h3>
        {locked && <p className="small muted">Your store uses a custom design set up by Vishwaship.</p>}
        {themePicker}
        <h3 style={{ margin: "20px 0 10px" }}>Logo, colours & fonts</h3>
        {brand}
        <Msg m={msg} />
        <div className="row" style={{ marginTop: 18, gap: 8, flexWrap: "wrap" }}>
          <button className="btn btn-orange" onClick={continueStep} disabled={!!busy}>{busy ? "Saving…" : "Save & continue"}</button>
          <a className="btn btn-outline" href="/portal/store/theme/">Open full theme editor</a>
        </div>
      </div>
    );
  }

  const addable = SECTION_TYPES.filter((t) => t !== "announcement" || !c.sections.some((s) => s.type === "announcement"));
  return (
    <>
      <div className="card mb12" style={{ padding: 12 }}>
        <div className="row between wrap" style={{ gap: 8 }}>
          <div className="row wrap" style={{ gap: 8, alignItems: "center" }}>
            <span className={`chip ${status?.status === "live" ? "c-active" : status?.status === "suspended" ? "c-cancelled" : "c-draft"}`}>{status?.status === "live" ? "Live" : status?.status === "suspended" ? "Paused by Vishwaship" : status?.status === "paused" ? "Unpublished" : "Draft"}</span>
            {(dirty || status?.hasUnpublished) && <span className="tiny" style={{ color: "var(--orange)" }}>Unpublished changes</span>}
            {status?.publishedAt && <span className="tiny muted">Last published {new Date(status.publishedAt).toLocaleString("en-IN")}</span>}
          </div>
          <div className="row wrap" style={{ gap: 6 }}>
            <div className="row" role="group" aria-label="Preview size" style={{ gap: 2 }}>
              <button className={`btn btn-sm ${device === "desktop" ? "btn-navy" : "btn-outline"}`} onClick={() => setDevice("desktop")} aria-pressed={device === "desktop"}><Monitor size={14} aria-hidden /> Desktop</button>
              <button className={`btn btn-sm ${device === "mobile" ? "btn-navy" : "btn-outline"}`} onClick={() => setDevice("mobile")} aria-pressed={device === "mobile"}><Smartphone size={14} aria-hidden /> Mobile</button>
            </div>
            <a className="btn btn-outline btn-sm" href={`/s/${slug}/?preview=1`} target="_blank" rel="noopener">Open preview</a>
            <button className="btn btn-outline btn-sm" onClick={() => save()} disabled={!!busy}>{busy === "save" ? "Saving…" : "Save draft"}</button>
            {status?.status === "live" && <button className="btn btn-outline btn-sm" onClick={() => act("unpublish")} disabled={!!busy}>Unpublish</button>}
            <button className="btn btn-orange btn-sm" onClick={() => act("publish")} disabled={!!busy || status?.status === "suspended"}>{busy === "publish" ? "Publishing…" : "Publish"}</button>
          </div>
        </div>
        <Msg m={msg} />
      </div>
      <div className="os-editor">
        <div className="panel">
          <details className="card mb12" style={{ padding: 12 }} open={!locked}>
            <summary style={{ fontWeight: 600, cursor: "pointer" }}>Theme</summary>
            <div style={{ marginTop: 10 }}>{locked ? <p className="small muted">Custom design by Vishwaship — theme switching is locked.</p> : themePicker}</div>
          </details>
          <details className="card mb12" style={{ padding: 12 }}>
            <summary style={{ fontWeight: 600, cursor: "pointer" }}>Logo, colours & fonts</summary>
            <div style={{ marginTop: 10 }}>{brand}</div>
          </details>
          <div className="card mb12" style={{ padding: 12 }}>
            <h3 style={{ fontSize: 14, marginBottom: 8 }}>Home page sections</h3>
            {c.sections.map((s, i) => (
              <div className="os-sec" key={s.id}>
                <div className="os-sec-h">
                  <button className="os-ic" onClick={() => setOpen(open === s.id ? null : s.id)} aria-expanded={open === s.id} aria-label={`Edit ${SECTION_LABEL[s.type]}`} style={{ flex: 1, textAlign: "left", color: "inherit" }}>
                    <span className="name" style={{ opacity: s.enabled ? 1 : 0.5 }}>{SECTION_LABEL[s.type]}</span>
                  </button>
                  <button className="os-ic" onClick={() => move(i, -1)} disabled={i === 0} aria-label="Move up"><ChevronUp size={15} /></button>
                  <button className="os-ic" onClick={() => move(i, 1)} disabled={i === c.sections.length - 1} aria-label="Move down"><ChevronDown size={15} /></button>
                  <button className="os-ic" onClick={() => setSection(s.id, { enabled: !s.enabled })} aria-label={s.enabled ? "Hide section" : "Show section"} aria-pressed={!s.enabled}>{s.enabled ? <Eye size={15} /> : <EyeOff size={15} />}</button>
                  <button className="os-ic" onClick={() => { if (confirm(`Remove "${SECTION_LABEL[s.type]}"?`)) upd({ ...c, sections: c.sections.filter((x) => x.id !== s.id) }); }} aria-label="Remove section"><Trash2 size={15} /></button>
                </div>
                {open === s.id && (
                  <div className="os-sec-b">
                    {SECTION_FIELDS[s.type].map((f) => {
                      const id = `${s.id}-${f.key}`;
                      const val = s.settings[f.key] ?? "";
                      const set = (v: string) => setSection(s.id, { settings: { ...s.settings, [f.key]: v } });
                      if (f.kind === "image") return (
                        <div className="field" key={f.key}><label>{f.label}</label>
                          <div className="row" style={{ gap: 8, alignItems: "center" }}>
                            {val && <img src={mediaSrc(val)} alt="" style={{ width: 64, height: 40, objectFit: "cover", borderRadius: 6 }} />}
                            <ImageUpload label={val ? "Change" : "Upload"} onDone={set} />
                            {val && <button type="button" className="link small" onClick={() => set("")}>Remove</button>}
                          </div></div>
                      );
                      if (f.kind === "select") return <div className="field" key={f.key}><label htmlFor={id}>{f.label}</label><select id={id} className="input select" value={val || f.options![0]} onChange={(e) => set(e.target.value)}>{f.options!.map((o) => <option key={o}>{o}</option>)}</select></div>;
                      if (f.kind === "textarea") return <div className="field" key={f.key}><label htmlFor={id}>{f.label}</label><textarea id={id} className="input" rows={4} value={val} maxLength={2000} onChange={(e) => set(e.target.value)} /></div>;
                      return <div className="field" key={f.key}><label htmlFor={id}>{f.label}</label><input id={id} className="input" value={val} maxLength={200} onChange={(e) => set(e.target.value)} /></div>;
                    })}
                  </div>
                )}
              </div>
            ))}
            {c.sections.length < 20 && (
              <div className="row" style={{ gap: 6, marginTop: 8 }}>
                <label htmlFor="addsec" className="sr-only">Add section</label>
                <select id="addsec" className="input select" defaultValue="" onChange={(e) => {
                  const type = e.target.value as SectionType; if (!type) return;
                  const id = `${type}-${Math.random().toString(36).slice(2, 7)}`;
                  const preset = defaultTheme(themeKey).sections.find((x) => x.type === type)?.settings ?? {};
                  upd({ ...c, sections: [...c.sections, { id, type, enabled: true, settings: { ...preset } }] }); setOpen(id); e.target.value = "";
                }}>
                  <option value="">+ Add a section…</option>
                  {addable.map((t) => <option key={t} value={t}>{SECTION_LABEL[t]}</option>)}
                </select>
                <Plus size={16} aria-hidden style={{ alignSelf: "center", color: "var(--muted)" }} />
              </div>
            )}
          </div>
          {versions.length > 0 && (
            <div className="card mb12" style={{ padding: 12 }}>
              <h3 style={{ fontSize: 14, marginBottom: 8 }}>Published versions</h3>
              <div className="row" style={{ gap: 6 }}>
                <label htmlFor="ver" className="sr-only">Version</label>
                <select id="ver" className="input select" value={restoreId} onChange={(e) => setRestoreId(e.target.value)} style={{ flex: 1, minWidth: 0 }}>
                  <option value="">Choose a version…</option>
                  {versions.map((v) => <option key={v.id} value={v.id}>v{v.version} · {v.themeKey} · {new Date(v.createdAt).toLocaleDateString("en-IN")}</option>)}
                </select>
                <button className="btn btn-outline btn-sm" onClick={() => act("restore")} disabled={!restoreId || !!busy}><RotateCcw size={14} aria-hidden /> Restore</button>
              </div>
              <p className="tiny muted" style={{ marginTop: 6 }}>Restoring copies that version into your draft. The live store changes when you publish.</p>
            </div>
          )}
        </div>
        <div>
          <p className="tiny muted" style={{ margin: "0 0 6px" }}>Preview shows your saved draft{dirty ? " — save to see your latest edits" : ""}.</p>
          <div className="os-frame-wrap">
            <iframe ref={frame} key={frameKey} title="Store preview" src={`/s/${slug}/?preview=1`} style={{ width: device === "mobile" ? 390 : "100%" }} />
          </div>
        </div>
      </div>
    </>
  );
}
