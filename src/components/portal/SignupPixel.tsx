"use client";
import { useEffect } from "react";
import { cookieChoice, loadMetaPixel } from "@/components/site/CookieConsent";

/**
 * Meta Pixel "CompleteRegistration" for a brand-new account (Facebook / Instagram ads learn who signs up).
 * Only when the visitor accepted cookies on the website, and only once per account on this browser.
 */
export function SignupPixel({ pixelId, userId }: { pixelId: string; userId: string }) {
  useEffect(() => {
    if (cookieChoice() !== "granted") return;
    const key = `vs_reg_sent:${userId}`;
    try { if (localStorage.getItem(key)) return; } catch { return; }
    loadMetaPixel(pixelId);
    const fbq = (window as unknown as { fbq?: (...a: unknown[]) => void }).fbq;
    fbq?.("track", "CompleteRegistration", { content_name: "Vishwaship seller signup", status: true }, { eventID: `reg_${userId}` });
    try { localStorage.setItem(key, "1"); } catch { /* ignore */ }
  }, [pixelId, userId]);
  return null;
}
