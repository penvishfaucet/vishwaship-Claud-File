import { NextResponse } from "next/server";
import { z } from "zod";
import { audit } from "@/server/audit";
import { apiStaff } from "@/server/auth/session";
import { apiError, parseJson } from "@/server/http";
import { ConfirmInput, RtoError, confirmRtoCharge, importRtoFile } from "@/server/rto/charges";
import { StoreError } from "@/server/store/catalog";
import { resolveCodDispute } from "@/server/store/cod";

/**
 * Staff (finance.adjust): confirm / adjust one RTO charge, import a carrier settlement file (preview, then apply),
 * or answer a merchant's COD question. Every change is audited with old and new values.
 */
export async function POST(req: Request) {
  const s = await apiStaff("finance.adjust");
  if (!s) return apiError(403, "forbidden", "Finance permission needed");
  const p = await parseJson(req, z.discriminatedUnion("action", [
    ConfirmInput.extend({ action: z.literal("confirm") }),
    z.object({ action: z.literal("import"), text: z.string().min(1).max(3_000_000), apply: z.boolean().default(false), chargeWallet: z.boolean().default(true) }),
    z.object({ action: z.literal("resolve_cod"), id: z.string().max(64), resolution: z.string().max(500) }),
  ])); if (!p.ok) return p.res;
  const d = p.data;
  try {
    if (d.action === "confirm") {
      const r = await confirmRtoCharge(s.userId, d);
      await audit({ actorUserId: s.userId, actorKind: "staff", action: "rto.charge", targetType: "shipment", targetId: d.shipmentId,
        details: { old: r.old, new: { finalPaise: d.finalPaise, creditsPaise: d.creditsPaise, state: r.state }, source: d.source, reference: d.reference, reason: d.reason, walletDeltaPaise: r.walletDeltaPaise } });
      return NextResponse.json({ ok: true, ...r });
    }
    if (d.action === "import") {
      const r = await importRtoFile(s.userId, d.text, { apply: d.apply, chargeWallet: d.chargeWallet });
      if (d.apply) await audit({ actorUserId: s.userId, actorKind: "staff", action: "rto.import", targetType: "rto_charges", details: { applied: r.valid, chargeWallet: d.chargeWallet, failed: "failed" in r ? r.failed : [] } });
      return NextResponse.json({ ok: true, ...r });
    }
    const r = await resolveCodDispute(s.userId, d.id, d.resolution);
    await audit({ actorUserId: s.userId, actorKind: "staff", orgId: r.orgId, action: "cod.dispute_resolved", targetType: "cod_dispute", targetId: d.id, details: { resolution: d.resolution } });
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof RtoError || e instanceof StoreError) return apiError(422, "validation_error", e.message);
    throw e;
  }
}
