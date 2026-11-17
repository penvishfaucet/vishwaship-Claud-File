import Link from "next/link";
import { Check, FileText, MapPin, PackageCheck, Plane, Smile, Truck, Package } from "lucide-react";
import { ArrowRight, Underline } from "@/components/icons";
import { RateCalculator } from "@/components/public/RateCalculator";
import { TrackForm } from "@/components/public/TrackForm";
import { RateCardTable } from "@/components/public/RateCardTable";
import { CARRIERS } from "@/lib/site";

export const dynamic = "force-dynamic";

export default function HomePage() {
  const strip = [...CARRIERS, ...CARRIERS];
  return (
    <>
      <section className="vs-hero">
        <div className="vs-wrap">
          <div>
            <span className="vs-eyebrow"><i />YOUR PAN-INDIA SHIPPING PARTNER</span>
            <h1 className="vs-h1">Big or small.<br />We ship it <span className="o">all.<Underline /></span></h1>
            <p className="lead2">From everyday parcels to heavy cargo, we bring reliable shipping right to your doorstep. Anywhere in India.</p>
            <div className="row wrap" style={{ gap: 30 }}>
              <Link className="vs-btn" href="/login/">LOGIN <ArrowRight /></Link>
              <Link className="vs-link" href="/signup/">CREATE AN ACCOUNT <ArrowRight /></Link>
            </div>
            <div className="vs-checks">
              <span><Check size={16} />Doorstep pickup</span>
              <span><Check size={16} />Pan-India delivery</span>
              <span><Check size={16} />Easy online booking</span>
            </div>
          </div>
          <div>
            <div className="vs-photo">
              <div className="img"><img alt="Courier holding parcels beside a delivery van" src="/brand/hero.jpg" /></div>
              <div className="vs-pill a"><span className="ic"><PackageCheck size={16} /></span>Picked up. On its way.</div>
              <div className="vs-pill b"><span className="ic"><Smile size={16} /></span>Shipping made simple.</div>
            </div>
            <div className="vs-tags"><span>Connecting India, doorstep to doorstep</span><span>Handled with care. Delivered with confidence.</span></div>
          </div>
        </div>
      </section>

      <div className="vs-wrap vs-partners vs-partners-top">
        <span className="vs-eyebrow">ONE PLATFORM. A WORLD OF COURIER CHOICES.</span>
        <div className="lslide" aria-label="Courier partners">
          <div className="lslide-track" style={{ animationDuration: "101.2s" }}>
            {strip.map((c, i) => (
              <div key={`${c.code}-${i}`} className="lslide-item" aria-hidden={i >= CARRIERS.length}>
                <img src={`/couriers/${c.code}.webp`} alt={c.name} />
              </div>
            ))}
          </div>
        </div>
        <div className="small muted">Carrier allocation depends on serviceability and availability.</div>
      </div>

      <div className="vs-wrap vs-track vs-track-flat" id="track">
        <div className="vs-trackcard">
          <div>
            <h3>Where’s your shipment?</h3>
            <p className="muted" style={{ margin: "8px 0 0", fontSize: 15 }}>Enter your AWB number to see live status — or log in to see all your shipments.</p>
          </div>
          <TrackForm />
        </div>
      </div>

      <section className="vs-sec" id="services">
        <div className="vs-wrap">
          <span className="vs-eyebrow">BUILT FOR EVERY SHIPMENT</span>
          <h2 className="vs-h2">Your shipping needs.<br />Our complete solutions.</h2>
          <div className="vs-cards">
            <div className="vs-card"><span className="n">01</span><span className="tile"><Package size={22} /></span><h3>Doorstep Courier</h3><p>Documents and parcels picked up from your door and delivered across India.</p><Link href="/book/">Send a parcel <ArrowRight /></Link></div>
            <div className="vs-card hl"><span className="n">02</span><span className="tile"><Truck size={22} /></span><h3>Cargo Shipping</h3><p>Heavy and bulk consignments moved safely with surface cargo options.</p><Link href="/book/">Ship your cargo <ArrowRight /></Link></div>
            <div className="vs-card"><span className="n">03</span><span className="tile"><Plane size={22} /></span><h3>Express Delivery</h3><p>When your shipment needs priority, choose express shipping to serviceable destinations.</p><Link href="/book/">Choose express <ArrowRight /></Link></div>
          </div>
        </div>
      </section>

      <section className="vs-sec" style={{ paddingTop: 0 }} id="calculator">
        <div className="vs-wrap">
          <div className="split" style={{ gap: 40, alignItems: "start" }}>
            <div>
              <span className="vs-eyebrow">TRANSPARENT PRICING</span>
              <h2 className="vs-h2">Know your rate.<br />Before you book.</h2>
              <p className="muted" style={{ fontSize: 16, lineHeight: 1.75, marginTop: 18 }}>Enter pickup and delivery pincodes with weight and size — see the final price instantly. No hidden charges.</p>
            </div>
            <div><RateCalculator scope="public" /></div>
          </div>
        </div>
      </section>

      <section className="vs-sec" style={{ paddingTop: 0 }} id="how">
        <div className="vs-wrap">
          <span className="vs-eyebrow">LESS EFFORT. MORE MOVEMENT.</span>
          <h2 className="vs-h2">From your door to theirs.<br />In three simple steps.</h2>
          <div className="vs-steps">
            <div className="vs-step"><div className="ic"><FileText size={22} /></div><small>01 / BOOK ONLINE</small><h4>Tell us what’s shipping</h4><p>Choose a service and add your pickup and delivery details.</p></div>
            <div className="vs-step"><div className="ic"><Truck size={22} /></div><small>02 / WE PICK IT UP</small><h4>Leave the trip to us</h4><p>Pack your shipment securely. We coordinate a convenient doorstep pickup.</p></div>
            <div className="vs-step"><div className="ic"><MapPin size={22} /></div><small>03 / TRACK &amp; RELAX</small><h4>Follow every milestone</h4><p>Once dispatched, use your AWB number to check shipment updates.</p></div>
          </div>
        </div>
      </section>

      <section className="vs-sec" style={{ paddingTop: 0 }} id="pricing">
        <div className="vs-wrap">
          <span className="vs-eyebrow">RATE CARD</span>
          <h2 className="vs-h2">Simple, zone-based pricing.</h2>
          <RateCardTable />
        </div>
      </section>

      <div className="vs-wrap">
        <div className="vs-cta">
          <div style={{ position: "relative", zIndex: 1 }}>
            <span className="vs-eyebrow">YOUR NEXT DELIVERY STARTS HERE</span>
            <h2>Ready, set, ship.</h2>
            <p>Small parcel or big plans. Let’s get them moving.</p>
          </div>
          <Link className="vs-btn" style={{ position: "relative", zIndex: 1 }} href="/book/">Book your shipment <ArrowRight /></Link>
        </div>
      </div>
    </>
  );
}
