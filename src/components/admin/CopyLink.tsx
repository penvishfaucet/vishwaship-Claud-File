"use client";
import { useEffect, useState } from "react";

/** Shows the full share URL (built from the current origin) with a copy button. */
export function CopyLink({ path }: { path: string }) {
  const [url, setUrl] = useState(path);
  const [copied, setCopied] = useState(false);
  useEffect(() => { setUrl(window.location.origin + path); }, [path]);
  async function copy() {
    try { await navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 1800); } catch { /* clipboard blocked */ }
  }
  return (
    <div className="row" style={{ gap: 8, alignItems: "center", minWidth: 0 }}>
      <input className="input" readOnly value={url} aria-label="Share link" onFocus={(e) => e.currentTarget.select()} style={{ minWidth: 0, flex: 1, fontSize: 12.5 }} />
      <button type="button" className="btn btn-sm btn-orange" onClick={copy}>{copied ? "Copied" : "Copy"}</button>
    </div>
  );
}
