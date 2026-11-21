import { readTheme } from "@/lib/store-themes";
import { AiDesign } from "@/components/portal/store/AiDesign";
import { ThemeEditor } from "@/components/portal/store/ThemeEditor";
import { aiDesignReady } from "@/server/store/ai-design";
import { requireStorePage } from "@/server/store/portal";
import { storeBillingSetting, themeVersions } from "@/server/store/service";
import "@/styles/store.css";

export const metadata = { title: "Theme editor — Vishwaship" };

export default async function ThemePage() {
  const { ctx, store } = await requireStorePage();
  const [versions, cfg] = await Promise.all([themeVersions(ctx.org.id), storeBillingSetting()]);
  const draft = readTheme(store.draftTheme, store.themeKey);
  // jsonb does not keep key order, so compare with sorted keys
  const stable = (v: unknown): string => JSON.stringify(v, (_k, x) => (x && typeof x === "object" && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => a.localeCompare(b))) : x));
  const hasUnpublished = store.status === "live" && stable(draft) !== stable(readTheme(store.publishedTheme, store.themeKey));
  return (
    <>
      <div className="page-h"><div><p className="small muted" style={{ margin: 0 }}><a href="/portal/store/">Online Store</a></p><h1>Theme editor</h1></div></div>
      {!store.customDesign && <AiDesign ready={aiDesignReady()} compact />}
      <ThemeEditor mode="full" slug={store.slug} hiddenThemes={cfg.disabledThemes}
        initial={{ themeKey: store.themeKey, config: draft }}
        status={{ status: store.status, publishedAt: store.publishedAt?.toISOString() ?? null, customDesign: store.customDesign, hasUnpublished }}
        versions={versions.map((v) => ({ ...v, createdAt: v.createdAt.toISOString() }))} />
    </>
  );
}
