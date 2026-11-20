"use client";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import type { Links } from "@/lib/site-content";
import type { SiteAuth } from "@/server/site/auth";
import { accountLinks } from "./SiteChromeV2";
import { ADMIN_DASHBOARD } from "./nav";

/**
 * Hero actions: Check Your Rates + Sign Up (signed out) or Dashboard, a Login line and the Track Shipment link.
 */
export function HeroCtas({ links, auth, text }: { links: Links; auth: SiteAuth; text: { primary: string; signup: string; login: string; dashboard: string; track: string } }) {
  const L = accountLinks(links, auth);
  // "Check Your Rates" is the hero's main action (the old default label is upgraded; a custom Admin label is kept).
  const primary = !text.primary || text.primary === "Calculate Rates" ? "Check Your Rates" : text.primary;
  const signupLabel = !text.signup || text.signup === "Create Account" ? "Sign Up" : text.signup;
  return (
    <>
      <div className="w-btns">
        <Link className="w-btn pri" href="/shipping-rate-calculator/">{primary}<ArrowRight size={20} aria-hidden="true" /></Link>
        {auth.customer ? <Link className="w-btn sec" href={L.dashboard}>{text.dashboard}</Link>
          : auth.staff ? <Link className="w-btn sec" href={ADMIN_DASHBOARD}>Admin Dashboard</Link>
            : <a className="w-btn sec" href={L.signup}>{signupLabel}</a>}
      </div>
      {!auth.customer && !auth.staff && <p className="h5-login">Already have an account? <a href={L.login}>{text.login || "Login"}</a></p>}
      <Link className="h5-track" href="/track/">{text.track}<ArrowRight size={18} aria-hidden="true" /></Link>
    </>
  );
}
