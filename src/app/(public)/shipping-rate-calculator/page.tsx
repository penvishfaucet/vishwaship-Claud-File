import { RateCalculator } from "@/components/public/RateCalculator";

export const metadata = { title: "Shipping Rate Calculator — Vishwaship.com" };

export default function RateCalcPage() {
  return (
    <section className="vs-sec">
      <div className="vs-wrap">
        <span className="vs-eyebrow">TRANSPARENT PRICING</span>
        <h1 className="vs-h2">Know your rate.<br />Before you book.</h1>
        <p className="muted" style={{ fontSize: 16, lineHeight: 1.75, margin: "12px 0 24px" }}>Enter pickup and delivery pincodes with weight and size — see the final price instantly. No hidden charges.</p>
        <RateCalculator scope="public" layout="wide" />
      </div>
    </section>
  );
}
