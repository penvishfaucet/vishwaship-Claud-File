"use client";
import { Upload } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { Msg, api } from "./ui";

type Check = { ok: boolean; state: "connected" | "added" | "error"; message: string; at: string } | null;
export type Overview = {
  codMilestone: "placed" | "confirmed" | "shipped" | "delivered";
  meta: { pixelId: string; tokenHint: string | null; testEventCode: string; check: Check } | null;
  ga4: { measurementId: string; secretHint: string | null; check: Check } | null;
  gads: { conversionId: string; conversionLabel: string } | null;
};

function Status({ check, idle }: { check: Check | undefined; idle: string }) {
  if (!check) return <span className="chip c-draft">{idle}</span>;
  const cls = check.state === "connected" ? "c-active" : check.state === "added" ? "c-draft" : "c-cancelled";
  const label = check.state === "connected" ? "Connected" : check.state === "added" ? "Added (not verifiable)" : "Not connected";
  return <span className={`chip ${cls}`} title={check.message}>{label}</span>;
}

const MILESTONES = [
  ["placed", "When the order is placed"], ["confirmed", "When the buyer confirms on WhatsApp (recommended)"],
  ["shipped", "When the courier picks it up"], ["delivered", "When it is delivered and cash is collected"],
] as const;

export function MarketingForm({ initial }: { initial: Overview }) {
  const router = useRouter();
  const [f, setF] = useState({
    codMilestone: initial.codMilestone, pixelId: initial.meta?.pixelId ?? "", token: "", testEventCode: initial.meta?.testEventCode ?? "",
    measurementId: initial.ga4?.measurementId ?? "", apiSecret: "", conversionId: initial.gads?.conversionId ?? "", conversionLabel: initial.gads?.conversionLabel ?? "",
  });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok?: string; err?: string } | null>(null);
  const set = (k: keyof typeof f, v: string) => setF({ ...f, [k]: v });
  async function save(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setMsg(null);
    const r = await api("PUT", "/api/portal/store/marketing", {
      codMilestone: f.codMilestone, meta: { pixelId: f.pixelId, token: f.token, testEventCode: f.testEventCode },
      ga4: { measurementId: f.measurementId, apiSecret: f.apiSecret }, gads: { conversionId: f.conversionId, conversionLabel: f.conversionLabel },
    });
    setBusy(false); setF({ ...f, token: "", apiSecret: "" });
    setMsg(r.ok ? { ok: "Saved and checked. See the status next to each item." } : { err: r.error });
    router.refresh();
  }
  return (
    <form onSubmit={save} style={{ display: "grid", gap: 12, maxWidth: 860 }}>
      <div className="card" style={{ padding: 20 }}>
        <div className="row between wrap" style={{ gap: 8 }}><h3 style={{ margin: 0 }}>Meta Pixel & Conversions API</h3><Status check={initial.meta?.check} idle="Not set up" /></div>
        <p className="small muted">Tracks visits and purchases for Facebook & Instagram ads. The access token lets us also send purchases from the server, so ad results stay accurate when browsers block tracking. Both are counted once.</p>
        <div className="grid2">
          <div className="field"><label htmlFor="px">Pixel (dataset) ID</label><input id="px" className="input mono" inputMode="numeric" value={f.pixelId} onChange={(e) => set("pixelId", e.target.value.replace(/\D/g, ""))} placeholder="123456789012345" /></div>
          <div className="field"><label htmlFor="tk">Conversions API access token</label><input id="tk" type="password" className="input" value={f.token} onChange={(e) => set("token", e.target.value)} placeholder={initial.meta?.tokenHint ? `Saved (${initial.meta.tokenHint}) — blank keeps it` : "From Events Manager → Settings"} autoComplete="off" /></div>
          <div className="field"><label htmlFor="tec">Test event code (optional)</label><input id="tec" className="input mono" value={f.testEventCode} onChange={(e) => set("testEventCode", e.target.value.trim())} placeholder="TEST12345" /></div>
        </div>
        {initial.meta?.check && <p className="small" style={{ marginBottom: 0 }}>{initial.meta.check.message}</p>}
      </div>
      <div className="card" style={{ padding: 20 }}>
        <div className="row between wrap" style={{ gap: 8 }}><h3 style={{ margin: 0 }}>Google Analytics 4</h3><Status check={initial.ga4?.check} idle="Not set up" /></div>
        <p className="small muted">Measures visits and sales in GA4. The Measurement Protocol API secret sends purchases from the server (Admin → Data streams → your stream → Measurement Protocol API secrets).</p>
        <div className="grid2">
          <div className="field"><label htmlFor="ga">Measurement ID</label><input id="ga" className="input mono" value={f.measurementId} onChange={(e) => set("measurementId", e.target.value.toUpperCase().trim())} placeholder="G-XXXXXXX" /></div>
          <div className="field"><label htmlFor="gs">API secret</label><input id="gs" type="password" className="input" value={f.apiSecret} onChange={(e) => set("apiSecret", e.target.value)} placeholder={initial.ga4?.secretHint ? `Saved (${initial.ga4.secretHint}) — blank keeps it` : ""} autoComplete="off" /></div>
        </div>
        {initial.ga4?.check && <p className="small" style={{ marginBottom: 0 }}>{initial.ga4.check.message}</p>}
      </div>
      <div className="card" style={{ padding: 20 }}>
        <div className="row between wrap" style={{ gap: 8 }}><h3 style={{ margin: 0 }}>Google Ads conversion</h3><span className={`chip ${initial.gads ? "c-draft" : "c-draft"}`}>{initial.gads ? "Added (tag only)" : "Not set up"}</span></div>
        <p className="small muted">Counts purchases for your Google Ads campaigns (Goals → Conversions → your purchase action → Tag setup → “Use Google tag”).</p>
        <div className="grid2">
          <div className="field"><label htmlFor="aw">Conversion ID</label><input id="aw" className="input mono" value={f.conversionId} onChange={(e) => set("conversionId", e.target.value.toUpperCase().trim())} placeholder="AW-123456789" /></div>
          <div className="field"><label htmlFor="al">Conversion label</label><input id="al" className="input mono" value={f.conversionLabel} onChange={(e) => set("conversionLabel", e.target.value.trim())} placeholder="AbCdEfGhIj" /></div>
        </div>
      </div>
      <div className="card" style={{ padding: 20 }}>
        <h3 style={{ marginTop: 0 }}>When should a Cash on Delivery order count as a purchase?</h3>
        <p className="small muted" style={{ marginTop: 0 }}>Online payments count as soon as they are paid. For COD, a later point gives ad platforms more honest data (fake or refused orders are not counted).</p>
        <div style={{ display: "grid", gap: 6 }}>
          {MILESTONES.map(([k, l]) => <label key={k} className="row" style={{ gap: 8 }}><input type="radio" name="ms" checked={f.codMilestone === k} onChange={() => set("codMilestone", k)} /> {l}</label>)}
        </div>
      </div>
      <p className="small muted" style={{ margin: 0 }}>Your store shows buyers a cookie choice. Tags load and purchases are sent only for buyers who allow them.</p>
      <Msg m={msg} />
      <div><button className="btn btn-orange" disabled={busy}>{busy ? "Saving & checking…" : "Save & check"}</button></div>
    </form>
  );
}

type Conn = {
  fbUser: { id: string; name: string }; expiresAt: string | null;
  businesses: Array<{ id: string; name: string }>; pages: Array<{ id: string; name: string; instagram?: { id: string; name: string } | null }>;
  adAccounts: Array<{ id: string; name: string; currency?: string }>;
  selected: { businessId?: string; pageId?: string; adAccountId?: string };
  verified: { business?: string; page?: string; instagram?: string; adAccount?: string };
  lastSyncAt: string | null; lastSyncMessage: string | null;
} | null;

export function MetaConnect({ conn, appReady }: { conn: Conn; appReady: boolean }) {
  const router = useRouter();
  const [sel, setSel] = useState(conn?.selected ?? {});
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok?: string; err?: string } | null>(null);
  const ok = (v?: string) => <span className={`chip ${v ? "c-active" : "c-draft"}`}>{v ? "Connected" : "Not verified"}</span>;
  async function act(method: "PATCH" | "POST" | "DELETE") {
    if (method === "DELETE" && !confirm("Disconnect Facebook? Ad results stop updating.")) return;
    setBusy(method); setMsg(null);
    const r = await api<{ message?: string }>(method, "/api/portal/store/meta", method === "PATCH" ? sel : undefined);
    setBusy(null);
    setMsg(r.ok ? { ok: method === "POST" ? r.data.message ?? "Synced" : method === "DELETE" ? "Disconnected" : "Saved and verified." } : { err: r.error });
    router.refresh();
  }
  const page = conn?.pages.find((p) => p.id === sel.pageId);
  return (
    <div className="card" style={{ padding: 20, maxWidth: 860 }}>
      <div className="row between wrap" style={{ gap: 8 }}><h3 style={{ margin: 0 }}>Facebook, Instagram & Meta Ads</h3>{conn ? <span className="chip c-active">Logged in as {conn.fbUser.name}</span> : <span className="chip c-draft">Not connected</span>}</div>
      <p className="small muted">Connect your Meta Business account to pick your Facebook Page, Instagram account and ad account. We only read ad results (spend, clicks, purchases) to show them in Analytics.</p>
      {!conn ? (
        appReady ? <a className="btn btn-orange" href="/api/portal/store/meta/">Connect with Facebook</a>
          : <p className="small" style={{ background: "var(--gray-soft)", borderRadius: 10, padding: 12, margin: 0 }}>Connect with Facebook is not switched on yet — Vishwaship is completing Meta&apos;s app review. You can already add your Pixel below.</p>
      ) : (
        <>
          <div className="grid2">
            <div className="field"><label htmlFor="mb">Business</label>
              <select id="mb" className="input select" value={sel.businessId ?? ""} onChange={(e) => setSel({ ...sel, businessId: e.target.value || undefined })}><option value="">—</option>{conn.businesses.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select>
              <span>{ok(sel.businessId === conn.selected.businessId ? conn.verified.business : undefined)}</span></div>
            <div className="field"><label htmlFor="mp">Facebook Page</label>
              <select id="mp" className="input select" value={sel.pageId ?? ""} onChange={(e) => setSel({ ...sel, pageId: e.target.value || undefined })}><option value="">—</option>{conn.pages.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
              <span>{ok(sel.pageId === conn.selected.pageId ? conn.verified.page : undefined)} {page?.instagram ? <>Instagram @{page.instagram.name} {ok(sel.pageId === conn.selected.pageId ? conn.verified.instagram : undefined)}</> : sel.pageId ? <span className="small muted">No Instagram account linked to this page</span> : null}</span></div>
            <div className="field"><label htmlFor="ma">Ad account</label>
              <select id="ma" className="input select" value={sel.adAccountId ?? ""} onChange={(e) => setSel({ ...sel, adAccountId: e.target.value || undefined })}><option value="">—</option>{conn.adAccounts.map((a) => <option key={a.id} value={a.id}>{a.name} ({a.id.replace("act_", "")}{a.currency ? `, ${a.currency}` : ""})</option>)}</select>
              <span>{ok(sel.adAccountId === conn.selected.adAccountId ? conn.verified.adAccount : undefined)}</span></div>
          </div>
          {conn.lastSyncMessage && <p className="small muted">Ad results: {conn.lastSyncMessage}{conn.lastSyncAt ? ` (${new Date(conn.lastSyncAt).toLocaleString("en-IN")})` : ""}</p>}
          <Msg m={msg} />
          <div className="row wrap" style={{ gap: 8, marginTop: 12 }}>
            <button className="btn btn-orange" onClick={() => act("PATCH")} disabled={!!busy}>{busy === "PATCH" ? "Checking…" : "Save & verify"}</button>
            {conn.verified.adAccount && <button className="btn btn-outline" onClick={() => act("POST")} disabled={!!busy}>{busy === "POST" ? "Syncing…" : "Sync ad results now"}</button>}
            <a className="btn btn-outline" href="/api/portal/store/meta/">Reconnect</a>
            <button className="btn btn-outline" onClick={() => act("DELETE")} disabled={!!busy}>Disconnect</button>
          </div>
        </>
      )}
    </div>
  );
}

export function GoogleAdsUpload() {
  const router = useRouter();
  const ref = useRef<HTMLInputElement>(null);
  const [msg, setMsg] = useState<{ ok?: string; err?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  async function pick(file: File | undefined) {
    if (!file) return;
    setBusy(true); setMsg(null);
    const r = await fetch("/api/portal/store/ads-csv/", { method: "POST", headers: { "content-type": "text/csv" }, body: await file.text() });
    const j = await r.json().catch(() => ({}));
    setBusy(false); if (ref.current) ref.current.value = "";
    setMsg(r.ok ? { ok: `Imported ${j.saved} day/campaign rows${j.skipped ? ` (${j.skipped} skipped)` : ""}.` } : { err: j?.error?.message ?? "Upload failed" });
    router.refresh();
  }
  return (
    <div className="card" style={{ padding: 20, maxWidth: 860 }}>
      <h3 style={{ marginTop: 0 }}>Google Ads results</h3>
      <p className="small muted" style={{ marginTop: 0 }}>Google Ads → Campaigns → Download (CSV) with <b>Day</b>, Campaign, Cost, Impr., Clicks, Conversions and Conv. value columns. Uploading the same days again replaces them. Automatic Google Ads sync needs Google&apos;s API approval for Vishwaship.</p>
      <input ref={ref} type="file" accept=".csv,text/csv" hidden onChange={(e) => pick(e.target.files?.[0])} />
      <button className="btn btn-outline" onClick={() => ref.current?.click()} disabled={busy}><Upload size={14} aria-hidden /> {busy ? "Uploading…" : "Upload Google Ads CSV"}</button>
      <Msg m={msg} />
    </div>
  );
}
