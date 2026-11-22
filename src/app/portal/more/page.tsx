import { eq } from "drizzle-orm";
import { MoreMenu } from "@/components/portal/MoreMenu";
import { NAV_LABEL_DEFAULTS } from "@/components/portal/nav";
import { MODULES } from "@/lib/modules";
import { customerLogout } from "@/server/auth/actions";
import { CONTENT_KEYS, t } from "@/server/content";
import { getDb, schema } from "@/server/db/client";
import { resolveFeatures } from "@/server/features";
import { onboardingState } from "@/server/onboarding";
import { readAvatar } from "@/server/portal/avatar";
import { portalContext } from "@/server/portal/context";

export const metadata = { title: "More — Vishwaship" };

const STATUS = {
  active: { label: "Verified", tone: "ok", href: "/portal/kyc/" },
  review: { label: "KYC under review", tone: "warn", href: "/portal/kyc/" },
  kyc: { label: "KYC pending", tone: "warn", href: "/portal/kyc/" },
  resubmit: { label: "Changes needed", tone: "bad", href: "/portal/kyc/" },
  profile: { label: "Complete your profile", tone: "warn", href: "/portal/onboarding/" },
} as const;

export default async function MorePage() {
  const ctx = await portalContext();
  const f = await resolveFeatures(ctx.org.id);
  const modules = Object.fromEntries(MODULES.map((m) => [m.key, { enabled: f.modules[m.key].enabled, lockable: m.needsPlan }]));
  const labels = Object.fromEntries(await Promise.all(Object.keys(NAV_LABEL_DEFAULTS).filter((id) => `nav.${id}` in CONTENT_KEYS).map(async (id) => [id, await t(`nav.${id}`)])));
  const db = await getDb();
  const [u] = await db.select({ mobile: schema.users.mobile, email: schema.users.email }).from(schema.users).where(eq(schema.users.id, ctx.session.userId));
  const [avatar, ob, phone] = await Promise.all([readAvatar(ctx.session.userId), onboardingState(ctx.org.id), t("portal.support.phone")]);
  return (
    <>
      <h1 style={{ fontSize: 22, margin: "0 0 12px" }}>More</h1>
      <MoreMenu
        user={{ name: ctx.session.name, email: u?.email ?? ctx.session.email ?? null, mobile: u?.mobile ?? null, role: ctx.session.impersonatorId ? "Viewed by Vishwaship staff" : "Account owner", orgName: ctx.org.businessName }}
        avatar={avatar} summary={{ walletPaise: ctx.walletAvailable, status: STATUS[ob.step] ?? null }}
        modules={modules} labels={labels} supportPhone={phone} logout={customerLogout}
      />
    </>
  );
}
