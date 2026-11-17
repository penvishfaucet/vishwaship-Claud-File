"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Pencil } from "lucide-react";
import { AddressForm } from "./AddressForm";

type Row = {
  id: string; code: string; label: string; contactName: string; email: string | null; mobile: string; line1: string; line2: string | null;
  city: string; state: string; pincode: string; active: boolean; isDefault: boolean; verified: boolean; createdBy: string | null; createdAt: string; courierSync: string[];
};

export function WarehouseTable({ rows }: { rows: Row[] }) {
  const router = useRouter();
  const [edit, setEdit] = useState<Row | null>(null);
  const [verify, setVerify] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  async function act(id: string, action: "set_default" | "deactivate" | "activate") {
    if (action === "deactivate" && !confirm("Deactivate this pickup address? It can’t be used for new shipments. Existing shipments keep their address.")) return;
    setBusy(id); setErr(null);
    const r = await fetch(`/api/portal/warehouses/${id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ action }) });
    setBusy(null);
    if (!r.ok) setErr((await r.json()).error?.message ?? "Could not update");
    router.refresh();
  }

  return (
    <>
      {err && <p className="err small" role="alert">{err}</p>}
      {edit && <AddressForm editing={edit} onDone={() => { setEdit(null); router.refresh(); }} />}
      {rows.length === 0 && <div className="card empty"><p className="muted">No addresses match these filters.</p></div>}
      {rows.length > 0 && (
        <div className="card p0 tbl-wrap">
          <table className="tbl">
            <thead><tr><th>S.No.</th><th>ID</th><th>Title</th><th>Contact details</th><th>Pincode</th><th>Address</th><th>Created by</th><th>Created at</th><th>Status</th><th>Action</th></tr></thead>
            <tbody>
              {rows.map((w, i) => (
                <tr key={w.id}>
                  <td>{i + 1}</td>
                  <td className="b">{w.code}</td>
                  <td><span className="b link-navy">{w.label}</span>{w.isDefault && <div><span className="chip c-active" style={{ marginTop: 4 }}>Default</span></div>}</td>
                  <td className="small"><b>{w.contactName}</b><br />{w.email ?? ""}{w.email ? <br /> : null}{w.mobile}</td>
                  <td>{w.pincode}</td>
                  <td className="small" style={{ maxWidth: 280 }}>{w.line1}{w.line2 ? `, ${w.line2}` : ""}, {w.city}, {w.state}, {w.pincode}</td>
                  <td className="small">{w.createdBy ?? "—"}</td>
                  <td className="small">{new Date(w.createdAt).toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}</td>
                  <td>
                    <span className={`chip ${w.active ? "c-active" : "c-cancelled"}`}>{w.active ? "Active" : "Inactive"}</span>
                    <div className="mt8"><span className={`chip ${w.verified ? "c-verified" : "c-pending"}`}>{w.verified ? "Mobile verified" : "Mobile not verified"}</span></div>
                    {w.courierSync.length > 0 && <div className="tiny muted mt8">{w.courierSync.join(" · ")}</div>}
                  </td>
                  <td>
                    <div className="col" style={{ gap: 4 }}>
                      <button className="icon-btn" aria-label={`Edit ${w.label}`} title="Edit" onClick={() => setEdit(w)}><Pencil size={15} /></button>
                      {!w.verified && w.active && <button className="btn btn-sm btn-orange" onClick={() => setVerify(verify === w.id ? null : w.id)}>Verify mobile</button>}
                      {w.active && !w.isDefault && <button className="btn btn-sm btn-outline" disabled={busy === w.id} onClick={() => act(w.id, "set_default")}>Set default</button>}
                      {w.active ? <button className="btn btn-sm btn-outline" disabled={busy === w.id} onClick={() => act(w.id, "deactivate")}>Deactivate</button>
                        : <button className="btn btn-sm btn-outline" disabled={busy === w.id} onClick={() => act(w.id, "activate")}>Activate</button>}
                    </div>
                    {verify === w.id && <AddressForm verifyId={w.id} mobile={w.mobile} />}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
