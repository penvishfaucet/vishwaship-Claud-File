"use client";
import Link from "next/link";
import { useState } from "react";
import { Clock } from "lucide-react";

/** Queue a background export with the filters currently on screen; result goes to Tools → Report Download. */
export function QueueExport({ reportKey, filters }: { reportKey: string; filters: Record<string, string> }) {
  const [state, setState] = useState<"idle" | "busy" | "done" | "error">("idle");
  const [msg, setMsg] = useState("");
  async function go(format: "csv" | "xlsx") {
    setState("busy");
    const r = await fetch("/api/portal/report-exports", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ reportKey, format, filters }) });
    const j = await r.json().catch(() => ({}));
    if (r.ok) setState("done"); else { setState("error"); setMsg(j.error?.message ?? "Could not queue the export"); }
  }
  return (
    <span className="row wrap" style={{ gap: 6, alignItems: "center" }}>
      <button type="button" className="btn btn-outline" disabled={state === "busy"} onClick={() => go("xlsx")} title="Large exports are prepared in the background"><Clock size={16} /> Generate in background</button>
      {state === "done" && <span className="small t-credit" role="status">Queued — <Link className="link" href="/portal/tools/downloads/">Report Download</Link></span>}
      {state === "error" && <span className="small t-debit" role="alert">{msg}</span>}
    </span>
  );
}
