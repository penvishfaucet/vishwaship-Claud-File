import { readSettings } from "@/lib/store-themes";
import { PagesForm } from "@/components/portal/store/SettingsForms";
import { requireStorePage } from "@/server/store/portal";
import "@/styles/store.css";

export const metadata = { title: "Store pages & SEO — Vishwaship" };

export default async function StorePages() {
  const { store } = await requireStorePage();
  return (
    <>
      <div className="page-h"><div><p className="small muted" style={{ margin: 0 }}><a href="/portal/store/">Online Store</a></p><h1>Pages & SEO</h1></div></div>
      <PagesForm initial={readSettings(store.settings)} storeName={store.name} />
    </>
  );
}
