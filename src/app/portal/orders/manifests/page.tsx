import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { ManifestHistory } from "@/components/portal/ManifestHistory";
import { DailyManifest } from "@/components/portal/ManifestActions";
import { filterOptions } from "@/server/orders/view";
import { listManifests, type ManifestGroup } from "@/server/manifests/service";
import { portalContext } from "@/server/portal/context";

export const metadata = { title: "Manifest History — Vishwaship" };

/** Manifest History: every generated manifest of this account, original PDF + signed copy by Manifest ID. */
export default async function ManifestsPage() {
  const ctx = await portalContext();
  const [rows, opts] = await Promise.all([listManifests(ctx.org.id, 200), filterOptions(ctx.org.id)]);
  return (
    <div className="tk-page" style={{ maxWidth: 900 }}>
      <header className="tk-top">
        <Link href="/portal/orders/" className="tk-back" aria-label="Back to orders"><ChevronLeft size={24} aria-hidden /></Link>
        <h1>Manifest History</h1>
      </header>
      <DailyManifest couriers={opts.couriers} warehouses={opts.warehouses} />
      <ManifestHistory items={rows.map((m) => {
        const groups = m.groups as ManifestGroup[];
        const s = m.signedCopy as { name: string; uploadedAt: string } | null;
        return { id: m.id, manifestNo: m.manifestNo, scope: m.scope, bookingDate: m.bookingDate, awbCount: m.awbCount, boxCount: m.boxCount, createdAt: m.createdAt.toISOString(),
          couriers: [...new Set(groups.map((g) => g.carrier))], awbs: groups.flatMap((g) => g.rows.map((r) => r.awb)), signed: s ? { name: s.name, uploadedAt: s.uploadedAt } : null };
      })} />
    </div>
  );
}
