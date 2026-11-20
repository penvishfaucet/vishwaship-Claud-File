"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Calculator, Headset, Home, PackageSearch, UserCircle2 } from "lucide-react";
import { isCurrent } from "./nav";

/** Phones only: app-style bottom tab bar with the main public destinations and the account action. */
export function MobileTabBar({ accountHref, signedIn }: { accountHref: string; signedIn: boolean }) {
  const path = usePathname() ?? "/";
  const tabs = [
    { href: "/", label: "Home", Icon: Home },
    { href: "/shipping-rate-calculator/", label: "Rates", Icon: Calculator },
    { href: "/track/", label: "Track", Icon: PackageSearch },
    { href: "/customer-care/", label: "Support", Icon: Headset },
  ];
  return (
    <nav className="v4-tabbar" aria-label="Quick links">
      {tabs.map(({ href, label, Icon }) => {
        const on = isCurrent(path, href);
        return (
          <Link key={href} href={href} aria-current={on ? "page" : undefined} className={on ? "on" : ""}>
            <Icon size={21} aria-hidden="true" /><span>{label}</span>
          </Link>
        );
      })}
      <a href={accountHref} className="acct" aria-label={signedIn ? "My account" : "Login or sign up"}>
        <UserCircle2 size={22} aria-hidden="true" />
        <span>Account</span>
      </a>
    </nav>
  );
}
