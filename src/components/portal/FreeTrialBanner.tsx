import { Gift } from "lucide-react";
import { orgFreeTrialWindow } from "@/server/free-trial";

/** Dashboard banner during the client's free first month (launch offer). */
export async function FreeTrialBanner({ orgId }: { orgId: string }) {
  const w = await orgFreeTrialWindow(orgId).catch(() => null);
  const now = new Date();
  if (!w || now < w.from || now >= w.until) return null;
  const until = w.until.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" });
  const daysLeft = Math.max(1, Math.ceil((w.until.getTime() - now.getTime()) / 86_400_000));
  return (
    <div className="card mb12" role="status" style={{ display: "flex", gap: 12, alignItems: "flex-start", padding: 14, borderColor: "var(--orange-line)", background: "var(--orange-soft)" }}>
      <span style={{ color: "var(--orange)", flex: "none", marginTop: 2 }}><Gift size={22} aria-hidden="true" /></span>
      <div>
        <b>Your first month is free — {daysLeft} day{daysLeft > 1 ? "s" : ""} left (till {until})</b>
        <div className="small" style={{ marginTop: 4, lineHeight: 1.5 }}>
          WhatsApp COD confirmation on every COD order, WhatsApp updates, AI NDR calling and your Online Store are all free till then — no credits used.
        </div>
      </div>
    </div>
  );
}
