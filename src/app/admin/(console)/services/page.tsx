import Link from "next/link";
import { ServicesHub } from "@/components/admin/ServicesHub";
import { can } from "@/server/auth/rbac";
import { requireStaff } from "@/server/auth/session";
import { servicesOverview } from "@/server/integrations/services";

export const dynamic = "force-dynamic";
export const metadata = { title: "API Keys & Services — Vishwaship Admin" };

/** Admin → Settings → API Keys & Services: every outside service is connected here, without touching the server. */
export default async function ServicesPage() {
  const s = await requireStaff("integrations.read");
  const services = await servicesOverview();
  return (
    <>
      <div className="page-h"><div>
        <h1>API Keys &amp; Services</h1>
        <p className="small muted" style={{ margin: "4px 0 0" }}>Connect email, Google sign-in and WhatsApp by pasting the provider&apos;s keys. Steps for each service are on its card. Keys are stored encrypted, can never be viewed again (only replaced), and every change is in the Audit Log.</p>
      </div></div>
      <ol className="svc-steps small">
        <li><b>Get the keys</b> from the provider (open “How to get these keys”).</li>
        <li><b>Paste and Save</b>.</li>
        <li><b>Test connection</b> — it calls the provider with your keys.</li>
        <li><b>Turn ON</b> — the service starts working immediately, no deploy.</li>
      </ol>
      <ServicesHub services={services} write={can(s.role, "integrations.write")} />
      <section className="card svc-card mt16">
        <h2>Other connections</h2>
        <ul className="plain-list small">
          <li><Link className="link" href="/admin/payments/">Payment Settings</Link> — Razorpay and Cashfree keys for wallet recharge.</li>
          <li><Link className="link" href="/admin/carriers/">Courier Integrations</Link> — Shipmozo, Delhivery, Shipora X and other courier accounts.</li>
          <li><Link className="link" href="/admin/settings/email/">Email &amp; Sign-in</Link> — sender emails, OTP rules, email templates and logs.</li>
          <li><Link className="link" href="/admin/whatsapp/">WhatsApp Ops</Link> — template mapping, COD confirmation rules and message log.</li>
        </ul>
        <p className="tiny muted">A completely new provider (for example a different SMS company) needs a one-time connection in the code before its keys can be used here.</p>
      </section>
    </>
  );
}
