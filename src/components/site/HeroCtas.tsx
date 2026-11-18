"use client";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import type { Links } from "@/lib/site-content";
import type { SiteAuth } from "@/server/site/auth";
import { accountLinks, useKnownBrowser } from "./SiteChromeV2";
import { ADMIN_DASHBOARD } from "./nav";

/**
 * Hero actions (Calculate Rates + one account action + Track Shipment link), by account state:
 *  new / unknown visitor → Create Account
 *  returning, signed out → Login (Create Account stays in the header and menu)
 *  signed-in customer    → Dashboard;   signed-in staff → Admin Dashboard
 */
export function HeroCtas({ links, auth, text }: { links: Links; auth: SiteAuth; text: { primary: string; signup: string; login: string; dashboard: string; track: string } }) {
  const known = useKnownBrowser();
  const L = accountLinks(links, auth);
  const second = auth.customer ? <Link className="w-btn sec" href={L.dashboard}>{text.dashboard}</Link>
    : auth.staff ? <Link className="w-btn sec" href={ADMIN_DASHBOARD}>Admin Dashboard</Link>
      : known ? <a className="w-btn sec" href={L.login}>{text.login}</a>
        : <a className="w-btn sec" href={L.signup}>{text.signup}</a>;
  return (
    <>
      <div className="w-btns">
        <Link className="w-btn pri" href="/shipping-rate-calculator/">{text.primary}</Link>
        {second}
      </div>
      <Link className="w-tracklink" href="/track/">{text.track}<ArrowRight size={22} aria-hidden="true" /></Link>
    </>
  );
}
