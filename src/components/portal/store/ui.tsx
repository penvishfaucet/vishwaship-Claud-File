"use client";
import { ImagePlus, Loader2 } from "lucide-react";
import { useRef, useState } from "react";

export type ApiResult<T = Record<string, unknown>> = { ok: true; data: T } | { ok: false; error: string };

export async function api<T = Record<string, unknown>>(method: string, url: string, body?: unknown): Promise<ApiResult<T>> {
  try {
    const r = await fetch(url, { method, headers: body instanceof FormData ? undefined : { "content-type": "application/json" }, body: body instanceof FormData ? body : body === undefined ? undefined : JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return { ok: false, error: j?.error?.message ?? "Something went wrong. Please try again." };
    return { ok: true, data: j as T };
  } catch {
    return { ok: false, error: "Network error. Check your connection and try again." };
  }
}

export function Msg({ m }: { m: { ok?: string; err?: string } | null }) {
  if (!m) return null;
  if (m.err) return <div className="err-box small" role="alert" style={{ marginTop: 10 }}>{m.err}</div>;
  return <div className="small" role="status" style={{ marginTop: 10, background: "var(--green-soft)", color: "var(--green)", borderRadius: 10, padding: "10px 12px" }}>{m.ok}</div>;
}

export const mediaSrc = (id: string) => `/api/store-media/${id}/`;

/** Upload one image to the store and return its media id. */
export function ImageUpload({ onDone, label = "Upload image", disabled }: { onDone: (id: string) => void; label?: string; disabled?: boolean }) {
  const ref = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  async function pick(f: File | undefined) {
    if (!f) return;
    setErr("");
    if (!/^image\/(png|jpeg|webp)$/.test(f.type)) { setErr("Use a PNG, JPG or WebP image"); return; }
    if (f.size > 1_500_000) { setErr("Image must be under 1.5 MB"); return; }
    setBusy(true);
    const fd = new FormData(); fd.append("file", f);
    const r = await api<{ id: string }>("POST", "/api/portal/store/media", fd);
    setBusy(false);
    if (ref.current) ref.current.value = "";
    if (!r.ok) { setErr(r.error); return; }
    onDone(r.data.id);
  }
  return (
    <span>
      <input ref={ref} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(e) => pick(e.target.files?.[0])} />
      <button type="button" className="btn btn-outline btn-sm" onClick={() => ref.current?.click()} disabled={busy || disabled}>
        {busy ? <Loader2 size={14} className="spin" aria-hidden /> : <ImagePlus size={14} aria-hidden />} {busy ? "Uploading…" : label}
      </button>
      {err && <span className="field-err" role="alert">{err}</span>}
    </span>
  );
}

export const toRupees = (paise: number) => (paise / 100).toString();
export const toPaise = (v: string) => Math.max(0, Math.round((Number(v) || 0) * 100));
