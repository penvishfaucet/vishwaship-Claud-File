import { GatewayForm, PrimaryPicker } from "@/components/portal/store/Gateways";
import { RazorpayForm } from "@/components/portal/store/StoreOps";
import { orgSetting } from "@/server/couriers";
import { onlineMethods } from "@/server/store/checkout";
import { GATEWAYS, GATEWAY_KEYS, gatewayOverview } from "@/server/store/gateways";
import { requireStorePage } from "@/server/store/portal";
import { razorpayOverview } from "@/server/store/razorpay";
import "@/styles/store.css";

export const metadata = { title: "Store payments — Vishwaship" };

const HELP: Record<string, string> = {
  cashfree: "Cashfree Merchant Dashboard → Developers → API Keys. Use the Payment Gateway App ID and Secret key. Sandbox keys work only in Test mode.",
  phonepe: "PhonePe Business Dashboard → Developer Settings → API keys. Copy the Client ID, Client version and Client secret for Standard Checkout.",
  paytm: "Paytm Business Dashboard → Developer Settings → API Keys. Copy the Merchant ID (MID) and the 16-character Merchant key for Test or Production.",
};

export default async function StorePayments() {
  const { ctx } = await requireStorePage();
  const [rz, gws, methods, pref] = await Promise.all([razorpayOverview(ctx.org.id), gatewayOverview(ctx.org.id), onlineMethods(ctx.org.id), orgSetting<{ primary?: string }>(ctx.org.id, "store_payments")]);
  return (
    <>
      <div className="page-h"><div><p className="small muted" style={{ margin: 0 }}><a href="/portal/store/">Online Store</a></p><h1>Online payments</h1>
        <p className="small muted" style={{ margin: "4px 0 0", maxWidth: 760 }}>Connect any of your own payment gateways. Money from your store goes straight to your gateway account, not to your Vishwaship wallet. We confirm every payment with the gateway before an order is placed.</p></div></div>
      <PrimaryPicker methods={methods} primary={pref?.primary ?? null} />
      <div style={{ display: "grid", gap: 12 }}>
        <RazorpayForm initial={rz} />
        {GATEWAY_KEYS.map((k) => (
          <GatewayForm key={k} g={{ key: k, label: GATEWAYS[k].label, fields: GATEWAYS[k].fields.map((f) => ({ ...f })), help: HELP[k], initial: gws[k] ?? null }} />
        ))}
      </div>
      <p className="small muted" style={{ maxWidth: 760, marginTop: 12 }}>Cash on Delivery, COD fee and limits are set in <a className="orange" href="/portal/store/setup/4/">Store setup → Checkout</a>. COD money is collected by the courier and paid to you through your normal Vishwaship COD remittance. Need another gateway? Contact support and we will add it.</p>
    </>
  );
}
