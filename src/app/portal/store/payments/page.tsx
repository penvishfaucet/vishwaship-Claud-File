import { RazorpayForm } from "@/components/portal/store/StoreOps";
import { requireStorePage } from "@/server/store/portal";
import { razorpayOverview } from "@/server/store/razorpay";
import "@/styles/store.css";

export const metadata = { title: "Store payments — Vishwaship" };

export default async function StorePayments() {
  const { ctx } = await requireStorePage();
  return (
    <>
      <div className="page-h"><div><p className="small muted" style={{ margin: 0 }}><a href="/portal/store/">Online Store</a></p><h1>Online payments</h1></div></div>
      <RazorpayForm initial={await razorpayOverview(ctx.org.id)} />
      <p className="small muted" style={{ maxWidth: 760, marginTop: 12 }}>Cash on Delivery, COD fee and limits are set in <a className="orange" href="/portal/store/setup/4/">Store setup → Checkout</a>. COD money is collected by the courier and paid to you through your normal Vishwaship COD remittance.</p>
    </>
  );
}
