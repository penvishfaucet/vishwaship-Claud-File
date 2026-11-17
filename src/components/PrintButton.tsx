"use client";
import { Printer } from "lucide-react";

export function PrintButton({ label = "Print / Save as PDF" }: { label?: string }) {
  return <button type="button" className="btn btn-orange btn-sm" onClick={() => window.print()}><Printer size={14} /> {label}</button>;
}
