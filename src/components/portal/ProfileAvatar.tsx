"use client";
import { Camera, ImagePlus, Pencil, Smile, Trash2, UserRound, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

export type AvatarData = { type: "photo"; v: number } | { type: "emoji"; value: string } | null;

const initialsOf = (name: string) => name.trim().split(/\s+/).filter(Boolean).map((s) => [...s][0]).slice(0, 2).join("").toUpperCase();

/** The account's avatar: photo, emoji, initials, or a generic person icon. Same everywhere (header, More, profile). */
export function UserAvatar({ name, avatar, size = 40, className = "" }: { name: string; avatar: AvatarData; size?: number; className?: string }) {
  const [broken, setBroken] = useState(false);
  const style = { width: size, height: size, fontSize: Math.round(size * (avatar?.type === "emoji" ? 0.55 : 0.38)) };
  const ini = initialsOf(name);
  if (avatar?.type === "photo" && !broken)
    return <span className={`uav ${className}`} style={style}><img src={`/api/portal/me/avatar?v=${avatar.v}`} alt="" width={size} height={size} onError={() => setBroken(true)} /></span>;
  if (avatar?.type === "emoji") return <span className={`uav uav-emoji ${className}`} style={style} aria-hidden>{avatar.value}</span>;
  return <span className={`uav ${className}`} style={style} aria-hidden>{ini || <UserRound size={Math.round(size * 0.55)} />}</span>;
}

/** Avatar with the edit pencil; opens the editor (sheet on phones, centred dialog on desktop). */
export function EditableAvatar({ name, avatar, size = 64 }: { name: string; avatar: AvatarData; size?: number }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="uav-edit" onClick={() => setOpen(true)} aria-label="Change profile photo or emoji">
        <UserAvatar name={name} avatar={avatar} size={size} />
        <span className="uav-pen" aria-hidden><Pencil size={13} /></span>
      </button>
      {open && <AvatarEditor name={name} avatar={avatar} onClose={() => setOpen(false)} />}
    </>
  );
}

const EMOJIS = ["😀", "😎", "🙂", "🤓", "🧑‍💼", "👩‍💼", "👨‍💼", "🧕", "👳", "🙏", "👍", "💪", "🚚", "📦", "🛍️", "🏬", "🏭", "🧾", "💼", "⭐", "🔥", "🚀", "💎", "🌟", "🌸", "🌻", "🦁", "🐯", "🦚", "🐘", "🏏", "⚡", "❤️", "💙", "🧡", "🇮🇳", "🕉️", "🪔", "🎯", "✅"];
const isOneEmoji = (s: string) => {
  const t = s.trim();
  if (!t) return false;
  const seg = typeof Intl !== "undefined" && "Segmenter" in Intl ? [...new Intl.Segmenter("en", { granularity: "grapheme" }).segment(t)].length : [...t].length;
  return seg === 1 && /\p{Extended_Pictographic}|\p{Regional_Indicator}|⃣/u.test(t);
};
const VIEW = 260, OUT = 320;

/**
 * Change the avatar: upload a photo (circular crop: drag or arrow keys to move, slider to zoom), pick or type one emoji,
 * or remove it. The current avatar stays until the save succeeds; on failure it stays and the user can retry.
 */
export function AvatarEditor({ name, avatar, onClose }: { name: string; avatar: AvatarData; onClose: () => void }) {
  const router = useRouter();
  const dlg = useRef<HTMLDialogElement>(null);
  const file = useRef<HTMLInputElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [tab, setTab] = useState<"photo" | "emoji">(avatar?.type === "emoji" ? "emoji" : "photo");
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [zoom, setZoom] = useState(1);
  const [off, setOff] = useState({ x: 0, y: 0 });
  const [emoji, setEmoji] = useState(avatar?.type === "emoji" ? avatar.value : "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const drag = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);

  useEffect(() => { dlg.current?.showModal(); }, []);
  const base = img ? Math.max(VIEW / img.width, VIEW / img.height) : 1;
  const clamp = useCallback((o: { x: number; y: number }, z = zoom) => {
    if (!img) return o;
    const w = img.width * base * z, h = img.height * base * z;
    const mx = Math.max(0, (w - VIEW) / 2), my = Math.max(0, (h - VIEW) / 2);
    return { x: Math.min(mx, Math.max(-mx, o.x)), y: Math.min(my, Math.max(-my, o.y)) };
  }, [img, base, zoom]);
  const draw = useCallback((c: HTMLCanvasElement | null, size: number) => {
    if (!c || !img) return;
    const ctx = c.getContext("2d")!;
    const k = size / VIEW, w = img.width * base * zoom * k, h = img.height * base * zoom * k;
    ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, size, size);
    ctx.drawImage(img, (size - w) / 2 + off.x * k, (size - h) / 2 + off.y * k, w, h);
  }, [img, base, zoom, off]);
  useEffect(() => draw(canvas.current, VIEW), [draw]);

  function pick(f?: File) {
    setErr("");
    if (!f) return;
    if (!/^image\/(jpeg|png|webp)$/.test(f.type)) { setErr("Use a JPG, PNG or WebP photo"); return; }
    if (f.size > 15 * 1024 * 1024) { setErr("Photo is too big"); return; }
    const url = URL.createObjectURL(f);
    const i = new Image();
    i.onload = () => { setImg(i); setZoom(1); setOff({ x: 0, y: 0 }); URL.revokeObjectURL(url); };
    i.onerror = () => { setErr("That photo could not be opened. Try another one."); URL.revokeObjectURL(url); };
    i.src = url;
  }
  async function send(init: RequestInit) {
    setBusy(true); setErr("");
    try {
      const r = await fetch("/api/portal/me/avatar", init);
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { setErr(j?.error?.message ?? "Could not save. Please try again."); return; }
      dlg.current?.close(); onClose(); router.refresh();
    } catch { setErr("Network error. Check your connection and try again."); }
    finally { setBusy(false); }
  }
  async function savePhoto() {
    if (!img) { setErr("Choose a photo first"); return; }
    const c = document.createElement("canvas"); c.width = OUT; c.height = OUT; draw(c, OUT);
    const blob = await new Promise<Blob | null>((res) => c.toBlob(res, "image/jpeg", 0.9));
    if (!blob) { setErr("Could not prepare the photo"); return; }
    const fd = new FormData(); fd.append("photo", blob, "avatar.jpg");
    await send({ method: "POST", body: fd });
  }
  const saveEmoji = () => (isOneEmoji(emoji) ? send({ method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ emoji: emoji.trim() }) }) : setErr("Choose one emoji"));
  const close = () => { dlg.current?.close(); onClose(); };

  return (
    <dialog ref={dlg} className="uav-dialog" aria-labelledby="uav-h" onCancel={(e) => { e.preventDefault(); close(); }}>
      <div className="uav-dh"><h2 id="uav-h">Profile picture</h2><button type="button" className="sc-x" aria-label="Close" onClick={close}><X size={20} /></button></div>
      <div className="uav-now"><UserAvatar name={name} avatar={avatar} size={44} /><span className="small muted">Current</span></div>
      <div className="seg" role="tablist" aria-label="Avatar type" style={{ width: "fit-content" }}>
        <button type="button" role="tab" aria-selected={tab === "photo"} className={tab === "photo" ? "on" : ""} onClick={() => { setTab("photo"); setErr(""); }}><Camera size={14} aria-hidden /> Photo</button>
        <button type="button" role="tab" aria-selected={tab === "emoji"} className={tab === "emoji" ? "on" : ""} onClick={() => { setTab("emoji"); setErr(""); }}><Smile size={14} aria-hidden /> Emoji</button>
      </div>
      {tab === "photo" ? (
        <div className="uav-photo">
          <input ref={file} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={(e) => { pick(e.target.files?.[0]); e.target.value = ""; }} />
          {img ? (
            <>
              <div className="uav-crop" tabIndex={0} role="application" aria-label="Photo position: drag, or use the arrow keys to move"
                onPointerDown={(e) => { (e.target as HTMLElement).setPointerCapture(e.pointerId); drag.current = { x: e.clientX, y: e.clientY, ox: off.x, oy: off.y }; }}
                onPointerMove={(e) => { const d = drag.current; if (d) setOff(clamp({ x: d.ox + e.clientX - d.x, y: d.oy + e.clientY - d.y })); }}
                onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }}
                onKeyDown={(e) => { const m: Record<string, [number, number]> = { ArrowLeft: [-8, 0], ArrowRight: [8, 0], ArrowUp: [0, -8], ArrowDown: [0, 8] }; const v = m[e.key]; if (v) { e.preventDefault(); setOff(clamp({ x: off.x + v[0], y: off.y + v[1] })); } }}>
                <canvas ref={canvas} width={VIEW} height={VIEW} />
              </div>
              <label className="small uav-zoom">Zoom<input type="range" min={1} max={3} step={0.01} value={zoom} onChange={(e) => { const z = Number(e.target.value); setZoom(z); setOff((o) => clamp(o, z)); }} /></label>
              <button type="button" className="btn btn-outline btn-sm" onClick={() => file.current?.click()}><ImagePlus size={14} aria-hidden /> Choose another photo</button>
            </>
          ) : (
            <button type="button" className="uav-pick" onClick={() => file.current?.click()}><ImagePlus size={28} aria-hidden /><b>Upload a photo</b><span className="tiny muted">From your gallery or files · JPG, PNG or WebP</span></button>
          )}
        </div>
      ) : (
        <div className="uav-emojis">
          <div className="uav-grid" role="listbox" aria-label="Emoji">
            {EMOJIS.map((e) => <button key={e} type="button" role="option" aria-selected={emoji === e} className={emoji === e ? "on" : ""} onClick={() => { setEmoji(e); setErr(""); }}>{e}</button>)}
          </div>
          <label className="field"><span className="small">Or type one emoji from your keyboard</span>
            <input className="input" value={emoji} onChange={(e) => { setEmoji(e.target.value.slice(0, 32)); setErr(""); }} inputMode="text" style={{ fontSize: 24, width: 120, textAlign: "center" }} aria-label="Emoji" /></label>
        </div>
      )}
      {err && <div className="err-box small" role="alert">{err}</div>}
      <div className="uav-actions">
        {avatar && <button type="button" className="btn btn-outline btn-sm uav-remove" disabled={busy} onClick={() => send({ method: "DELETE" })}><Trash2 size={14} aria-hidden /> Remove</button>}
        <span style={{ flex: 1 }} />
        <button type="button" className="btn btn-outline" onClick={close} disabled={busy}>Cancel</button>
        <button type="button" className="btn btn-orange" disabled={busy || (tab === "photo" ? !img : !isOneEmoji(emoji))} onClick={tab === "photo" ? savePhoto : saveEmoji}>{busy ? "Saving…" : "Save"}</button>
      </div>
    </dialog>
  );
}
