import { readSettings } from "@/lib/store-themes";
import { ConnectForms } from "@/components/portal/store/ConnectForms";
import { getSetting } from "@/server/quotes/service";
import { ownOverview } from "@/server/own-providers";
import { creditPrice } from "@/server/notifications/credits";
import { onlineMethods } from "@/server/store/checkout";
import { CNAME_TARGET, listDomains } from "@/server/store/domains";
import { requireStorePage } from "@/server/store/portal";
import "@/styles/store.css";

export const metadata = { title: "Connect apps — Vishwaship" };

const appUrl = () => (process.env.APP_URL ?? "https://vishwaship.com").replace(/\/$/, "");

/**
 * Online Store → Connect apps (phase 8): one place to connect the merchant's OWN domain, payment gateway, one-click
 * checkout, buyer-login OTP and WhatsApp, each with step-by-step instructions, and what it costs when they use
 * Vishwaship's instead (credits at Admin-set prices, so Vishwaship never pays for a merchant's usage).
 */
export default async function ConnectApps() {
  const { ctx, store } = await requireStorePage();
  const settings = readSettings(store.settings);
  const [domains, methods, own, costs, price] = await Promise.all([
    listDomains(ctx.org.id), onlineMethods(ctx.org.id), ownOverview(ctx.org.id),
    getSetting<Record<string, number>>("notification_credit_cost", {}), creditPrice(),
  ]);
  const rupee = (credits: number) => `₹${((credits * price.paisePerCredit) / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
  const otpCredits = costs.value.store_otp ?? 4, waCredits = costs.value.whatsapp ?? 1;
  const live = domains.find((d) => d.status === "verified");
  const hostDomain = (() => { try { return new URL(appUrl()).hostname; } catch { return "vishwaship.com"; } })();
  const Card = ({ id, title, status, ok, children }: { id: string; title: string; status: string; ok: boolean | null; children: React.ReactNode }) => (
    <section id={id} className="card mb12" style={{ padding: 18 }}>
      <div className="row between wrap" style={{ gap: 8 }}><h2 className="h3" style={{ margin: 0 }}>{title}</h2><span className={`chip ${ok ? "c-active" : ok === false ? "c-draft" : "c-pending"}`}>{status}</span></div>
      {children}
    </section>
  );
  return (
    <>
      <div className="page-h"><div><p className="small muted" style={{ margin: 0 }}><a href="/portal/store/">Online Store</a></p><h1>Connect apps</h1>
        <p className="small muted" style={{ margin: "4px 0 0", maxWidth: 760 }}>Use your own accounts (you pay those companies directly, Vishwaship charges nothing for them) or Vishwaship&apos;s (charged per use from your notification credits). Every step is written below.</p></div></div>
      <nav className="pills mb12" aria-label="Jump to">{[["domain", "Domain"], ["payments", "Payments"], ["oneclick", "One-click checkout"], ["otp", "Buyer login OTP"], ["whatsapp", "WhatsApp"], ["email", "Email"]].map(([k, l]) => <a key={k} className="pill" href={`#${k}`}>{l}</a>)}</nav>

      <Card id="domain" title="1. Your own domain (www.yourbrand.com)" status={live ? `Connected: ${live.hostname}` : domains.length ? "Waiting for DNS" : "Not connected"} ok={live ? true : domains.length ? false : null}>
        <ol className="os-steps">
          <li>Buy a domain from any registrar (GoDaddy, Hostinger, BigRock, Namecheap…). Your store already works at <b>{appUrl()}/s/{store.slug}</b> without one.</li>
          <li>Open <a className="orange" href="/portal/store/domains/">Domains</a>, type the domain (use <b>www.yourbrand.com</b>) and tap <b>Add</b>.</li>
          <li>In your registrar&apos;s DNS settings add the records Vishwaship shows: a <b>TXT</b> record (proves the domain is yours) and a <b>CNAME</b> for <b>www</b> pointing to <b className="mono">{CNAME_TARGET()}</b> (for a bare domain like yourbrand.com, the <b>A</b> record shown there). Delete any old A / CNAME record for the same name first.</li>
          <li>Wait 10 minutes to a few hours, then tap <b>Verify</b>. When it shows <b>Verified</b>, tap <b>Make primary</b>. SSL (https) is issued automatically.</li>
          <li>Using your own Firebase for buyer OTP? Add the domain under Firebase → Authentication → Settings → <b>Authorized domains</b> too.</li>
        </ol>
      </Card>

      <Card id="payments" title="2. Online payments (your own gateway)" status={methods.length ? `Connected: ${methods.join(", ")}` : "Cash on Delivery only"} ok={methods.length ? true : null}>
        <ol className="os-steps">
          <li>Create a business account with <b>Razorpay</b> (or Cashfree, PhonePe Business, Paytm Business) and finish its KYC. Money from buyers goes straight to your bank account.</li>
          <li>Razorpay: Dashboard → Account &amp; Settings → <b>API Keys</b> → Generate <b>Live</b> key. Copy the Key ID and Key Secret.</li>
          <li>Open <a className="orange" href="/portal/store/payments/">Online Payments</a>, paste the keys and tap <b>Save &amp; check</b>. Vishwaship checks them with the gateway before buyers see &ldquo;Pay online&rdquo;.</li>
          <li>Razorpay webhook (recommended): Razorpay Dashboard → Webhooks → Add, paste the URL shown on the Online Payments page, tick <b>payment.captured</b> and <b>order.paid</b>.</li>
          <li>The gateway&apos;s own fees are charged by them. Vishwaship&apos;s store fee is described on <a className="orange" href="/portal/store/plan/">Store Plan</a>.</li>
        </ol>
      </Card>

      <Card id="oneclick" title="3. One-click checkout (Razorpay Magic, GoKwik, Shopflo, Cashfree)" status={settings.oneClick.status === "active" ? `Active: ${settings.oneClick.provider}` : settings.oneClick.status === "requested" ? "Requested — being activated" : "Not connected"} ok={settings.oneClick.status === "active" ? true : settings.oneClick.status === "requested" ? false : null}>
        <p className="small" style={{ margin: "8px 0" }}>One-click checkout fills the buyer&apos;s saved address and phone in one tap and can raise conversions. Each provider has to approve your business first and switch it on for a custom website, so it works in two steps:</p>
        <ol className="os-steps">
          <li>Sign up with the provider: <b>Razorpay Magic Checkout</b> (Razorpay Dashboard → Magic Checkout → choose <b>Custom e-commerce platform</b>), <b>GoKwik</b> (gokwik.co → Get started), <b>Shopflo</b> or <b>Cashfree One Click Checkout</b>. Use the same business details as your store.</li>
          <li>Below, choose the provider and give your merchant ID from them, then tap <b>Request activation</b>. Vishwaship sets up the shipping, COD and coupon links the provider needs (your shipping rates, COD rules and coupons come from this store).</li>
          <li>When the provider confirms, Vishwaship switches it on and the status here becomes <b>Active</b>. Until then buyers use the normal Vishwaship checkout, which already supports saved addresses, COD and your gateway.</li>
        </ol>
      </Card>

      <Card id="otp" title="4. Buyer login OTP (My Account)" status={settings.buyerLogin.otp === "own_firebase" ? "Your own Firebase" : settings.buyerLogin.otp === "email_only" ? "Email codes only" : "Vishwaship OTP"} ok={true}>
        <ul className="os-steps">
          <li><b>Vishwaship OTP</b> (default): works at once. Each successful mobile login takes <b>{otpCredits} credits ({rupee(otpCredits)})</b> from your <a className="orange" href="/portal/billing/">notification credits</a>. With no credits left, buyers log in with an email code instead (free).</li>
          <li><b>Your own Firebase</b>: no Vishwaship charge; Google bills your Firebase project for SMS. Steps: <a className="orange" href="https://console.firebase.google.com/" target="_blank" rel="noopener noreferrer">console.firebase.google.com</a> → Add project → Build → <b>Authentication</b> → Get started → Sign-in method → <b>Phone</b> → Enable. Then Project settings → <b>Your apps</b> → Web app (&lt;/&gt;) → copy <b>apiKey, authDomain, projectId, appId</b> below. Add <b>{hostDomain}</b> and your own domain under Authentication → Settings → <b>Authorized domains</b>. Phone sign-in needs the Blaze (pay as you go) plan.</li>
          <li><b>Email codes only</b>: free; buyers get a 6-digit code by email.</li>
        </ul>
      </Card>

      <ConnectForms initial={{ buyerLogin: settings.buyerLogin, oneClick: settings.oneClick }} />

      <Card id="whatsapp" title="5. WhatsApp messages to buyers (order confirmed, cancelled, shipped, COD confirmation)" status={own.whatsapp?.on ? `Your own ${own.whatsapp.adapter.toUpperCase()}` : "Vishwaship WhatsApp"} ok={true}>
        <ul className="os-steps">
          <li><b>Vishwaship WhatsApp</b> (default): no setup. Each message takes <b>{waCredits} credit{waCredits === 1 ? "" : "s"} ({rupee(waCredits)})</b> from your notification credits.</li>
          <li><b>Your own WATI or AiSensy</b>: messages go from your own number and Vishwaship charges nothing. Steps: create the account and get your WhatsApp Business number approved → create and get approved the message templates (COD confirmation, out for delivery…) → WATI: copy <b>API endpoint</b> and <b>Access token</b> (WATI → API Docs); AiSensy: copy the <b>API key</b> and campaign names → paste them in <a className="orange" href="/portal/integrations/own-apis/">Integrations → Own APIs</a> → <b>Test</b> → switch on. Paste the webhook URL shown there into WATI / AiSensy so buyer replies come back.</li>
        </ul>
      </Card>

      <Card id="email" title="6. Emails to buyers" status="Vishwaship email — free" ok={true}>
        <p className="small" style={{ margin: "8px 0 0" }}>Order, return and login-code emails go from Vishwaship&apos;s email service with your store name. No setup and no charge.</p>
      </Card>
    </>
  );
}
