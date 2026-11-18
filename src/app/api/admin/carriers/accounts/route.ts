import { NextResponse } from "next/server";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { audit } from "@/server/audit";
import type { Permission } from "@/server/auth/rbac";
import { apiStaff } from "@/server/auth/session";
import { CARRIER_SPECS, specFor, validateBaseUrl } from "@/server/carriers/specs";
import { activatedEarly, isVerified, markPending, missingRequired, recordCapability } from "@/server/carriers/verification";
import { getDb, schema } from "@/server/db/client";
import { apiError } from "@/server/http";
import { adapterFor, providerContext, secretsFor } from "@/server/providers/registry";
import { decryptJson, encryptJson, maskSecret } from "@/server/security/crypto";
import type { QuoteRequest } from "@/server/providers/types";
import { shipmozoRaw } from "@/server/providers/shipmozo";
import { refreshFromCarrier } from "@/server/tracking/service";
import { newId } from "@/server/util/ids";

const id = z.string().min(3).max(64);
const env = z.enum(["test", "live"]);
const pin = z.string().regex(/^[1-9]\d{5}$/, "6-digit PIN");
const bool = z.union([z.boolean(), z.literal("on"), z.literal("")]).transform((v) => v === true || v === "on");

const Ops = z.discriminatedUnion("op", [
  z.object({ op: z.literal("create"), adapter: z.string().min(2).max(40), service: z.enum(["B2C", "B2B"]), brandName: z.string().trim().max(60).default(""), logoCode: z.string().trim().max(60).default("") }),
  z.object({ op: z.literal("credentials"), id, env, values: z.record(z.string(), z.string().max(500)).default({}) }),
  z.object({ op: z.literal("clear_credentials"), id, env }),
  z.object({ op: z.literal("environment"), id, mode: env }),
  z.object({ op: z.literal("config"), id, brandName: z.string().trim().max(60).default(""), logoCode: z.string().trim().max(60).default(""), baseUrlTest: z.string().trim().max(300).default(""), baseUrlLive: z.string().trim().max(300).default(""),
    typeOfPackage: z.string().trim().max(20).default(""), rovType: z.string().trim().max(30).default(""), gstTreatment: z.enum(["auto", "inclusive", "exclusive"]).default("auto"),
    courierIds: z.string().trim().max(500).default(""), skipManualPickup: bool.default(false), webhookNote: z.string().trim().max(300).default("") }),
  z.object({ op: z.literal("test_auth"), id }),
  z.object({ op: z.literal("test_serviceability"), id, from: pin, to: pin }),
  z.object({ op: z.literal("rate_check"), id, from: pin, to: pin, weightKg: z.coerce.number().positive().max(5000), lengthCm: z.coerce.number().positive().max(500), widthCm: z.coerce.number().positive().max(500), heightCm: z.coerce.number().positive().max(500),
    boxes: z.coerce.number().int().min(1).max(500).default(1), payment: z.enum(["prepaid", "cod"]), codRupees: z.coerce.number().min(0).max(500000).default(0), valueRupees: z.coerce.number().min(0).max(5000000).default(1000),
    panel: z.string().trim().max(2000).default(""), panelIncludesGst: bool.default(true) }),
  z.object({ op: z.literal("test_track"), id, awb: z.string().trim().min(4).max(40) }),
  z.object({ op: z.literal("test_label"), id, awb: z.string().trim().min(4).max(40) }),
  z.object({ op: z.literal("pilots"), id, customers: z.string().trim().max(2000).default("") }),
  z.object({ op: z.literal("status"), id, action: z.enum(["activate", "activate_now", "pause", "resume", "disable", "archive"]) }),
  z.object({ op: z.literal("map_warehouse"), id, warehouseId: id, providerRef: z.string().trim().min(1).max(80) }),
  z.object({ op: z.literal("retry_job"), id, jobId: id }),
  z.object({ op: z.literal("refresh_shipment"), id, shipmentId: id }),
]);

const PERM: Record<string, Permission> = { refresh_shipment: "shipments.read", retry_job: "integrations.write" };

/** Admin → Settings → Courier Integrations. Every op is staff-only, audited, and never echoes a secret. */
export async function POST(req: Request) {
  let raw: unknown;
  try { raw = await req.json(); } catch { return apiError(400, "validation_error", "Body must be JSON"); }
  const p = Ops.safeParse(raw);
  if (!p.success) return apiError(422, "validation_error", p.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
  const b = p.data;
  // Admin forms post credential fields flat ({ op, id, env, publicKey, ... }); collect them into values.
  if (b.op === "credentials") for (const [k, v] of Object.entries(raw as Record<string, unknown>)) if (typeof v === "string" && !["op", "id", "env", "values"].includes(k)) b.values[k] = v.slice(0, 500);
  const s = await apiStaff(PERM[b.op] ?? "integrations.write");
  if (!s) return apiError(403, "forbidden", "You do not have permission for this action");
  const db = await getDb();
  const log = (action: string, targetId: string, details: Record<string, unknown> = {}) => audit({ actorUserId: s.userId, actorKind: "staff", action: `courier.${action}`, targetType: "provider_account", targetId, details });
  const ok = (message: string, extra: Record<string, unknown> = {}) => NextResponse.json({ ok: true, message, ...extra });

  if (b.op === "create") {
    const spec = CARRIER_SPECS[b.adapter];
    if (!spec && b.adapter !== "custom") return apiError(422, "validation_error", "Unknown provider");
    if (spec && !spec.services.includes(b.service)) return apiError(422, "validation_error", `${spec.name} does not offer ${b.service}`);
    if (b.adapter === "custom" && !b.brandName) return apiError(422, "validation_error", "Enter the provider name");
    if (b.adapter.startsWith("delhivery_")) return apiError(409, "conflict", "Delhivery Direct accounts are created on the Delhivery settings page");
    const existing = await db.select().from(schema.providerAccounts).where(and(eq(schema.providerAccounts.adapter, b.adapter), inArray(schema.providerAccounts.status, ["enabled", "disabled", "paused"])));
    if (b.adapter !== "custom" && existing.some((a) => (a.configPublic as Record<string, unknown>)?.service === b.service)) return apiError(409, "conflict", `${spec!.name} ${b.service} already exists — open it from the list`);
    const name = b.brandName || spec?.name || "Courier";
    const row = {
      id: newId("pa"), adapter: b.adapter, category: "shipping", label: `${name} ${b.service}`, mode: spec && !spec.sandbox ? "live" : "test", status: "disabled",
      configPublic: { service: b.service, brandName: name, logoCode: b.logoCode || null, route: spec?.route ?? "direct", payments: { prepaid: true, cod: true, fod: false, fodStatus: "not_supported" }, pilotOrgIds: [] },
    };
    await db.insert(schema.providerAccounts).values(row);
    await log("create", row.id, { adapter: b.adapter, service: b.service });
    return ok(`${row.label} added — enter credentials next`, { id: row.id, redirect: `/admin/carriers/${row.id}/` });
  }

  const [acct] = await db.select().from(schema.providerAccounts).where(and(eq(schema.providerAccounts.id, b.id), eq(schema.providerAccounts.category, "shipping")));
  if (!acct) return apiError(404, "not_found", "Integration not found");
  const cfg = (acct.configPublic ?? {}) as Record<string, unknown>;
  const spec = specFor(acct.adapter, cfg.protocol as string | undefined);
  const adapter = adapterFor(acct);
  const saveCfg = (patch: Record<string, unknown>) => db.update(schema.providerAccounts).set({ configPublic: { ...cfg, ...patch } }).where(eq(schema.providerAccounts.id, acct.id));
  const fresh = async () => (await db.select().from(schema.providerAccounts).where(eq(schema.providerAccounts.id, acct.id)))[0];
  const needAdapter = () => (adapter && spec?.build !== "documentation_required" ? null : apiError(409, "conflict", `${spec?.name ?? acct.label} is waiting for its API documentation — the adapter is not built yet`));

  switch (b.op) {
    case "credentials": {
      const fields = spec?.fields ?? [];
      const all = acct.secretsEnc ? decryptJson<Record<string, unknown>>(acct.secretsEnc) : {};
      const perEnv = "test" in all || "live" in all ? (all as Record<string, Record<string, string>>) : { [acct.mode]: all as Record<string, string> };
      const hints = ((acct.secretsHint ?? {}) as Record<string, unknown>);
      const hintEnv = ("test" in hints || "live" in hints ? hints : { [acct.mode]: hints }) as Record<string, Record<string, string>>;
      const cur = { ...(perEnv[b.env] ?? {}) };
      const curHint = { ...(hintEnv[b.env] ?? {}) };
      const pub = { ...((cfg.accountFields as Record<string, Record<string, string>> | undefined)?.[b.env] ?? {}) };
      let changed = 0;
      for (const f of fields) {
        const v = (b.values[f.key] ?? "").trim();
        if (!v) continue; // blank = keep the saved value
        changed++;
        if (f.secret) { cur[f.key] = v; curHint[f.key] = maskSecret(v); } else pub[f.key] = v;
      }
      if (!changed) return apiError(422, "validation_error", "Enter at least one value (blank fields keep the saved value)");
      const missing = fields.filter((f) => f.secret && !cur[f.key]).map((f) => f.label);
      await db.update(schema.providerAccounts).set({
        secretsEnc: encryptJson({ ...perEnv, [b.env]: cur }), secretsHint: { ...hintEnv, [b.env]: curHint },
        configPublic: { ...cfg, accountFields: { ...((cfg.accountFields as object) ?? {}), [b.env]: pub } },
        ...(b.env === acct.mode ? { lastTestOk: null, lastTestMessage: null } : {}),
      }).where(eq(schema.providerAccounts.id, acct.id));
      await log("credentials", acct.id, { env: b.env, fields: fields.filter((f) => b.values[f.key]?.trim()).map((f) => f.key) });
      return ok(`${b.env === "live" ? "Production" : "Sandbox"} credentials saved (encrypted)${missing.length ? ` — still missing: ${missing.join(", ")}` : ". Run Test authentication next."}`);
    }
    case "clear_credentials": {
      const all = acct.secretsEnc ? decryptJson<Record<string, unknown>>(acct.secretsEnc) : {};
      const perEnv = "test" in all || "live" in all ? { ...(all as Record<string, unknown>) } : {};
      delete perEnv[b.env];
      const hints = { ...((acct.secretsHint ?? {}) as Record<string, unknown>) };
      delete hints[b.env];
      const empty = !Object.keys(perEnv).length;
      await db.update(schema.providerAccounts).set({ secretsEnc: empty ? null : encryptJson(perEnv), secretsHint: empty ? null : hints, ...(b.env === acct.mode && acct.status === "enabled" ? { status: "paused" } : {}) }).where(eq(schema.providerAccounts.id, acct.id));
      await log("credentials_cleared", acct.id, { env: b.env });
      return ok(`${b.env === "live" ? "Production" : "Sandbox"} credentials removed${b.env === acct.mode && acct.status === "enabled" ? " and the integration paused" : ""}`);
    }
    case "environment": {
      if (b.mode === "test" && spec && !spec.sandbox) return apiError(422, "validation_error", `${spec.name} has no separate sandbox — every call runs on the live account`);
      if (acct.status === "enabled") return apiError(409, "conflict", "Pause the integration before switching environment");
      await db.update(schema.providerAccounts).set({ mode: b.mode, lastTestOk: null, lastTestMessage: null, lastTestAt: null }).where(eq(schema.providerAccounts.id, acct.id));
      await log("environment", acct.id, { mode: b.mode });
      return ok(`Now using ${b.mode === "live" ? "production" : "sandbox"}. Capabilities must be verified in this environment before activation.`);
    }
    case "config": {
      const patch: Record<string, unknown> = { brandName: b.brandName || cfg.brandName, logoCode: b.logoCode || null, webhookNote: b.webhookNote || null };
      if (spec?.baseUrlEditable) {
        const urls: Record<string, string> = { ...((cfg.baseUrl as Record<string, string> | undefined) ?? {}) };
        for (const [m, v] of [["test", b.baseUrlTest], ["live", b.baseUrlLive]] as const) {
          if (!v) { delete urls[m]; continue; }
          const r = validateBaseUrl(spec, m, v);
          if (!r.ok) return apiError(422, "validation_error", `${m === "live" ? "Production" : "Sandbox"} base URL: ${r.reason}`);
          urls[m] = r.url;
        }
        patch.baseUrl = urls;
      }
      if (acct.adapter === "shiporax") {
        patch.gstTreatment = b.gstTreatment === "auto" ? null : b.gstTreatment;
        patch.courierIds = b.courierIds.split(/[\s,]+/).map((x) => x.trim()).filter((x) => /^[A-Za-z0-9_-]{1,40}$/.test(x));
      }
      if (acct.adapter === "shipmozo") {
        if (b.typeOfPackage && !/^[A-Z_]{2,20}$/.test(b.typeOfPackage)) return apiError(422, "validation_error", "type_of_package must be a code like SPS or MPS");
        patch.typeOfPackage = b.typeOfPackage || null; patch.rovType = b.rovType || null; patch.gstTreatment = b.gstTreatment; patch.skipManualPickup = b.skipManualPickup;
        patch.courierIds = b.courierIds.split(/[\s,]+/).map((x) => x.trim()).filter((x) => /^[A-Za-z0-9_-]{1,20}$/.test(x));
      }
      await saveCfg(patch);
      await log("config", acct.id, { keys: Object.keys(patch) });
      return ok("Settings saved");
    }
    case "test_auth": {
      const na = needAdapter(); if (na) return na;
      if (!Object.keys(secretsFor(acct.secretsEnc, acct.mode as "test" | "live")).length) return apiError(409, "conflict", `Save the ${acct.mode === "live" ? "production" : "sandbox"} credentials first`);
      let r;
      try { r = await adapter!.health(await providerContext(acct)); } catch (e) { r = { ok: false as const, error: { category: "upstream" as const, message: (e as Error).message, retryable: true } }; }
      const msg = r.ok ? r.value.message : r.error.message;
      await db.update(schema.providerAccounts).set({ lastTestAt: new Date(), lastTestOk: r.ok, lastTestMessage: msg.slice(0, 200) }).where(eq(schema.providerAccounts.id, acct.id));
      await recordCapability(acct.id, "authenticate", r.ok, { message: msg });
      await log("test_auth", acct.id, { ok: r.ok });
      return r.ok ? ok(`${msg}. Rates, booking, label and tracking stay pending until each is verified.`) : apiError(502, "provider_error", msg);
    }
    case "test_serviceability": {
      const na = needAdapter(); if (na) return na;
      const svcMode = (cfg.service === "B2B" || acct.adapter === "delhivery_b2b" ? "B2B" : "B2C") as "B2C" | "B2B";
      const r = await adapter!.quote(await providerContext(acct), { mode: svcMode, originPincode: b.from, destinationPincode: b.to, paymentType: "prepaid", declaredValue: 100000, packages: [{ count: 1, lengthMm: 100, breadthMm: 100, heightMm: 100, actualWeightGrams: 500 }] });
      const served = r.ok ? r.value.length > 0 : r.error.category === "not_serviceable" ? false : null;
      if (served === null) return apiError(502, "provider_error", r.ok ? "No answer" : r.error.message);
      await recordCapability(acct.id, "serviceability", true, { message: `${b.from} → ${b.to}: ${served ? "serviceable" : "not serviceable"}`, evidence: `${b.from}-${b.to}` });
      return ok(`${b.from} → ${b.to}: ${served ? `serviceable (${r.ok ? r.value.length : 0} option${r.ok && r.value.length === 1 ? "" : "s"})` : "not serviceable"}`);
    }
    case "rate_check": {
      const na = needAdapter(); if (na) return na;
      const svcMode = (cfg.service === "B2B" || acct.adapter === "delhivery_b2b" ? "B2B" : "B2C") as "B2C" | "B2B";
      const req = {
        mode: svcMode, originPincode: b.from, destinationPincode: b.to, paymentType: b.payment, codAmount: b.payment === "cod" ? Math.round(b.codRupees * 100) : 0, declaredValue: Math.round(b.valueRupees * 100),
        packages: [{ count: b.boxes, lengthMm: Math.round(b.lengthCm * 10), breadthMm: Math.round(b.widthCm * 10), heightMm: Math.round(b.heightCm * 10), actualWeightGrams: Math.round((b.weightKg * 1000) / b.boxes) }],
      } satisfies QuoteRequest;
      const pctx = await providerContext(acct);
      const raw = acct.adapter === "shipmozo" ? await shipmozoRaw(pctx, req).catch((e) => ({ error: (e as Error).message })) : null;
      const r = await adapter!.quote(pctx, req);
      if (!r.ok) {
        await recordCapability(acct.id, "quote", false, { message: r.error.message });
        await saveCfg({ lastRateCheck: { at: new Date().toISOString(), inputs: req, error: r.error.message, raw } });
        return apiError(502, "provider_error", r.error.message);
      }
      // Panel figures: "courierId or name = amount" per line or comma, e.g. "12=118.00, Delhivery Surface=96.40"
      const panel = new Map<string, number>();
      for (const part of b.panel.split(/[\n,;]+/)) { const m = part.match(/^\s*(.+?)\s*[=:]\s*₹?\s*([\d.]+)\s*$/); if (m) panel.set(m[1].toLowerCase(), Number(m[2])); }
      const rows = r.value.map((q) => {
        const pre = q.components.reduce((t, c) => t + (q.taxInclusive ? Math.round((c.amount * 10000) / (10000 + q.taxRateBps)) : c.amount), 0);
        const withGst = pre + Math.round((pre * q.taxRateBps) / 10000);
        const courierId = q.providerQuoteRef?.startsWith("shipmozo_api:") ? q.providerQuoteRef.split(":")[1] : null;
        const key = [courierId, q.serviceName.toLowerCase(), q.carrierName.toLowerCase()].find((k) => k && panel.has(k)) ?? null;
        const panelPaise = key ? Math.round(panel.get(key)! * 100) : null;
        const cmp = b.panelIncludesGst ? withGst : pre;
        return { courier: q.serviceName, carrier: q.carrierName, courierId, preTaxPaise: pre, withGstPaise: withGst, panelPaise, diffPaise: panelPaise === null ? null : cmp - panelPaise, chargeableGrams: q.chargeableWeightGrams, etaDays: q.etaDays ?? null, components: q.components, pickup: q.providerQuoteRef?.split(":")[2] ?? null };
      });
      const compared = rows.filter((x) => x.diffPaise !== null);
      const matched = compared.filter((x) => Math.abs(x.diffPaise!) <= 100); // ₹1 for rounding on the panel
      const check = { id: `RC${Date.now().toString(36).toUpperCase()}`, at: new Date().toISOString(), env: acct.mode, inputs: req, panelIncludesGst: b.panelIncludesGst, rows, raw };
      await saveCfg({ lastRateCheck: check, rateChecks: [check, ...(((cfg.rateChecks as unknown[]) ?? []).slice(0, 4))] });
      await log("rate_check", acct.id, { couriers: rows.length, compared: compared.length, matched: matched.length });
      if (!compared.length) await markPending(acct.id, "quote", `API returned ${rows.length} rate(s) in ${check.id} — compare with the panel to verify`);
      if (!compared.length) return ok(`API returned ${rows.length} rate${rows.length === 1 ? "" : "s"}. Enter the panel amounts for the same inputs to verify rates (still pending).`);
      const allMatch = matched.length === compared.length;
      await recordCapability(acct.id, "quote", allMatch, { message: allMatch ? `${matched.length} courier rate(s) match the panel` : `${compared.length - matched.length} of ${compared.length} differ from the panel — resolve the rate basis before activation`, evidence: `rate check ${check.id}` });
      return allMatch ? ok(`Verified: ${matched.length} courier rate(s) match the panel for identical inputs`) : apiError(409, "conflict", `${compared.length - matched.length} of ${compared.length} rate(s) differ from the panel — see the comparison table`);
    }
    case "test_track": {
      const na = needAdapter(); if (na) return na;
      const r = await adapter!.track(await providerContext(acct), b.awb);
      await recordCapability(acct.id, "track", r.ok, { message: r.ok ? `${r.value.status.replace(/_/g, " ")} · ${r.value.events.length} event(s)` : r.error.message, evidence: `AWB ${b.awb}` });
      return r.ok ? ok(`Tracking works: ${r.value.status.replace(/_/g, " ")}, ${r.value.events.length} event(s)`) : apiError(502, "provider_error", r.error.message);
    }
    case "test_label": {
      const na = needAdapter(); if (na) return na;
      const ctx = await providerContext(acct);
      let r = await adapter!.label(ctx, { providerOrderRef: b.awb, awb: b.awb }, "thermal_4x6");
      if (r.ok && !r.value.images?.length && !r.value.pdf && !r.value.url && r.value.formatsAvailable[0]) r = await adapter!.label(ctx, { providerOrderRef: b.awb, awb: b.awb }, r.value.formatsAvailable[0]);
      const got = r.ok && (!!r.value.images?.length || !!r.value.pdf || !!r.value.url);
      await recordCapability(acct.id, "label", got, { message: got ? "Carrier label returned" : r.ok ? "No label returned" : r.error.message, evidence: `AWB ${b.awb}` });
      return got ? ok("Label returned by the courier (original format preserved)") : apiError(502, "provider_error", r.ok ? "No label returned" : r.error.message);
    }
    case "pilots": {
      const tokens = b.customers.split(/[\s,]+/).map((x) => x.trim()).filter(Boolean).slice(0, 20);
      const orgIds = new Set<string>();
      for (const t of tokens) {
        if (t.includes("@")) {
          const [u] = await db.select({ orgId: schema.users.orgId }).from(schema.users).where(and(eq(schema.users.email, t.toLowerCase()), eq(schema.users.kind, "customer")));
          if (!u?.orgId) return apiError(422, "validation_error", `No customer with email ${t}`);
          orgIds.add(u.orgId);
        } else {
          const [o] = await db.select({ id: schema.orgs.id }).from(schema.orgs).where(eq(schema.orgs.id, t));
          if (!o) return apiError(422, "validation_error", `No customer account ${t}`);
          orgIds.add(o.id);
        }
      }
      await saveCfg({ pilotOrgIds: [...orgIds] });
      await log("pilots", acct.id, { count: orgIds.size });
      return ok(orgIds.size ? `${orgIds.size} pilot customer(s) can now quote and book this service for verification` : "Pilot list cleared");
    }
    case "status": {
      if (b.action === "activate_now") {
        const na = needAdapter(); if (na) return na;
        const a = await fresh();
        if (!isVerified(a, "authenticate")) return apiError(409, "conflict", "Run Test authentication first — the saved keys must work before rates can be shown");
        await db.update(schema.providerAccounts).set({ status: "enabled", configPublic: { ...cfg, activatedEarly: { at: new Date().toISOString(), by: s.userId } } }).where(eq(schema.providerAccounts.id, acct.id));
        await log("status_activate_now", acct.id, { pending: missingRequired(a) });
        return ok("Active — customers now see live rates and can book. Rates, booking, label and tracking keep verifying from real bookings.");
      }
      const next = { activate: "enabled", resume: "enabled", pause: "paused", disable: "disabled", archive: "archived" }[b.action];
      if (b.action === "disable" || b.action === "archive") await saveCfg({ activatedEarly: null });
      if (next === "enabled" && !(b.action === "resume" && activatedEarly(acct))) {
        const na = needAdapter(); if (na) return na;
        const a = await fresh();
        const missing = missingRequired(a);
        if (missing.length) return apiError(409, "conflict", `Not activated — still unverified in ${a.mode === "live" ? "production" : "sandbox"}: ${missing.join(", ")}`);
      }
      if (b.action === "archive" && acct.status === "enabled") return apiError(409, "conflict", "Pause the integration before archiving");
      await db.update(schema.providerAccounts).set({ status: next }).where(eq(schema.providerAccounts.id, acct.id));
      await log(`status_${b.action}`, acct.id);
      const msg = { activate: "Active — customers now get quotes and bookings from this service", resume: "Resumed — taking new quotes and bookings again", pause: "Paused — no new quotes or bookings; existing shipments keep tracking", disable: "Moved back to setup — no quotes or bookings (pilot customers excepted)", archive: "Archived" }[b.action];
      return ok(msg);
    }
    case "map_warehouse": {
      const [wh] = await db.select({ id: schema.warehouses.id }).from(schema.warehouses).where(eq(schema.warehouses.id, b.warehouseId));
      if (!wh) return apiError(404, "not_found", "Warehouse not found");
      const row = { status: "registered", providerWarehouseRef: b.providerRef, lastError: null, updatedAt: new Date() };
      await db.insert(schema.warehouseProviderSync).values({ id: newId("wps"), warehouseId: wh.id, providerAccountId: acct.id, ...row }).onConflictDoUpdate({ target: [schema.warehouseProviderSync.warehouseId, schema.warehouseProviderSync.providerAccountId], set: row });
      await log("map_warehouse", acct.id, { warehouseId: wh.id });
      return ok("Pickup address mapped to the provider warehouse");
    }
    case "retry_job": {
      const [job] = await db.select().from(schema.jobs).where(eq(schema.jobs.id, b.jobId));
      if (!job || !["booking.reconcile", "tracking.poll"].includes(job.queue)) return apiError(404, "not_found", "Job not found");
      if (job.status === "running") return apiError(409, "conflict", "Job is running");
      // booking.reconcile always asks the provider first, so a retry can never create a second booking or charge.
      await db.update(schema.jobs).set({ status: "queued", runAt: new Date(), attempts: 0 }).where(eq(schema.jobs.id, job.id));
      await log("retry_job", acct.id, { jobId: job.id, queue: job.queue });
      return ok(job.queue === "booking.reconcile" ? "Reconciliation queued — it checks the provider by order reference before anything else" : "Tracking sync queued");
    }
    case "refresh_shipment": {
      const [sh] = await db.select({ id: schema.shipments.id }).from(schema.shipments).where(and(eq(schema.shipments.id, b.shipmentId), eq(schema.shipments.providerAccountId, acct.id)));
      if (!sh) return apiError(404, "not_found", "Shipment not found for this integration");
      const r = await refreshFromCarrier(sh.id);
      return r.ok ? ok(`Synced: ${r.inserted} new event(s)`) : apiError(502, "provider_error", r.message);
    }
  }
}
