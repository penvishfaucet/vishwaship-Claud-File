"use client";
import { Mail, Smartphone } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { type Confirmation, type PhoneOtpConfig, confirmPhoneOtp, fbError, firebasePhone } from "@/lib/firebase-phone-client";

/** Online Store My Account (client parts): login, profile, address book, return / exchange request. */
const post = async (store: string, body: Record<string, unknown>) => {
  const r = await fetch(`/api/store/${store}/account/`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(j?.error?.message ?? "Something went wrong. Please try again."), { field: j?.error?.field as string | undefined });
  return j;
};

export const STATES = ["Andaman and Nicobar Islands", "Andhra Pradesh", "Arunachal Pradesh", "Assam", "Bihar", "Chandigarh", "Chhattisgarh", "Dadra and Nagar Haveli and Daman and Diu", "Delhi", "Goa", "Gujarat", "Haryana", "Himachal Pradesh", "Jammu and Kashmir", "Jharkhand", "Karnataka", "Kerala", "Ladakh", "Lakshadweep", "Madhya Pradesh", "Maharashtra", "Manipur", "Meghalaya", "Mizoram", "Nagaland", "Odisha", "Puducherry", "Punjab", "Rajasthan", "Sikkim", "Tamil Nadu", "Telangana", "Tripura", "Uttar Pradesh", "Uttarakhand", "West Bengal"];

/** Login with mobile OTP (when the store's domain can use it) or a code sent to email. New buyers get an account on first login. */
export function BuyerLogin({ store, phone, next }: { store: string; phone: PhoneOtpConfig | null; next: string }) {
  const [mode, setMode] = useState<"mobile" | "email">(phone ? "mobile" : "email");
  const [val, setVal] = useState("");
  const [code, setCode] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [cool, setCool] = useState(0);
  const conf = useRef<Confirmation | null>(null);
  useEffect(() => { if (cool <= 0) return; const t = setTimeout(() => setCool((c) => c - 1), 1000); return () => clearTimeout(t); }, [cool]);
  const done = () => { window.location.href = next; };
  const valid = mode === "mobile" ? /^[6-9]\d{9}$/.test(val) : /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(val.trim());

  async function send() {
    if (!valid || busy) return;
    setBusy(true); setErr("");
    try {
      if (mode === "mobile") { const fb = await firebasePhone(phone!); conf.current = await fb.send(`+91${val}`, "sfb-recaptcha"); setCool(30); }
      else { const j = await post(store, { op: "email_code", email: val.trim() }); setCool(j.cooldownSec ?? 60); }
      setSent(true); setCode("");
    } catch (e) { setErr(mode === "mobile" ? fbError(e) : (e as Error).message); }
    setBusy(false);
  }
  async function verify(e: React.FormEvent) {
    e.preventDefault();
    if (!/^\d{6}$/.test(code) || busy) return;
    setBusy(true); setErr("");
    try {
      if (mode === "mobile") {
        let token: string;
        try { token = await confirmPhoneOtp(phone!, conf.current!, code); } catch (x) { setErr(fbError(x)); setBusy(false); return; }
        await post(store, { op: "phone_login", idToken: token });
      } else await post(store, { op: "email_login", email: val.trim(), code });
      done(); return;
    } catch (x) { setErr((x as Error).message); }
    setBusy(false);
  }
  return (
    <div className="sf-acct-login">
      <h1>Log in</h1>
      <p className="sf-note">See your orders, track them, save addresses and ask for returns. New here? Your account is created when you log in.</p>
      {phone && (
        <div className="sf-seg" role="tablist" aria-label="Log in with">
          <button type="button" role="tab" aria-selected={mode === "mobile"} className={mode === "mobile" ? "on" : ""} onClick={() => { setMode("mobile"); setSent(false); setVal(""); setErr(""); }}><Smartphone size={16} aria-hidden /> Mobile OTP</button>
          <button type="button" role="tab" aria-selected={mode === "email"} className={mode === "email" ? "on" : ""} onClick={() => { setMode("email"); setSent(false); setVal(""); setErr(""); }}><Mail size={16} aria-hidden /> Email code</button>
        </div>
      )}
      <div id="sfb-recaptcha" />
      {!sent ? (
        <form className="sf-form" onSubmit={(e) => { e.preventDefault(); void send(); }}>
          <label htmlFor="sfb-id">{mode === "mobile" ? "Mobile number" : "Email address"}</label>
          {mode === "mobile"
            ? <div className="sf-inrow"><span className="sf-input pre" aria-hidden>+91</span><input id="sfb-id" className="sf-input" inputMode="numeric" autoComplete="tel-national" maxLength={10} placeholder="10-digit mobile" value={val} onChange={(e) => setVal(e.target.value.replace(/\D/g, "").slice(0, 10))} autoFocus /></div>
            : <input id="sfb-id" className="sf-input" type="email" autoComplete="email" placeholder="you@example.com" value={val} onChange={(e) => setVal(e.target.value)} autoFocus />}
          <button className="sf-btn" disabled={!valid || busy}>{busy ? "Sending…" : mode === "mobile" ? "Send OTP" : "Send code"}</button>
        </form>
      ) : (
        <form className="sf-form" onSubmit={verify}>
          <p className="sf-note" style={{ margin: 0 }}>Code sent to <b>{mode === "mobile" ? `+91 ${val}` : val}</b> · <button type="button" className="sf-link" onClick={() => { setSent(false); setErr(""); }}>Change</button></p>
          <label htmlFor="sfb-code">6-digit code</label>
          <input id="sfb-code" className="sf-input" inputMode="numeric" autoComplete="one-time-code" maxLength={6} placeholder="6-digit code" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))} autoFocus />
          <button className="sf-btn" disabled={code.length !== 6 || busy}>{busy ? "Checking…" : "Log in"}</button>
          <p className="sf-note" style={{ margin: 0 }}>Didn&apos;t get it? <button type="button" className="sf-link" onClick={() => void send()} disabled={cool > 0 || busy}>{cool > 0 ? `Resend in ${cool}s` : "Resend"}</button>{mode === "email" ? " · check spam too" : ""}</p>
        </form>
      )}
      {err && <p className="sf-err" role="alert">{err}{mode === "mobile" && phone ? <> · <button type="button" className="sf-link" onClick={() => { setMode("email"); setSent(false); setVal(""); setErr(""); }}>Use email instead</button></> : null}</p>}
    </div>
  );
}

export function LogoutButton({ store, base }: { store: string; base: string }) {
  const [busy, setBusy] = useState(false);
  return <button type="button" className="sf-btn ghost sm" disabled={busy} onClick={async () => { setBusy(true); await post(store, { op: "logout" }).catch(() => null); window.location.href = `${base}/`; }}>{busy ? "Logging out…" : "Log out"}</button>;
}

export function ProfileName({ store, name }: { store: string; name: string }) {
  const [v, setV] = useState(name);
  const [msg, setMsg] = useState("");
  return (
    <form className="sf-inrow" onSubmit={async (e) => { e.preventDefault(); try { await post(store, { op: "profile", name: v }); setMsg("Saved"); } catch (x) { setMsg((x as Error).message); } setTimeout(() => setMsg(""), 2000); }}>
      <label htmlFor="sfb-name" className="sr-only">Your name</label>
      <input id="sfb-name" className="sf-input" placeholder="Your name" maxLength={80} value={v} onChange={(e) => setV(e.target.value)} />
      <button className="sf-btn ghost sm">Save</button>
      {msg && <span className="sf-note" role="status">{msg}</span>}
    </form>
  );
}

export type Addr = { id: string; label: string; name: string; mobile: string; line1: string; line2: string; pincode: string; city: string; state: string; isDefault: boolean };
const EMPTY: Addr = { id: "", label: "Home", name: "", mobile: "", line1: "", line2: "", pincode: "", city: "", state: "", isDefault: false };

export function AddressBook({ store, addresses }: { store: string; addresses: Addr[] }) {
  const [list, setList] = useState(addresses);
  const [edit, setEdit] = useState<Addr | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<{ msg: string; field?: string } | null>(null);
  useEffect(() => {
    if (!edit || !/^[1-9]\d{5}$/.test(edit.pincode)) return;
    let gone = false;
    fetch(`/api/public/pincode/${edit.pincode}/`).then((r) => r.json()).then((j) => {
      if (gone || !j) return;
      const city = j.city ?? j.data?.city; const state = j.state ?? j.data?.state;
      setEdit((c) => (c ? { ...c, city: c.city || city || "", state: c.state || (STATES.find((s) => s.toLowerCase() === String(state ?? "").toLowerCase()) ?? c.state) } : c));
    }).catch(() => {});
    return () => { gone = true; };
  }, [edit?.pincode]); // eslint-disable-line react-hooks/exhaustive-deps
  async function save(e: React.FormEvent) {
    e.preventDefault(); if (!edit) return;
    setBusy(true); setErr(null);
    try {
      const j = await post(store, { op: "address_save", address: { ...edit, id: edit.id || undefined } });
      const row = { ...edit, id: j.id };
      setList((l) => { let n = l.some((x) => x.id === row.id) ? l.map((x) => (x.id === row.id ? row : x)) : [...l, row]; if (row.isDefault || n.length === 1) n = n.map((x) => ({ ...x, isDefault: x.id === row.id })); return n; });
      setEdit(null);
    } catch (x) { setErr({ msg: (x as Error).message, field: (x as { field?: string }).field }); }
    setBusy(false);
  }
  async function del(id: string) {
    if (!confirm("Delete this address?")) return;
    await post(store, { op: "address_delete", id }).catch(() => null);
    setList((l) => { const n = l.filter((x) => x.id !== id); if (n.length && !n.some((x) => x.isDefault)) n[0] = { ...n[0], isDefault: true }; return n; });
  }
  const f = (k: keyof Addr, label: string, props: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <label className={err?.field === k ? "bad" : ""}>{label}<input className="sf-input" value={String(edit?.[k] ?? "")} onChange={(e) => setEdit((c) => (c ? { ...c, [k]: k === "mobile" || k === "pincode" ? e.target.value.replace(/\D/g, "") : e.target.value } : c))} {...props} /></label>
  );
  return (
    <div className="sf-addrs">
      {list.length === 0 && !edit && <p className="sf-note">No saved addresses yet. Addresses you use at checkout are saved here automatically.</p>}
      {list.map((a) => (
        <div key={a.id} className="sf-addr">
          <div><b>{a.label}</b>{a.isDefault && <span className="sf-tag">Default</span>}<div>{a.name} · {a.mobile}</div><div className="sf-note">{[a.line1, a.line2, `${a.city}, ${a.state} ${a.pincode}`].filter(Boolean).join(", ")}</div></div>
          <div className="acts"><button type="button" className="sf-link" onClick={() => { setErr(null); setEdit(a); }}>Edit</button><button type="button" className="sf-link" onClick={() => void del(a.id)}>Delete</button></div>
        </div>
      ))}
      {edit ? (
        <form className="sf-addr-form" onSubmit={save}>
          <div className="g2">{f("label", "Label (Home, Office…)", { maxLength: 30 })}{f("name", "Full name", { maxLength: 80, required: true, autoComplete: "name" })}</div>
          <div className="g2">{f("mobile", "Mobile", { inputMode: "numeric", maxLength: 10, required: true, autoComplete: "tel-national" })}{f("pincode", "Pincode", { inputMode: "numeric", maxLength: 6, required: true, autoComplete: "postal-code" })}</div>
          {f("line1", "House / street / area", { maxLength: 200, required: true, autoComplete: "address-line1" })}
          {f("line2", "Landmark (optional)", { maxLength: 200, autoComplete: "address-line2" })}
          <div className="g2">{f("city", "City", { maxLength: 60, required: true })}
            <label className={err?.field === "state" ? "bad" : ""}>State<select className="sf-input" required value={edit.state} onChange={(e) => setEdit({ ...edit, state: e.target.value })}><option value="">Choose state</option>{STATES.map((s) => <option key={s}>{s}</option>)}</select></label></div>
          <label className="chk"><input type="checkbox" checked={edit.isDefault} onChange={(e) => setEdit({ ...edit, isDefault: e.target.checked })} /> Use as my default address</label>
          {err && <p className="sf-err" role="alert">{err.msg}</p>}
          <div className="sf-inrow"><button className="sf-btn" disabled={busy}>{busy ? "Saving…" : "Save address"}</button><button type="button" className="sf-btn ghost" onClick={() => setEdit(null)}>Cancel</button></div>
        </form>
      ) : list.length < 10 && <button type="button" className="sf-btn ghost sm" onClick={() => { setErr(null); setEdit({ ...EMPTY }); }}>+ Add address</button>}
    </div>
  );
}

/** Return / exchange request form on the order page (shown only while the store's return window is open). */
export function ReturnForm({ store, number, token, lines, reasons, exchange, until }: { store: string; number: string; token: string; lines: Array<{ title: string; variantTitle: string | null; qty: number }>; reasons: readonly string[]; exchange: boolean; until: string }) {
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<"return" | "exchange">("return");
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  const [qty, setQty] = useState<number[]>(lines.map((l) => (lines.length === 1 ? l.qty : 0)));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  if (!open) return <div className="sf-ret-cta"><button type="button" className="sf-btn ghost" onClick={() => setOpen(true)}>Return or exchange items</button><span className="sf-note">You can ask until {until}.</span></div>;
  async function send(e: React.FormEvent) {
    e.preventDefault();
    const chosen = qty.map((q, index) => ({ index, qty: q })).filter((x) => x.qty > 0);
    if (!chosen.length) { setErr("Choose at least one item"); return; }
    if (!reason) { setErr("Choose a reason"); return; }
    setBusy(true); setErr("");
    const r = await fetch(`/api/store/${store}/returns/`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ number, token, request: { type, reason, note, lines: chosen } }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { setErr(j?.error?.message ?? "Could not send your request"); setBusy(false); return; }
    window.location.reload();
  }
  return (
    <form className="sf-ret" onSubmit={send}>
      <h2>Return or exchange</h2>
      {exchange && (
        <div className="sf-seg" role="radiogroup" aria-label="Request type">
          <button type="button" role="radio" aria-checked={type === "return"} className={type === "return" ? "on" : ""} onClick={() => setType("return")}>Return for refund</button>
          <button type="button" role="radio" aria-checked={type === "exchange"} className={type === "exchange" ? "on" : ""} onClick={() => setType("exchange")}>Exchange</button>
        </div>
      )}
      <fieldset><legend>Items</legend>
        {lines.map((l, i) => (
          <label key={i} className="sf-ret-line"><span>{l.title}{l.variantTitle ? ` (${l.variantTitle})` : ""}</span>
            <select className="sf-input" value={qty[i]} onChange={(e) => setQty(qty.map((q, k) => (k === i ? Number(e.target.value) : q)))} aria-label={`Quantity of ${l.title} to ${type}`}>
              {Array.from({ length: l.qty + 1 }, (_, n) => <option key={n} value={n}>{n === 0 ? "Not this item" : `${n} of ${l.qty}`}</option>)}
            </select></label>
        ))}
      </fieldset>
      <label>Reason<select className="sf-input" value={reason} onChange={(e) => setReason(e.target.value)} required><option value="">Choose a reason</option>{reasons.map((r) => <option key={r}>{r}</option>)}</select></label>
      <label>{type === "exchange" ? "What would you like instead? (size / colour)" : "Details (optional)"}<textarea className="sf-input" rows={3} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} placeholder={type === "exchange" ? "e.g. Size L instead of M" : "Anything the store should know"} /></label>
      {err && <p className="sf-err" role="alert">{err}</p>}
      <div className="sf-inrow"><button className="sf-btn" disabled={busy}>{busy ? "Sending…" : "Send request"}</button><button type="button" className="sf-btn ghost" onClick={() => setOpen(false)}>Cancel</button></div>
      <p className="sf-note" style={{ margin: 0 }}>The store reviews every request and tells you how to send the item back. Refunds follow the store&apos;s refund policy.</p>
    </form>
  );
}
