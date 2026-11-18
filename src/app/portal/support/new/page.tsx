import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { RaiseTicketForm } from "@/components/portal/support/RaiseTicketForm";
import { portalContext } from "@/server/portal/context";
import { safeTicketsBack } from "@/lib/support-nav";

export default async function NewTicket({ searchParams }: { searchParams: Promise<{ awb?: string; category?: string; order?: string; back?: string }> }) {
  const sp = await searchParams;
  await portalContext();
  const backHref = safeTicketsBack(sp.back);
  return (
    <div className="tk-page">
      <header className="tk-top">
        <Link href={backHref} className="tk-back" aria-label="Back to tickets"><ChevronLeft size={24} aria-hidden /></Link>
        <h1>Raise Ticket</h1>
      </header>
      <RaiseTicketForm backHref={backHref} initial={{ category: sp.category, ref: (sp.awb || sp.order || "").slice(0, 60) }} />
    </div>
  );
}
