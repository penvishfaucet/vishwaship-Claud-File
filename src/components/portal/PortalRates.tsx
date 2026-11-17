"use client";
import { useState } from "react";
import { RateCalculator } from "@/components/public/RateCalculator";

export function PortalRates({ presets }: { presets: Array<{ label: string; pincode: string }> }) {
  const [origin, setOrigin] = useState(presets[0]?.pincode ?? "110034");
  return (
    <>
      {presets.length > 0 && (
        <div className="field mb12" style={{ maxWidth: 360 }}>
          <label htmlFor="preset">Saved pickup address</label>
          <select id="preset" className="select" value={origin} onChange={(e) => setOrigin(e.target.value)}>
            {presets.map((p) => <option key={p.pincode + p.label} value={p.pincode}>{p.label}</option>)}
          </select>
        </div>
      )}
      <RateCalculator
        key={origin}
        scope="portal"
        layout="wide"
        initial={{ origin }}
        bookHref={(o, f) => `/portal/orders/new/?dest=${f.destination}&weight=${f.weightKg}&mode=${o.mode}`}
      />
    </>
  );
}
