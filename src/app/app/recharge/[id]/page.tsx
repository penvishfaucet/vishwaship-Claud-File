export const metadata = { title: "Return to the Vishwaship app", robots: { index: false } };

/**
 * Cashfree return address for app recharges. On phones with the app this URL opens the app directly
 * (Android App Link). If it opens in a browser instead, the customer is told where to check the result.
 */
export default async function AppRechargeReturn({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const safe = /^[\w-]{4,64}$/.test(id) ? id : "";
  return (
    <main style={{ fontFamily: "system-ui, sans-serif", padding: 24, maxWidth: 480, margin: "0 auto", color: "#051C46" }}>
      <h1 style={{ fontSize: 20 }}>Payment submitted</h1>
      <p>Return to the Vishwaship app to see the result. Your wallet is credited only after we verify the payment with Cashfree, usually within a minute.</p>
      {safe && <p><a href={`/portal/billing/recharges/${safe}/`} style={{ color: "#0057B8" }}>Check this recharge on the website</a></p>}
    </main>
  );
}
