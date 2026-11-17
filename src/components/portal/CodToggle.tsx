"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";

export function CodToggle({ enabled }: { enabled: boolean }) {
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  async function set(v: boolean) {
    if (v && !confirm("Subscribe to WhatsApp COD confirmation? New COD orders will wait for buyer confirmation before booking, and 2 credits are used per confirmation.")) return;
    setBusy(true);
    await fetch("/api/portal/notifications", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ channel: "whatsapp", event: "cod_confirmation", enabled: v }) });
    setBusy(false); router.refresh();
  }
  return enabled
    ? <button className="btn btn-outline" disabled={busy} onClick={() => set(false)}>Disable</button>
    : <button className="btn btn-orange" disabled={busy} onClick={() => set(true)}>Enable</button>;
}
