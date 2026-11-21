"use client";
import { useRef, useState } from "react";

type Log = { t: string; err?: boolean };
const BATCH_BYTES = 3_000_000;

async function post<T>(body: unknown): Promise<T> {
  const r = await fetch("/api/admin/store-package/", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j?.error?.message ?? `Request failed (${r.status})`);
  return j as T;
}
const toBase64 = async (f: File) => {
  const bytes = new Uint8Array(await f.arrayBuffer());
  let s = ""; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
};

/** Pick the package folder (manifest.json + images); it is uploaded in small batches and applied to the customer's store. */
export function PackageImport() {
  const input = useRef<HTMLInputElement>(null);
  const [customer, setCustomer] = useState("");
  const [slug, setSlug] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState<Log[]>([]);
  const [done, setDone] = useState<{ slug: string; storeId: string } | null>(null);
  const say = (t: string, err = false) => setLog((l) => [...l, { t, err }]);

  async function run(e: React.FormEvent) {
    e.preventDefault();
    setLog([]); setDone(null);
    const manifestFile = files.find((f) => f.webkitRelativePath.split("/").slice(1).join("/") === "manifest.json" || f.name === "manifest.json");
    if (!manifestFile) { say("manifest.json was not found in the chosen folder.", true); return; }
    let manifest: unknown;
    try { manifest = JSON.parse(await manifestFile.text()); } catch { say("manifest.json is not valid JSON.", true); return; }
    setBusy(true);
    try {
      const start = await post<{ orgId: string; storeId: string; slug: string; created: boolean; files: string[]; products: number; customer: string }>({ step: "start", customer, slug, manifest });
      say(`${start.customer}: ${start.created ? `new store created at /s/${start.slug}` : `updating store /s/${start.slug}`}. ${start.products} products, ${start.files.length} images.`);
      const byPath = new Map(files.map((f) => [f.webkitRelativePath.split("/").slice(1).join("/"), f]));
      const media: Record<string, string> = {};
      let batch: Array<{ name: string; base64: string }> = [], size = 0, sent = 0;
      const flush = async () => {
        if (!batch.length) return;
        Object.assign(media, (await post<{ media: Record<string, string> }>({ step: "media", orgId: start.orgId, files: batch })).media);
        sent += batch.length; say(`Images uploaded: ${sent}/${start.files.length}`);
        batch = []; size = 0;
      };
      for (const name of start.files) {
        const f = byPath.get(name);
        if (!f) throw new Error(`Image missing in the folder: ${name}`);
        const b64 = await toBase64(f);
        if (size + b64.length > BATCH_BYTES || batch.length >= 30) await flush();
        batch.push({ name, base64: b64 }); size += b64.length;
      }
      await flush();
      const r = await post<{ created: number; updated: number; categoriesAdded: number; theme: string | null; errors: string[]; errorCount: number }>({ step: "apply", orgId: start.orgId, manifest, media });
      say(`Done: ${r.created} products added, ${r.updated} updated, ${r.categoriesAdded} categories added${r.theme ? `, theme draft saved (${r.theme})` : ""}.`);
      for (const x of r.errors) say(x, true);
      if (r.errorCount > r.errors.length) say(`…and ${r.errorCount - r.errors.length} more problems`, true);
      setDone({ slug: start.slug, storeId: start.storeId });
    } catch (err) { say((err as Error).message, true); }
    setBusy(false);
  }

  return (
    <form className="card" onSubmit={run} style={{ padding: 16, display: "grid", gap: 12, maxWidth: 820 }}>
      <h3 style={{ margin: 0, fontSize: 15 }}>Import a store package</h3>
      <p className="small muted" style={{ margin: 0 }}>Sets up a customer&apos;s store from a package folder (manifest.json with products, categories and design, plus images). Products are matched by SKU and name, so running it again updates them. The design goes into the draft; nothing is published.</p>
      <div className="row wrap" style={{ gap: 10 }}>
        <div className="field" style={{ flex: 1, minWidth: 240 }}><label htmlFor="pk-c">Customer (login email, mobile or org ID)</label><input id="pk-c" className="input" value={customer} onChange={(e) => setCustomer(e.target.value)} required /></div>
        <div className="field"><label htmlFor="pk-s">Store link if new (optional)</label><input id="pk-s" className="input mono" value={slug} onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))} placeholder="from package" style={{ width: 180 }} /></div>
      </div>
      <div className="row wrap" style={{ gap: 10, alignItems: "center" }}>
        {/* @ts-expect-error webkitdirectory is a non-standard but widely supported attribute */}
        <input ref={input} type="file" webkitdirectory="" multiple hidden onChange={(e) => setFiles([...(e.target.files ?? [])])} />
        <button type="button" className="btn btn-outline" onClick={() => input.current?.click()}>Choose package folder</button>
        <span className="small muted">{files.length ? `${files.length} files selected` : "No folder chosen"}</span>
      </div>
      <div><button className="btn btn-orange" disabled={busy || !files.length || customer.trim().length < 3}>{busy ? "Importing…" : "Import"}</button></div>
      {log.length > 0 && (
        <ul className="small" style={{ margin: 0, paddingLeft: 18, display: "grid", gap: 4 }} role="status">
          {log.map((l, i) => <li key={i} style={{ color: l.err ? "var(--red, #b42318)" : undefined }}>{l.t}</li>)}
        </ul>
      )}
      {done && <p className="small" style={{ margin: 0 }}><a className="orange" href={`/admin/online-stores/${done.storeId}/`}>Open the store in admin</a> · <a className="orange" href={`/s/${done.slug}/?preview=1`} target="_blank" rel="noopener">Preview (customer login needed)</a></p>}
    </form>
  );
}
