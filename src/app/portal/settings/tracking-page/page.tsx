import { TrackingPageEditor } from "@/components/portal/TrackingPageEditor";
import { t } from "@/server/content";
import { requireFeature } from "@/server/features";
import { portalContext } from "@/server/portal/context";
import { getOrCreateTrackingPage } from "@/server/tracking/pages";
import { TrackingPageSettings, defaultTrackingSettings } from "@/lib/tracking-page";

export default async function TrackingPageSettingsPage() {
  const ctx = await portalContext();
  await requireFeature(ctx.org.id, "branded_tracking");
  const page = await getOrCreateTrackingPage(ctx.org.id);
  const draft = TrackingPageSettings.safeParse(page.draft);
  const appUrl = (process.env.APP_URL ?? "").replace(/\/$/, "");
  return (
    <>
      <div className="page-h"><div><h1>Branded Tracking Page</h1><p className="small muted" style={{ margin: "4px 0 0" }}>{await t("portal.tracking_page.help")}</p></div></div>
      <TrackingPageEditor
        initial={draft.success ? draft.data : defaultTrackingSettings(ctx.org.businessName)}
        status={{ isPublished: page.isPublished, publishedAt: page.publishedAt?.toISOString() ?? null, disabledByAdmin: page.disabledByAdmin, hasUnpublished: JSON.stringify(page.draft) !== JSON.stringify(page.published) }}
        publicUrl={`${appUrl}/t/${page.slug}`}
      />
    </>
  );
}
