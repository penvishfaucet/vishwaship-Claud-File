import Link from "next/link";
import { Lock } from "lucide-react";
import { moduleLabel } from "@/lib/modules";
import { t } from "@/server/content";
import { portalContext } from "@/server/portal/context";

export default async function UpgradePage({ searchParams }: { searchParams: Promise<{ module?: string }> }) {
  const { module } = await searchParams;
  await portalContext();
  return (
    <div className="card empty" style={{ maxWidth: 560, margin: "40px auto" }}>
      <Lock size={32} color="var(--orange)" />
      <h1 style={{ fontSize: 20, margin: 0 }}>{module ? moduleLabel(module) : "This feature"} isn’t available on your account</h1>
      <p className="muted">{await t("portal.upgrade.body")}</p>
      <div className="row" style={{ gap: 8 }}><Link className="btn btn-orange" href="/portal/support/new/?category=other&order=Plan%20upgrade">Contact support</Link><Link className="btn btn-outline" href="/portal/">Back to dashboard</Link></div>
    </div>
  );
}
