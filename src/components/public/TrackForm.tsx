"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ArrowRight } from "@/components/icons";

export function TrackForm({ initial = "" }: { initial?: string }) {
  const [awb, setAwb] = useState(initial);
  const router = useRouter();
  return (
    <form className="vs-trackform" onSubmit={(e) => { e.preventDefault(); const v = awb.trim(); if (v) router.push(`/track/?awb=${encodeURIComponent(v)}`); }}>
      <label htmlFor="awb" className="sr-only">AWB / tracking number</label>
      <input id="awb" className="input" placeholder="Enter AWB / tracking number" required value={awb} onChange={(e) => setAwb(e.target.value)} maxLength={40} />
      <button className="vs-btn" style={{ justifyContent: "center" }}>Track <ArrowRight /></button>
    </form>
  );
}
