import { rupees } from "@/lib/store-themes";
import { AddressBook, BuyerLogin, LogoutButton, ProfileName } from "@/components/store/BuyerAccount";
import { StoreShell } from "@/components/store/Storefront";
import { firebasePhoneConfig } from "@/server/auth/firebase-phone";
import { currentBuyer } from "@/server/store/buyers";
import { FULFILMENT_LABEL, PAYMENT_LABEL, buyerOrders } from "@/server/store/orders";
import { RETURN_STATUS_LABEL } from "@/server/store/returns";
import { type SfParams, type SfSearch, resolveSf, sfMeta } from "../_sf";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params, searchParams }: { params: SfParams; searchParams: SfSearch }) {
  const m = await sfMeta(await resolveSf(params, searchParams, { allowUnavailable: true }), "/account/", "My account");
  return { ...m, robots: { index: false, follow: false } };
}

const day = (d: Date) => new Date(d).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", year: "numeric" });

/** Buyer's My Account: log in (mobile OTP / email code), orders + tracking + returns, saved addresses, name. */
export default async function Account({ params, searchParams }: { params: SfParams; searchParams: SfSearch }) {
  const sf = await resolveSf(params, searchParams, { allowUnavailable: true });
  const sp = await searchParams;
  const next = typeof sp.next === "string" && sp.next.startsWith(`${sf.base}/`) ? sp.next : `${sf.base}/account/`;
  if (sf.demo || sf.preview) {
    return <StoreShell sf={sf}><div className="sf-wrap sf-page" style={{ maxWidth: 560 }}><h1>My account</h1><p className="sf-note">Buyers log in here on a published store to see orders, track them, save addresses and ask for returns.</p></div></StoreShell>;
  }
  const me = await currentBuyer(sf.id);
  if (!me) {
    return <StoreShell sf={sf}><div className="sf-wrap sf-page" style={{ maxWidth: 480 }}><BuyerLogin store={sf.slug} phone={await firebasePhoneConfig()} next={next} /></div></StoreShell>;
  }
  const orders = await buyerOrders(me);
  return (
    <StoreShell sf={sf}>
      <div className="sf-wrap sf-page sf-acct">
        <div className="sf-acct-h">
          <div><h1>My account</h1><p className="sf-note" style={{ margin: 0 }}>{[me.mobile && `+91 ${me.mobile}`, me.email].filter(Boolean).join(" · ")}</p></div>
          <LogoutButton store={sf.slug} base={sf.base} />
        </div>
        <section aria-labelledby="acct-orders">
          <h2 id="acct-orders">My orders</h2>
          {orders.length === 0 ? <div className="sf-empty"><p>No orders yet.</p><a className="sf-btn" href={`${sf.base}/shop/`}>Start shopping</a></div> : (
            <div className="sf-olist">{orders.map((o) => (
              <a key={o.id} className="sf-ocard" href={`${sf.base}/order/${encodeURIComponent(o.number)}/`}>
                <div className="oc-t"><b>{o.number}</b><span className="sf-note">{day(o.createdAt)}</span></div>
                <div className="sf-note">{o.lines.slice(0, 2).map((l) => `${l.title}${l.variantTitle ? ` (${l.variantTitle})` : ""} × ${l.qty}`).join(", ")}{o.lines.length > 2 ? ` +${o.lines.length - 2} more` : ""}</div>
                <div className="oc-b">
                  <span className={`sf-tag ${o.status === "cancelled" ? "bad" : o.fulfilment === "delivered" ? "ok" : ""}`}>{o.status === "pending_payment" ? "Awaiting payment" : o.status === "cancelled" ? "Cancelled" : FULFILMENT_LABEL[o.fulfilment]}</span>
                  {o.returnRequest && <span className="sf-tag">{o.returnRequest.type === "exchange" ? "Exchange" : "Return"}: {RETURN_STATUS_LABEL[o.returnRequest.status]}</span>}
                  <b style={{ marginLeft: "auto" }}>{rupees(o.totalPaise)}</b>
                </div>
                <div className="sf-note">{PAYMENT_LABEL[o.paymentStatus] ?? o.paymentStatus}{o.awb ? ` · ${o.trackingLabel ?? ""}` : ""}</div>
              </a>
            ))}</div>
          )}
        </section>
        <section aria-labelledby="acct-addr">
          <h2 id="acct-addr">Saved addresses</h2>
          <AddressBook store={sf.slug} addresses={me.addresses} />
        </section>
        <section aria-labelledby="acct-me">
          <h2 id="acct-me">Your name</h2>
          <ProfileName store={sf.slug} name={me.name} />
        </section>
      </div>
    </StoreShell>
  );
}
