"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CalendarDays, ChevronDown, ChevronLeft, ClipboardList, FileText, MapPinned, Minus, Package, Plus, Search, Shuffle, Trash2, UserRound, Weight,
} from "lucide-react";
import { CreateOrderForm as Schema, crossIssues } from "@/lib/order-form-schema";
import { EWAY_THRESHOLD_PAISE, PACKAGE_TYPES, ROV_TYPES, dimensionLimitCm, ewayEnabled, invoiceTotals, toPaise, totalWeightKg } from "@/lib/order-form";

type Addr = { line1: string; line2: string; pincode: string; city: string; state: string };
type Buyer = Addr & { mobile: string; name: string; altMobile: string; email: string; gstin: string };
type Billing = Addr & { name: string; mobile: string };
type Product = { key: string; name: string; qty: string; unitPrice: string; hsn: string; category: string; sku: string; discount: string; taxPct: string; more: boolean };
type Box = { key: string; count: string; weightKg: string; lengthCm: string; breadthCm: string; heightCm: string };
type Form = {
  buyer: Buyer; billingSame: boolean; billing: Billing;
  orderNumber: string; orderDate: string; referenceId: string; invoiceNumber: string;
  products: Product[]; paymentType: "" | "prepaid" | "cod"; shipping: string;
  warehouseId: string; packageType: "" | "parcel" | "heavy"; rovType: "owner" | "carrier"; boxes: Box[]; ewayBill: string;
};
export type WarehouseOpt = { id: string; label: string; code: string | null; line1: string; line2: string | null; city: string; state: string; pincode: string; contactName: string; mobile: string; isDefault: boolean };
export type SavedProduct = { name: string; sku: string; unitPricePaise: number; hsn: string | null };
type SavedBuyer = { id: string; name: string; mobile: string; email: string; addresses: Array<{ label?: string; line1: string; line2?: string; pincode: string; city: string; state: string }> };

const SECTIONS = [
  { key: "buyer", title: "Buyer/Receiver Details", icon: UserRound },
  { key: "order", title: "Order Details", icon: ClipboardList },
  { key: "product", title: "Product Details", icon: Package },
  { key: "warehouse", title: "Warehouse / Pickup Address", icon: MapPinned },
  { key: "weight", title: "Weight & Dimensions", icon: Weight },
  { key: "other", title: "Other Details", icon: FileText },
] as const;
type SectionKey = (typeof SECTIONS)[number]["key"];
const sectionOf = (path: string): SectionKey =>
  /^(buyer|billing)/.test(path) ? "buyer" : /^(orderNumber|orderDate|referenceId|invoiceNumber)/.test(path) ? "order"
    : /^(products|paymentType|shipping)/.test(path) ? "product" : /^warehouseId/.test(path) ? "warehouse" : /^(packageType|rovType|boxes)/.test(path) ? "weight" : "other";

const STORE = "vs-create-order-v1";
const k = () => Math.random().toString(36).slice(2, 9);
const newOrderId = () => `VS${Date.now().toString(36).toUpperCase()}${Math.floor(Math.random() * 36 * 36).toString(36).toUpperCase().padStart(2, "0")}`;
const today = () => new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
const emptyAddr: Addr = { line1: "", line2: "", pincode: "", city: "", state: "" };
const emptyProduct = (): Product => ({ key: k(), name: "", qty: "1", unitPrice: "", hsn: "", category: "", sku: "", discount: "", taxPct: "", more: false });
const emptyBox = (): Box => ({ key: k(), count: "", weightKg: "", lengthCm: "", breadthCm: "", heightCm: "" });
const inr = (p: number) => `₹${(p / 100).toLocaleString("en-IN", { minimumFractionDigits: p % 100 ? 2 : 0, maximumFractionDigits: 2 })}`;
const ADDR_OK = /^[\w\s.,\-/#]*$/;

function initial(warehouses: WarehouseOpt[]): Form {
  const def = warehouses.find((w) => w.isDefault) ?? (warehouses.length === 1 ? warehouses[0] : undefined);
  return {
    buyer: { mobile: "", name: "", altMobile: "", email: "", gstin: "", ...emptyAddr }, billingSame: true, billing: { name: "", mobile: "", ...emptyAddr },
    orderNumber: newOrderId(), orderDate: today(), referenceId: "", invoiceNumber: "",
    products: [emptyProduct()], paymentType: "", shipping: "0",
    warehouseId: def?.id ?? "", packageType: "", rovType: "owner", boxes: [emptyBox()], ewayBill: "",
  };
}

function Field({ id, label, req, error, children, wide, hint }: { id: string; label: string; req?: boolean; error?: string; children: React.ReactNode; wide?: boolean; hint?: React.ReactNode }) {
  return (
    <div className={`co-f${wide ? " wide" : ""}`}>
      <label htmlFor={id}>{req && <i aria-hidden>*</i>} {label}</label>
      {children}
      {hint && <p className="co-hint">{hint}</p>}
      {error && <p className="co-err" id={`${id}-e`} role="alert">{error}</p>}
    </div>
  );
}

/** Create Order: six collapsible sections, saved-customer autofill, live invoice total and E-Way Bill rule. */
export function CreateOrderForm({ warehouses, products: saved, internationalEnabled }: { warehouses: WarehouseOpt[]; products: SavedProduct[]; internationalEnabled: boolean }) {
  const router = useRouter();
  const [f, setF] = useState<Form>(() => initial(warehouses));
  const [open, setOpen] = useState<Set<SectionKey>>(new Set(["buyer"]));
  const [errs, setErrs] = useState<Record<string, string>>({});
  const [fail, setFail] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const restored = useRef(false);
  const [picker, setPicker] = useState<null | { title: string; items: Array<{ label: string; sub: string; apply: () => void }> }>(null);
  const [lookupNote, setLookupNote] = useState<string | null>(null);

  // keep the form when the customer leaves to add a pickup address (or reloads)
  useEffect(() => {
    try { const s = sessionStorage.getItem(STORE); if (s) { const v = JSON.parse(s) as Form; if (v?.buyer && v.products?.length && v.boxes?.length) setF(v); } } catch { /* storage blocked */ }
    restored.current = true;
  }, []);
  useEffect(() => { if (!restored.current) return; try { sessionStorage.setItem(STORE, JSON.stringify(f)); } catch { /* ignore */ } }, [f]);

  const set = <K extends keyof Form>(key: K, v: Form[K]) => setF((x) => ({ ...x, [key]: v }));
  const setBuyer = (patch: Partial<Buyer>) => setF((x) => ({ ...x, buyer: { ...x.buyer, ...patch } }));
  const setBilling = (patch: Partial<Billing>) => setF((x) => ({ ...x, billing: { ...x.billing, ...patch } }));
  const setProduct = (i: number, patch: Partial<Product>) => setF((x) => ({ ...x, products: x.products.map((p, j) => (j === i ? { ...p, ...patch } : p)) }));
  const setBox = (i: number, patch: Partial<Box>) => setF((x) => ({ ...x, boxes: x.boxes.map((b, j) => (j === i ? { ...b, ...patch } : b)) }));
  const toggle = (s: SectionKey) => setOpen((o) => { const n = new Set(o); if (n.has(s)) n.delete(s); else n.add(s); return n; });
  const err = (path: string) => errs[path];

  // live totals (same maths as the server)
  const totals = useMemo(() => invoiceTotals(f.products.map((p) => ({ qty: Number(p.qty) || 0, unitPricePaise: toPaise(p.unitPrice), discountPaise: toPaise(p.discount), taxBps: Math.round((Number(p.taxPct) || 0) * 100) })), toPaise(f.shipping)), [f.products, f.shipping]);
  const eway = ewayEnabled(totals.grandTotal);
  const boxes = f.boxes.map((b) => ({ count: Number(b.count) || 0, weightKg: Number(b.weightKg) || 0, lengthCm: Number(b.lengthCm) || 0, breadthCm: Number(b.breadthCm) || 0, heightCm: Number(b.heightCm) || 0 }));
  const weight = totalWeightKg(boxes);
  const limit = dimensionLimitCm(boxes);
  const pkg = PACKAGE_TYPES.find((p) => p.key === f.packageType);
  const wh = warehouses.find((w) => w.id === f.warehouseId);

  // ----- PIN → City / State
  const pinLookup = useCallback(async (pin: string, apply: (c: { city: string; state: string }) => void) => {
    if (!/^[1-9]\d{5}$/.test(pin)) return;
    const r = await fetch(`/api/portal/pincode/${pin}`).catch(() => null);
    if (r?.ok) { const j = await r.json(); apply({ city: j.city ?? "", state: j.state ?? "" }); }
  }, []);

  // ----- saved customer autofill
  const fillFrom = (b: SavedBuyer, a?: SavedBuyer["addresses"][number]) => {
    setF((x) => ({ ...x, buyer: { ...x.buyer, mobile: b.mobile, name: b.name || x.buyer.name, email: b.email || x.buyer.email, ...(a ? { line1: a.line1 ?? "", line2: a.line2 ?? "", pincode: a.pincode ?? "", city: a.city ?? "", state: a.state ?? "" } : {}) } }));
    setLookupNote(`Filled from saved customer ${b.name}. You can edit anything for this order.`);
  };
  const offer = (list: SavedBuyer[]) => {
    const items = list.flatMap((b) => (b.addresses.length ? b.addresses : [undefined]).map((a) => ({
      label: b.name, sub: [b.mobile, a ? [a.line1, a.city, a.pincode].filter(Boolean).join(", ") : "no saved address"].join(" · "), apply: () => { fillFrom(b, a); setPicker(null); },
    })));
    if (items.length === 1) { items[0].apply(); return; }
    setPicker({ title: "Choose the saved customer / address", items });
  };
  const lookupMobile = useCallback(async (m: string) => {
    const digits = m.replace(/\D/g, "").slice(-10);
    if (!/^[6-9]\d{9}$/.test(digits)) return;
    setLookupNote(null);
    const r = await fetch(`/api/portal/buyers/lookup?mobile=${digits}`).catch(() => null);
    if (!r?.ok) { setLookupNote("Couldn't check saved customers — enter the details."); return; }
    const j = await r.json() as { matches?: SavedBuyer[] };
    if (j.matches?.length) offer(j.matches); else setLookupNote("New customer — enter the details below.");
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  async function searchName() {
    const q = f.buyer.name.trim();
    if (q.length < 2) { setErrs((e) => ({ ...e, "buyer.name": "Type at least 2 letters to search" })); return; }
    const r = await fetch(`/api/portal/buyers/lookup?name=${encodeURIComponent(q)}`).catch(() => null);
    const j = r?.ok ? await r.json() as { matches?: SavedBuyer[] } : null;
    if (j?.matches?.length) offer(j.matches); else setLookupNote(r?.ok ? `No saved customer named “${q}” — enter the details.` : "Couldn't search saved customers.");
  }

  // ----- products from the saved catalogue
  const pickSaved = (i: number, name: string) => {
    const sp = saved.find((s) => s.name.toLowerCase() === name.trim().toLowerCase());
    if (!sp) return;
    setF((x) => ({ ...x, products: x.products.map((p, j) => (j === i ? { ...p, name: sp.name, unitPrice: p.unitPrice || (sp.unitPricePaise ? String(sp.unitPricePaise / 100) : ""), hsn: p.hsn || sp.hsn || "", sku: p.sku || sp.sku } : p)) }));
  };

  // ----- submit
  function payload() {
    return {
      orderNumber: f.orderNumber, orderDate: f.orderDate, referenceId: f.referenceId, invoiceNumber: f.invoiceNumber,
      buyer: f.buyer, billingSame: f.billingSame, billing: f.billingSame ? undefined : f.billing,
      products: f.products.map((p) => ({ name: p.name, qty: p.qty, unitPriceRupees: p.unitPrice, hsn: p.hsn, category: p.category, sku: p.sku, discountRupees: p.discount || 0, taxPct: p.taxPct || 0 })),
      paymentType: f.paymentType || undefined, shippingChargesRupees: f.shipping || 0, warehouseId: f.warehouseId, packageType: f.packageType || undefined,
      rovType: pkg?.rov ? f.rovType : undefined, boxes: f.boxes.map((b) => ({ count: b.count, weightKg: b.weightKg, lengthCm: b.lengthCm, breadthCm: b.breadthCm, heightCm: b.heightCm })),
      ewayBill: eway ? f.ewayBill : "", // at or below ₹50,000 the number is never sent
    };
  }
  function showIssues(issues: Array<{ path: string; message: string }>) {
    const e: Record<string, string> = {};
    for (const i of issues) if (!e[i.path]) e[i.path] = i.message;
    setErrs(e);
    const first = SECTIONS.find((s) => issues.some((i) => sectionOf(i.path) === s.key))?.key;
    if (first) {
      setOpen((o) => new Set([...o, first]));
      setTimeout(() => document.querySelector<HTMLElement>(`[data-sec="${first}"] [aria-invalid="true"]`)?.focus(), 60);
    }
  }
  async function submit(e?: React.FormEvent) {
    e?.preventDefault();
    if (inFlight.current) return; // repeated taps
    setFail(null);
    const body = payload();
    const chk = Schema.safeParse(body);
    const extra: Array<{ path: string; message: string }> = crossIssues(body);
    if (eway && pkg?.mode === "B2B" && !/^\d{12}$/.test(f.ewayBill)) extra.push({ path: "ewayBill", message: "E-Way Bill number (12 digits) is required above ₹50,000 for heavy shipments" });
    else if (eway && f.ewayBill && !/^\d{12}$/.test(f.ewayBill)) extra.push({ path: "ewayBill", message: "E-Way Bill number must be 12 digits" });
    if (!chk.success || extra.length) { showIssues([...(chk.success ? [] : chk.error.issues.map((i) => ({ path: i.path.join("."), message: i.message }))), ...extra]); return; }
    inFlight.current = true; setBusy(true); setErrs({});
    try {
      const r = await fetch("/api/portal/orders/form", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        if (j.error?.issues) showIssues(j.error.issues);
        setFail(j.error?.message ?? "Could not create the order. Your entries are kept — try again.");
        return;
      }
      try { sessionStorage.removeItem(STORE); } catch { /* ignore */ }
      router.push(`/portal/orders/${j.orderId}/`);
      return;
    } catch {
      setFail("Network problem — your entries are kept. Tap Create Order again.");
    } finally { inFlight.current = false; setBusy(false); }
  }

  // ----- small field helpers
  const inputProps = (id: string, path: string) => ({ id, "aria-invalid": !!err(path), "aria-describedby": err(path) ? `${id}-e` : undefined, className: "co-in" });

  const addressFields = (p: "buyer" | "billing", a: Addr, setA: (x: Partial<Addr>) => void) => (
    <>
      <Field id={`${p}-l1`} label="Address Line 1" req error={err(`${p}.line1`)} wide hint={<>Only these special characters are allowed <b className="co-sc">. , - / #</b></>}>
        <input {...inputProps(`${p}-l1`, `${p}.line1`)} value={a.line1} maxLength={200} placeholder="Flat, House No. Building, Apartment" onChange={(e) => ADDR_OK.test(e.target.value) && setA({ line1: e.target.value })} autoComplete="address-line1" />
      </Field>
      <Field id={`${p}-l2`} label="Address Line 2" error={err(`${p}.line2`)} wide hint={<>Only these special characters are allowed <b className="co-sc">. , - / #</b></>}>
        <input {...inputProps(`${p}-l2`, `${p}.line2`)} value={a.line2} maxLength={200} placeholder="Area, Colony, Street No., Sector" onChange={(e) => ADDR_OK.test(e.target.value) && setA({ line2: e.target.value })} autoComplete="address-line2" />
      </Field>
      <Field id={`${p}-pin`} label="Pincode" req error={err(`${p}.pincode`)}>
        <input {...inputProps(`${p}-pin`, `${p}.pincode`)} value={a.pincode} inputMode="numeric" maxLength={6} placeholder="Pincode"
          onChange={(e) => { const v = e.target.value.replace(/\D/g, "").slice(0, 6); setA({ pincode: v, ...(v.length < 6 ? { city: "", state: "" } : {}) }); if (v.length === 6) void pinLookup(v, (c) => setA(c)); }} autoComplete="postal-code" />
      </Field>
      <Field id={`${p}-city`} label="City" req error={err(`${p}.city`)}>
        <input {...inputProps(`${p}-city`, `${p}.city`)} value={a.city} placeholder="City" onChange={(e) => setA({ city: e.target.value })} readOnly={!!a.city && a.pincode.length === 6} />
      </Field>
      <Field id={`${p}-state`} label="State" req error={err(`${p}.state`)}>
        <input {...inputProps(`${p}-state`, `${p}.state`)} value={a.state} placeholder="State" onChange={(e) => setA({ state: e.target.value })} readOnly={!!a.state && a.pincode.length === 6} />
      </Field>
    </>
  );

  const section = (key: SectionKey, body: React.ReactNode) => {
    const s = SECTIONS.find((x) => x.key === key)!;
    const isOpen = open.has(key);
    const hasErr = Object.keys(errs).some((p) => sectionOf(p) === key);
    return (
      <section className={`co-sec${isOpen ? " open" : ""}${hasErr ? " bad" : ""}`} data-sec={key} aria-labelledby={`h-${key}`}>
        <h2 id={`h-${key}`}>
          <button type="button" aria-expanded={isOpen} aria-controls={`b-${key}`} onClick={() => toggle(key)}>
            <s.icon size={20} aria-hidden /> <span>{s.title}</span>{hasErr && <span className="co-flag">Needs a fix</span>}<ChevronDown size={20} aria-hidden className="chev" />
          </button>
        </h2>
        <div id={`b-${key}`} className="co-body" hidden={!isOpen}>{body}</div>
      </section>
    );
  };

  return (
    <form className="co" onSubmit={submit} noValidate>
      <header className="co-top">
        <Link href="/portal/orders/" className="tk-back" aria-label="Back to orders"><ChevronLeft size={24} aria-hidden /></Link>
        <h1>Create Order</h1>
      </header>
      <div className="co-seg" role="group" aria-label="Shipment region">
        <button type="button" className="on" aria-pressed="true">Domestic</button>
        <button type="button" disabled={!internationalEnabled} aria-disabled={!internationalEnabled} title={internationalEnabled ? undefined : "International shipping is not enabled for your account"}>International</button>
      </div>

      {section("buyer", <>
        <div className="co-grid">
          <Field id="b-mob" label="Mobile Number" req error={err("buyer.mobile")} hint={lookupNote ?? undefined}>
            <div className="co-row">
              <span className="co-pre">+91</span>
              <input {...inputProps("b-mob", "buyer.mobile")} value={f.buyer.mobile} inputMode="numeric" maxLength={10} placeholder="Enter phone number" autoComplete="tel-national"
                onChange={(e) => { const v = e.target.value.replace(/\D/g, "").slice(0, 10); setBuyer({ mobile: v }); if (v.length === 10) void lookupMobile(v); }} />
              <button type="button" className="co-ico" aria-label="Search saved customers by mobile" onClick={() => lookupMobile(f.buyer.mobile)}><Search size={18} /></button>
            </div>
          </Field>
          <Field id="b-name" label="Buyer/Receiver Name" req error={err("buyer.name")}>
            <div className="co-row">
              <input {...inputProps("b-name", "buyer.name")} value={f.buyer.name} maxLength={80} placeholder="Enter name" autoComplete="name" onChange={(e) => setBuyer({ name: e.target.value })} />
              <button type="button" className="co-ico" aria-label="Search saved customers by name" onClick={searchName}><Search size={18} /></button>
            </div>
          </Field>
          <Field id="b-alt" label="Alternative Phone" error={err("buyer.altMobile")}>
            <div className="co-row"><span className="co-pre">+91</span><input {...inputProps("b-alt", "buyer.altMobile")} value={f.buyer.altMobile} inputMode="numeric" maxLength={10} placeholder="Enter alternative phone" onChange={(e) => setBuyer({ altMobile: e.target.value.replace(/\D/g, "").slice(0, 10) })} /></div>
          </Field>
          <Field id="b-email" label="Email ID" error={err("buyer.email")}>
            <input {...inputProps("b-email", "buyer.email")} type="email" value={f.buyer.email} placeholder="Enter email" autoComplete="email" onChange={(e) => setBuyer({ email: e.target.value })} />
          </Field>
          <Field id="b-gst" label="GSTIN" error={err("buyer.gstin")}>
            <input {...inputProps("b-gst", "buyer.gstin")} value={f.buyer.gstin} maxLength={15} placeholder="GSTIN" onChange={(e) => setBuyer({ gstin: e.target.value.toUpperCase().replace(/[^0-9A-Z]/g, "") })} />
          </Field>
          {addressFields("buyer", f.buyer, setBuyer)}
        </div>
        <label className="co-check"><input type="checkbox" checked={f.billingSame} onChange={(e) => set("billingSame", e.target.checked)} /> Buyer/Receiver details same as Billing details</label>
        {!f.billingSame && (
          <div className="co-sub">
            <h3>Billing details</h3>
            <div className="co-grid">
              <Field id="bl-name" label="Billing Name" req error={err("billing.name")}><input {...inputProps("bl-name", "billing.name")} value={f.billing.name} onChange={(e) => setBilling({ name: e.target.value })} /></Field>
              <Field id="bl-mob" label="Billing Mobile" req error={err("billing.mobile")}><div className="co-row"><span className="co-pre">+91</span><input {...inputProps("bl-mob", "billing.mobile")} value={f.billing.mobile} inputMode="numeric" maxLength={10} onChange={(e) => setBilling({ mobile: e.target.value.replace(/\D/g, "").slice(0, 10) })} /></div></Field>
              {addressFields("billing", f.billing, setBilling)}
            </div>
          </div>
        )}
      </>)}

      {section("order", <div className="co-grid">
        <Field id="o-id" label="Order ID" req error={err("orderNumber")}>
          <div className="co-row">
            <input {...inputProps("o-id", "orderNumber")} value={f.orderNumber} maxLength={40} onChange={(e) => set("orderNumber", e.target.value.replace(/[^\w\-/#]/g, ""))} />
            <button type="button" className="co-ico" aria-label="Generate a new Order ID" title="Generate a new Order ID" onClick={() => set("orderNumber", newOrderId())}><Shuffle size={18} /></button>
          </div>
        </Field>
        <Field id="o-date" label="Order Date" req error={err("orderDate")}>
          <div className="co-row"><CalendarDays size={18} aria-hidden className="co-lead" /><input {...inputProps("o-date", "orderDate")} type="date" value={f.orderDate} max={today()} onChange={(e) => set("orderDate", e.target.value)} /></div>
        </Field>
        <Field id="o-ref" label="Reference ID" error={err("referenceId")}><input {...inputProps("o-ref", "referenceId")} value={f.referenceId} maxLength={60} placeholder="Enter reference ID" onChange={(e) => set("referenceId", e.target.value)} /></Field>
        <Field id="o-inv" label="Invoice Number" error={err("invoiceNumber")}><input {...inputProps("o-inv", "invoiceNumber")} value={f.invoiceNumber} maxLength={40} placeholder="Enter Invoice Number" onChange={(e) => set("invoiceNumber", e.target.value)} /></Field>
      </div>)}

      {section("product", <>
        <datalist id="saved-products">{saved.map((s) => <option key={s.sku} value={s.name}>{s.sku}</option>)}</datalist>
        {f.products.map((p, i) => (
          <fieldset key={p.key} className="co-group">
            <legend><span className="co-num">{i + 1}</span></legend>
            {f.products.length > 1 && <button type="button" className="co-remove" aria-label={`Remove product ${i + 1}`} onClick={() => set("products", f.products.filter((_, j) => j !== i))}><Trash2 size={16} /></button>}
            <div className="co-grid">
              <Field id={`p${i}-name`} label="Product Name" req error={err(`products.${i}.name`)} wide>
                <div className="co-row">
                  <input {...inputProps(`p${i}-name`, `products.${i}.name`)} list="saved-products" value={p.name} maxLength={120} placeholder="Enter name or search" onChange={(e) => { setProduct(i, { name: e.target.value }); pickSaved(i, e.target.value); }} />
                  <span className="co-ico ghost" aria-hidden><Search size={18} /></span>
                </div>
              </Field>
              <Field id={`p${i}-hsn`} label="HSN" error={err(`products.${i}.hsn`)}><input {...inputProps(`p${i}-hsn`, `products.${i}.hsn`)} value={p.hsn} inputMode="numeric" maxLength={8} placeholder="HSN" onChange={(e) => setProduct(i, { hsn: e.target.value.replace(/\D/g, "") })} /></Field>
              <Field id={`p${i}-qty`} label="Quantity" req error={err(`products.${i}.qty`)}>
                <div className="co-step">
                  <button type="button" aria-label="Decrease quantity" onClick={() => setProduct(i, { qty: String(Math.max(1, (Number(p.qty) || 1) - 1)) })}><Minus size={16} /></button>
                  <input {...inputProps(`p${i}-qty`, `products.${i}.qty`)} value={p.qty} inputMode="numeric" onChange={(e) => setProduct(i, { qty: e.target.value.replace(/\D/g, "").slice(0, 5) })} />
                  <button type="button" aria-label="Increase quantity" onClick={() => setProduct(i, { qty: String((Number(p.qty) || 0) + 1) })}><Plus size={16} /></button>
                </div>
              </Field>
              <Field id={`p${i}-price`} label="Unit Price" req error={err(`products.${i}.unitPriceRupees`)}>
                <div className="co-row"><span className="co-pre">₹</span><input {...inputProps(`p${i}-price`, `products.${i}.unitPriceRupees`)} value={p.unitPrice} inputMode="decimal" placeholder="Unit Price" onChange={(e) => setProduct(i, { unitPrice: e.target.value.replace(/[^\d.]/g, "") })} /></div>
              </Field>
            </div>
            <button type="button" className="co-more" aria-expanded={p.more} onClick={() => setProduct(i, { more: !p.more })}><Plus size={16} aria-hidden /> Add Category, SKU, Discount and Tax <ChevronDown size={16} aria-hidden /> <small>(optional)</small></button>
            {p.more && (
              <div className="co-grid">
                <Field id={`p${i}-cat`} label="Category"><input {...inputProps(`p${i}-cat`, `products.${i}.category`)} value={p.category} maxLength={60} onChange={(e) => setProduct(i, { category: e.target.value })} /></Field>
                <Field id={`p${i}-sku`} label="SKU"><input {...inputProps(`p${i}-sku`, `products.${i}.sku`)} value={p.sku} maxLength={60} onChange={(e) => setProduct(i, { sku: e.target.value })} /></Field>
                <Field id={`p${i}-disc`} label="Discount (₹ on this line)" error={err(`products.${i}.discountRupees`)}><input {...inputProps(`p${i}-disc`, `products.${i}.discountRupees`)} value={p.discount} inputMode="decimal" onChange={(e) => setProduct(i, { discount: e.target.value.replace(/[^\d.]/g, "") })} /></Field>
                <Field id={`p${i}-tax`} label="Tax %" error={err(`products.${i}.taxPct`)}><input {...inputProps(`p${i}-tax`, `products.${i}.taxPct`)} value={p.taxPct} inputMode="decimal" onChange={(e) => setProduct(i, { taxPct: e.target.value.replace(/[^\d.]/g, "") })} /></Field>
              </div>
            )}
            <p className="co-line">Line total: <b>{inr(totals.rows[i]?.total ?? 0)}</b></p>
          </fieldset>
        ))}
        <button type="button" className="co-add" onClick={() => set("products", [...f.products, emptyProduct()])}><Plus size={18} aria-hidden /> Add Product</button>
        <p className="co-total">Grand Total: <b>{inr(totals.grandTotal)}</b></p>
        <div className="co-grid">
          <Field id="pay" label="Payment Type" req error={err("paymentType")}>
            <div className="co-radio" role="radiogroup" aria-labelledby="pay" aria-invalid={!!err("paymentType")}>
              {(["prepaid", "cod"] as const).map((t) => <label key={t}><input type="radio" name="pay" checked={f.paymentType === t} onChange={() => set("paymentType", t)} /> {t === "cod" ? "COD" : "Prepaid"}</label>)}
            </div>
          </Field>
          <Field id="ship" label="Shipping Charges" error={err("shippingChargesRupees")}>
            <div className="co-row"><span className="co-pre">₹</span><input {...inputProps("ship", "shippingChargesRupees")} value={f.shipping} inputMode="decimal" onChange={(e) => set("shipping", e.target.value.replace(/[^\d.]/g, ""))} /></div>
          </Field>
        </div>
        {f.paymentType === "cod" && <p className="co-hint">COD amount to collect: <b>{inr(totals.grandTotal)}</b> (the Grand Total)</p>}
      </>)}

      {section("warehouse", warehouses.length === 0 ? (
        <p className="co-hint">No saved pickup address yet. <Link className="link" href="/portal/addresses/?add=1">Add Pickup Address</Link> — this form is kept while you do.</p>
      ) : (
        <>
          <Field id="wh" label="Pickup Address" req error={err("warehouseId")} wide>
            <select {...inputProps("wh", "warehouseId")} value={f.warehouseId} onChange={(e) => set("warehouseId", e.target.value)}>
              <option value="">Select pickup address</option>
              {warehouses.map((w) => <option key={w.id} value={w.id}>{w.label}{w.code ? ` (${w.code})` : ""} · {w.city} {w.pincode}{w.isDefault ? " · default" : ""}</option>)}
            </select>
          </Field>
          {wh && <div className="co-preview"><b>{wh.label}</b><span>{[wh.line1, wh.line2, wh.city, wh.state, wh.pincode].filter(Boolean).join(", ")}</span><span className="co-hint">{wh.contactName} · {wh.mobile}</span></div>}
          <Link className="link small" href="/portal/addresses/?add=1">+ Add Pickup Address</Link>
        </>
      ))}

      {section("weight", <>
        <div className="co-tip">💡 Tip: Add correct values to avoid weight discrepancy</div>
        <div className="co-grid">
          <Field id="pt" label="Package Type" req error={err("packageType")} wide>
            <select {...inputProps("pt", "packageType")} value={f.packageType} onChange={(e) => set("packageType", e.target.value as Form["packageType"])}>
              <option value="">Select package type</option>
              {PACKAGE_TYPES.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
            </select>
          </Field>
          {pkg?.rov && (
            <Field id="rov" label="ROV Type" error={err("rovType")}>
              <select {...inputProps("rov", "rovType")} value={f.rovType} onChange={(e) => set("rovType", e.target.value as Form["rovType"])}>{ROV_TYPES.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}</select>
            </Field>
          )}
          <Field id="tw" label="Total weight of order" req hint={<>Minimum chargeable weight: <b>{pkg ? `${pkg.minChargeKg.toFixed(2)} kg` : "0.50 kg"}</b>{pkg?.key === "heavy" ? " (heavy shipments, most couriers)" : ""}</>}>
            <div className="co-row"><input id="tw" className="co-in" value={weight.toFixed(2)} readOnly aria-readonly /><span className="co-post">KG</span></div>
          </Field>
        </div>
        {f.boxes.map((b, i) => (
          <fieldset key={b.key} className="co-group">
            <legend><span className="co-num">{i + 1}</span></legend>
            {f.boxes.length > 1 && <button type="button" className="co-remove" aria-label={`Remove box group ${i + 1}`} onClick={() => set("boxes", f.boxes.filter((_, j) => j !== i))}><Trash2 size={16} /></button>}
            <div className="co-grid">
              <Field id={`x${i}-n`} label="No. of box" req error={err(`boxes.${i}.count`)}><input {...inputProps(`x${i}-n`, `boxes.${i}.count`)} value={b.count} inputMode="numeric" placeholder="No. of box" onChange={(e) => setBox(i, { count: e.target.value.replace(/\D/g, "").slice(0, 3) })} /></Field>
              <Field id={`x${i}-w`} label="Weight Per Box" req error={err(`boxes.${i}.weightKg`)}><div className="co-row"><input {...inputProps(`x${i}-w`, `boxes.${i}.weightKg`)} value={b.weightKg} inputMode="decimal" placeholder="Enter weight per box" onChange={(e) => setBox(i, { weightKg: e.target.value.replace(/[^\d.]/g, "") })} /><span className="co-post">Kg</span></div></Field>
            </div>
            <div className="co-dims">
              {(["lengthCm", "breadthCm", "heightCm"] as const).map((d) => (
                <Field key={d} id={`x${i}-${d}`} label={d === "lengthCm" ? "Length" : d === "breadthCm" ? "Width" : "Height"} req error={err(`boxes.${i}.${d}`)}>
                  <div className="co-row"><input {...inputProps(`x${i}-${d}`, `boxes.${i}.${d}`)} value={b[d]} inputMode="decimal" onChange={(e) => setBox(i, { [d]: e.target.value.replace(/[^\d.]/g, "") } as Partial<Box>)} /><span className="co-post">CM</span></div>
                </Field>
              ))}
            </div>
            <p className="co-hint">Length, width or height can&apos;t be greater than {limit} cm{limit === 306 ? " for each multi-box package" : ""}</p>
          </fieldset>
        ))}
        <button type="button" className="co-add" onClick={() => set("boxes", [...f.boxes, emptyBox()])}><Plus size={18} aria-hidden /> Add boxes with a different weight or size</button>
      </>)}

      {section("other", <div className="co-grid">
        <Field id="ewb" label="E-Way Bill Number" req={eway && pkg?.mode === "B2B"} error={err("ewayBill")}
          hint={eway ? `Invoice value ${inr(totals.grandTotal)} is above ₹50,000.` : `Needed only above ₹50,000 — current invoice value ${inr(totals.grandTotal)}.`}>
          <input {...inputProps("ewb", "ewayBill")} value={eway ? f.ewayBill : ""} disabled={!eway} inputMode="numeric" maxLength={12} placeholder={eway ? "12-digit E-Way Bill number" : "Not required"} onChange={(e) => set("ewayBill", e.target.value.replace(/\D/g, "").slice(0, 12))} />
        </Field>
      </div>)}

      <div className="co-bar">
        <div className="co-bar-t"><span className="tiny">Grand Total</span><b>{inr(totals.grandTotal)}</b></div>
        <button type="submit" className="co-submit" disabled={busy} aria-busy={busy}>{busy ? "Creating…" : "Create Order"}</button>
      </div>
      {fail && <p className="co-fail" role="alert">{fail}</p>}

      {picker && (
        <div className="rt-backdrop" onClick={() => setPicker(null)}>
          <div className="rt-sheet co-pick" role="dialog" aria-modal="true" aria-labelledby="pk-h" onClick={(e) => e.stopPropagation()}>
            <h2 id="pk-h">{picker.title}</h2>
            <ul>{picker.items.map((it, i) => <li key={i}><button type="button" onClick={it.apply}><b>{it.label}</b><span>{it.sub}</span></button></li>)}</ul>
            <button type="button" className="co-add" onClick={() => setPicker(null)}>Enter details myself</button>
          </div>
        </div>
      )}
    </form>
  );
}

export const EWAY_LIMIT_TEXT = `₹${EWAY_THRESHOLD_PAISE / 100}`;
