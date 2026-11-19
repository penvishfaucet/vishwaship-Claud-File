import Link from "next/link";
import { and, asc, eq } from "drizzle-orm";
import { CreateShipment, type DraftOrder, type Library } from "@/components/portal/CreateShipment";
import { getDb, schema } from "@/server/db/client";
import { portalContext } from "@/server/portal/context";
import { getSetting } from "@/server/quotes/service";
import { pickupOtpRequired } from "@/server/warehouses";

/** Cartons carried over from the public Rate Calculator: "count*l*b*h*kg" items joined by "~". */
function parsePk(v?: string) {
  if (!v) return undefined;
  const out = v.split("~").slice(0, 20).map((x) => x.split("*")).filter((p) => p.length === 5 && p.every((n) => /^\d{1,5}(\.\d{1,3})?$/.test(n)))
    .map(([count, l, b, h, w]) => ({ count, l, b, h, w }));
  return out.length ? out : undefined;
}

export default async function NewOrderPage({ searchParams }: { searchParams: Promise<{ quick?: string; direction?: string; dest?: string; weight?: string; mode?: string; pay?: string; cod?: string; pk?: string; qc?: string; qs?: string; qt?: string; draft?: string }> }) {
  const sp = await searchParams;
  const ctx = await portalContext();
  const db = await getDb();
  const warehouses = await db.select().from(schema.warehouses).where(and(eq(schema.warehouses.orgId, ctx.org.id), eq(schema.warehouses.active, true)));
  const threshold = await getSetting<number>("b2b_threshold_grams", 10_000);
  const otpRequired = await pickupOtpRequired();
  // Orders → Drafts → Edit draft (tenant-scoped; only orders that are not booked yet)
  let draft: DraftOrder | undefined;
  if (sp.draft && /^[A-Za-z0-9_-]{4,64}$/.test(sp.draft)) {
    const [o] = await db.select().from(schema.orders).where(and(eq(schema.orders.id, sp.draft), eq(schema.orders.orgId, ctx.org.id)));
    if (o && ["draft", "ready", "booking_failed"].includes(o.status)) {
      const pk = await db.select().from(schema.packages).where(eq(schema.packages.orderId, o.id));
      const cn = o.consignee as Record<string, string>;
      const rs = (paise: number) => (paise ? String(paise / 100) : "");
      draft = {
        id: o.id, orderNumber: o.orderNumber, warehouseId: o.warehouseId ?? "", mode: o.mode === "B2B" ? "B2B" : "B2C", payment: (["prepaid", "cod", "fod"].includes(o.paymentType) ? o.paymentType : "prepaid") as DraftOrder["payment"],
        cod: rs(o.codAmountPaise), declared: rs(o.declaredValuePaise), invoice: o.invoiceNumber ?? "", eway: o.ewayBill ?? "",
        consignee: { name: cn.name ?? "", mobile: cn.mobile ?? "", email: cn.email ?? "", line1: cn.line1 ?? "", line2: cn.line2 ?? "", pincode: cn.pincode ?? "", city: cn.city ?? "", state: cn.state ?? "" },
        products: (o.products as Array<{ name: string; qty: number; unitPrice: number; hsn?: string }>).map((x) => ({ name: x.name === "Item" && o.status === "draft" ? "" : x.name, qty: String(x.qty), price: rs(x.unitPrice), hsn: x.hsn ?? "" })),
        pkgs: pk.map((x) => ({ count: String(x.count), l: String(x.lengthMm / 10), b: String(x.breadthMm / 10), h: String(x.heightMm / 10), w: String(x.actualWeightGrams / 1000) })),
      };
    }
  } // Admin → Warehouses switch; off = pickup addresses usable without OTP
  const [buyers, products, presets, tags] = await Promise.all([
    db.select().from(schema.buyers).where(eq(schema.buyers.orgId, ctx.org.id)).orderBy(asc(schema.buyers.name)).limit(500),
    db.select().from(schema.products).where(and(eq(schema.products.orgId, ctx.org.id), eq(schema.products.active, true))).orderBy(asc(schema.products.name)).limit(500),
    db.select().from(schema.packagingPresets).where(eq(schema.packagingPresets.orgId, ctx.org.id)).orderBy(asc(schema.packagingPresets.name)),
    db.select().from(schema.orderTags).where(eq(schema.orderTags.orgId, ctx.org.id)).orderBy(asc(schema.orderTags.name)),
  ]);
  const library = {
    buyers: buyers.map((b) => ({ id: b.id, name: b.name, mobile: b.mobile, email: b.email ?? "", addresses: b.addresses as Library["buyers"][number]["addresses"] })),
    products: products.map((p) => ({ id: p.id, name: p.name, sku: p.sku, price: p.unitPricePaise / 100, hsn: p.hsn ?? "", weightKg: p.weightGrams / 1000, l: p.lengthMm / 10, b: p.breadthMm / 10, h: p.heightMm / 10 })),
    presets: presets.map((p) => ({ id: p.id, name: p.name, l: p.lengthMm / 10, b: p.breadthMm / 10, h: p.heightMm / 10, tareKg: p.tareGrams / 1000, isDefault: p.isDefault })),
    tags: tags.map((t) => ({ id: t.id, name: t.name, color: t.color })),
  };
  return (
    <>
      <div className="page-h">
        <div>
          <h1>{draft ? `Edit ${draft.orderNumber}` : sp.direction === "reverse" ? "Create return" : sp.quick ? "Quick add" : "Create Order"}</h1>
          <p className="small muted" style={{ margin: "4px 0 0" }}>Domestic shipments across India</p>
        </div>
        <Link className="btn btn-outline" href="/portal/orders/">Cancel</Link>
      </div>
      {warehouses.length === 0 ? (
        <div className="card empty"><p className="muted">Add a pickup address before creating a shipment.</p><Link className="btn btn-orange btn-sm" href="/portal/addresses/">Add Pickup Address</Link></div>
      ) : (
        <CreateShipment
          warehouses={warehouses.map((w) => ({ id: w.id, label: w.label, city: w.city, pincode: w.pincode, verified: !!w.mobileVerifiedAt || !otpRequired, isDefault: w.isDefault, mobileMasked: `••••••${w.mobile.slice(-4)}` }))}
          walletPaise={ctx.walletAvailable}
          b2bThresholdGrams={threshold.value}
          direction={sp.direction === "reverse" ? "reverse" : "forward"}
          initial={{ destination: sp.dest, weightKg: sp.weight, mode: sp.mode === "B2B" ? "B2B" : sp.mode === "B2C" ? "B2C" : undefined,
            payment: sp.pay === "cod" || sp.pay === "fod" || sp.pay === "prepaid" ? sp.pay : undefined, codAmount: sp.cod && /^\d{1,7}(\.\d{1,2})?$/.test(sp.cod) ? sp.cod : undefined,
            packages: parsePk(sp.pk), draft,
            calc: sp.qc && sp.qs && /^[0-9]{1,9}$/.test(sp.qt ?? "") ? { carrierCode: sp.qc.slice(0, 60), serviceName: sp.qs.slice(0, 120), totalPaise: Number(sp.qt) } : undefined }}
          library={library}
        />
      )}
    </>
  );
}
