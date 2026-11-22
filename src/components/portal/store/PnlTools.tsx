"use client";
import { Camera, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { api } from "./ui";

const DRAFT = "vs-expense-draft";
type Cat = { key: string; label: string };
const blank = (today: string) => ({ spentOn: today, category: "packaging", amount: "", gst: "", gstRecoverable: false, note: "", orderNumber: "", recurring: false });

/** Shrink a phone photo to ≤1600 px JPEG so it uploads quickly on a slow connection (PDFs go as they are). */
async function shrink(f: File): Promise<Blob> {
  if (!f.type.startsWith("image/") || f.size < 600_000) return f;
  try {
    const bmp = await createImageBitmap(f);
    const s = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
    const c = document.createElement("canvas"); c.width = Math.round(bmp.width * s); c.height = Math.round(bmp.height * s);
    c.getContext("2d")!.drawImage(bmp, 0, 0, c.width, c.height);
    return await new Promise<Blob>((res) => c.toBlob((b) => res(b ?? f), "image/jpeg", 0.82));
  } catch { return f; }
}

/** Add an expense from a phone: big fields, numeric keyboards, camera for the bill, and the half-filled form is kept. */
export function ExpenseForm({ categories, today }: { categories: Cat[]; today: string }) {
  const router = useRouter();
  const [f, setF] = useState(blank(today));
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok?: string; err?: string } | null>(null);
  const cam = useRef<HTMLInputElement>(null);
  useEffect(() => { try { const d = localStorage.getItem(DRAFT); if (d) setF({ ...blank(today), ...JSON.parse(d) }); } catch { /* no storage */ } }, [today]);
  const set = (k: keyof ReturnType<typeof blank>, v: string | boolean) => setF((x) => { const n = { ...x, [k]: v }; try { localStorage.setItem(DRAFT, JSON.stringify(n)); } catch { /* ignore */ } return n; });
  const paise = (s: string) => Math.round((Number(s) || 0) * 100);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    if (paise(f.amount) <= 0) { setMsg({ err: "Enter the amount" }); return; }
    if (paise(f.gst) >= paise(f.amount)) { setMsg({ err: "GST must be less than the amount" }); return; }
    setBusy(true);
    const fd = new FormData();
    fd.append("data", JSON.stringify({ spentOn: f.spentOn, category: f.category, amountPaise: paise(f.amount), gstPaise: paise(f.gst), gstRecoverable: f.gstRecoverable, note: f.note, orderNumber: f.orderNumber, recurring: f.recurring }));
    if (file) fd.append("receipt", await shrink(file), file.name.replace(/\.(heic|heif)$/i, ".jpg"));
    const r = await api("POST", "/api/portal/store/expenses", fd);
    setBusy(false);
    if (!r.ok) { setMsg({ err: r.error }); return; }
    try { localStorage.removeItem(DRAFT); } catch { /* ignore */ }
    setF(blank(today)); setFile(null); setMsg({ ok: "Expense added." });
    router.refresh();
  }
  return (
    <form className="card" onSubmit={submit} style={{ padding: 14, display: "grid", gap: 10 }}>
      <h3 style={{ margin: 0, fontSize: 15 }}>Add an expense</h3>
      <div className="grid2">
        <div className="field"><label htmlFor="ex-d">Date</label><input id="ex-d" type="date" className="input" max={today} value={f.spentOn} onChange={(e) => set("spentOn", e.target.value)} required /></div>
        <div className="field"><label htmlFor="ex-c">Type</label><select id="ex-c" className="input select" value={f.category} onChange={(e) => set("category", e.target.value)}>{categories.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}</select></div>
        <div className="field"><label htmlFor="ex-a">Amount paid (₹, with GST)</label><input id="ex-a" className="input" inputMode="decimal" value={f.amount} onChange={(e) => set("amount", e.target.value.replace(/[^0-9.]/g, ""))} required /></div>
        <div className="field"><label htmlFor="ex-g">GST in it (₹, optional)</label><input id="ex-g" className="input" inputMode="decimal" value={f.gst} onChange={(e) => set("gst", e.target.value.replace(/[^0-9.]/g, ""))} /></div>
      </div>
      {Number(f.gst) > 0 && <label className="row small" style={{ gap: 8, alignItems: "center", minHeight: 36 }}><input type="checkbox" checked={f.gstRecoverable} onChange={(e) => set("gstRecoverable", e.target.checked)} style={{ width: 20, height: 20 }} /> I can claim this GST back (bill has my GSTIN)</label>}
      <div className="grid2">
        <div className="field"><label htmlFor="ex-o">For one order? (order no, optional)</label><input id="ex-o" className="input mono" value={f.orderNumber} onChange={(e) => set("orderNumber", e.target.value.toUpperCase().slice(0, 40))} placeholder="e.g. PENV1023" autoCapitalize="characters" /></div>
        <div className="field"><label htmlFor="ex-n">Note</label><input id="ex-n" className="input" maxLength={300} value={f.note} onChange={(e) => set("note", e.target.value)} placeholder="Shop / bill no" /></div>
      </div>
      {!f.orderNumber && <label className="row small" style={{ gap: 8, alignItems: "center", minHeight: 36 }}><input type="checkbox" checked={f.recurring} onChange={(e) => set("recurring", e.target.checked)} style={{ width: 20, height: 20 }} /> Repeats every month (rent, salary …)</label>}
      <div className="row wrap" style={{ gap: 8, alignItems: "center" }}>
        <button type="button" className="btn btn-outline btn-sm" onClick={() => cam.current?.click()}><Camera size={14} aria-hidden /> {file ? "Change bill photo" : "Add bill photo / PDF"}</button>
        <input ref={cam} type="file" accept="image/*,application/pdf" hidden onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        {file && <span className="small muted" style={{ overflowWrap: "anywhere" }}>{file.name}</span>}
      </div>
      {msg?.err && <div className="err-box small" role="alert">{msg.err}</div>}
      {msg?.ok && <p className="small" role="status" style={{ margin: 0, color: "var(--green, #15803d)" }}>{msg.ok}</p>}
      <button className="btn btn-orange" disabled={busy} style={{ minHeight: 46 }}>{busy ? "Saving…" : "Save expense"}</button>
    </form>
  );
}

export function DeleteExpense({ id, label }: { id: string; label: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <button type="button" className="btn btn-outline btn-sm" disabled={busy} aria-label={`Delete ${label}`} onClick={async () => {
      if (!confirm(`Delete this expense (${label})? It is removed from the P&L; the record stays in your activity log.`)) return;
      setBusy(true); const r = await api("DELETE", `/api/portal/store/expenses?id=${id}`); setBusy(false);
      if (!r.ok) alert(r.error); else router.refresh();
    }}><Trash2 size={14} aria-hidden /></button>
  );
}

export function PnlSettingsForm({ initial }: { initial: { gstRegistered: boolean; gatewayFeeBps: number } }) {
  const router = useRouter();
  const [gst, setGst] = useState(initial.gstRegistered);
  const [fee, setFee] = useState(String(initial.gatewayFeeBps / 100));
  const [msg, setMsg] = useState("");
  async function save(e: React.FormEvent) {
    e.preventDefault();
    const r = await api("POST", "/api/portal/store/pnl", { gstRegistered: gst, gatewayFeeBps: Math.round((Number(fee) || 0) * 100) });
    setMsg(r.ok ? "Saved" : r.error); if (r.ok) router.refresh();
  }
  return (
    <form onSubmit={save} style={{ display: "grid", gap: 8 }}>
      <label className="row small" style={{ gap: 8, alignItems: "center", minHeight: 36 }}><input type="checkbox" checked={gst} onChange={(e) => setGst(e.target.checked)} style={{ width: 20, height: 20 }} /> I am GST registered (show output GST and claim GST on bills)</label>
      <div className="field" style={{ maxWidth: 260 }}><label htmlFor="pf">Online payment fee (% of prepaid orders, estimate)</label><input id="pf" className="input" inputMode="decimal" value={fee} onChange={(e) => setFee(e.target.value.replace(/[^0-9.]/g, "").slice(0, 5))} /></div>
      <div className="row" style={{ gap: 8, alignItems: "center" }}><button className="btn btn-outline btn-sm">Save</button>{msg && <span className="small muted" role="status">{msg}</span>}</div>
    </form>
  );
}
