import { mobileJson } from "@/server/mobile/http";
import { pushConfigured } from "@/server/mobile/push";

/** Public app configuration (no sign-in): server/Admin changes reach installed apps without a new release. */
export async function GET() {
  return mobileJson({
    minSupportedVersionCode: Number(process.env.ANDROID_MIN_VERSION_CODE ?? 1),
    pushAvailable: pushConfigured(),
    links: { terms: "/terms/", privacy: "/privacy/", refund: "/refund-policy/", support: "/customer-care/", accountDeletion: "/account-deletion/", track: "/track/" },
  });
}
