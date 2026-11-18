"use client";
import Link from "next/link";
import { ArrowRight, LayoutDashboard, LogIn, Search, Shield, UserPlus } from "lucide-react";
import type { Links } from "@/lib/site-content";
import type { SiteAuth } from "@/server/site/auth";
import { accountLinks, useKnownBrowser } from "./SiteChromeV2";
import { ADMIN_DASHBOARD } from "./nav";

/**
 * Hero actions by account state:
 *  new / unknown visitor → Calculate Rates + Create Account (Login stays in the header)
 *  returning, signed out → Calculate Rates + Login (Create Account as a text link)
 *  signed-in customer    → Calculate Rates + Dashboard
 *  signed-in staff       → Calculate Rates + Admin Dashboard
 */
export function HeroCtas({ links, auth, text }: { links: Links; auth: SiteAuth; text: { primary: string; signup: string; login: string; dashboard: string } }) {
  const known = useKnownBrowser();
  const L = accountLinks(links, auth);
  const calc = <Link className="w-btn pri" href="/shipping-rate-calculator/">{text.primary} <ArrowRight size={18} aria-hidden="true" /></Link>;
  if (auth.customer) return <div className="w-btns">{calc}<Link className="w-btn sec" href={L.dashboard}><LayoutDashboard size={18} aria-hidden="true" />{text.dashboard}</Link></div>;
  if (auth.staff) return <div className="w-btns">{calc}<Link className="w-btn sec" href={ADMIN_DASHBOARD}><Shield size={18} aria-hidden="true" />Admin Dashboard</Link></div>;
  if (known) {
    return (
      <>
        <div className="w-btns">{calc}<a className="w-btn sec" href={L.login}><LogIn size={18} aria-hidden="true" />{text.login}</a></div>
        <p className="w-hero-alt">Need another account? <a href={L.signup}>{text.signup}</a></p>
      </>
    );
  }
  return (
    <>
      <div className="w-btns">{calc}<a className="w-btn sec" href={L.signup}><UserPlus size={18} aria-hidden="true" />{text.signup}</a></div>
      <p className="w-hero-alt">Already have an account? <a href={L.login}>{text.login}</a></p>
    </>
  );
}

export function HeroTrack({ heading }: { heading: string }) {
  return (
    <form className="w-htrack" action="/track/" method="get" role="search" aria-label={heading}>
      <label htmlFor="h-awb">{heading}</label>
      <div className="f">
        <input id="h-awb" name="awb" className="w-in" placeholder="Enter AWB or LR number" autoComplete="off" maxLength={40} required />
        <button className="w-btn navy" type="submit"><Search size={18} aria-hidden="true" />Track</button>
      </div>
    </form>
  );
}
