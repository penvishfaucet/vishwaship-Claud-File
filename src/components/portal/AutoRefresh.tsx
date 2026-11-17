"use client";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** Refresh the server-rendered page every few seconds while something is in progress. */
export function AutoRefresh({ active, everyMs = 4000 }: { active: boolean; everyMs?: number }) {
  const router = useRouter();
  useEffect(() => { if (!active) return; const t = setInterval(() => router.refresh(), everyMs); return () => clearInterval(t); }, [active, everyMs, router]);
  return null;
}
