import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { audit } from "@/server/audit";
import { apiStaff } from "@/server/auth/session";
import { getDb, schema } from "@/server/db/client";
import { apiError, parseJson } from "@/server/http";
import { saveSection } from "@/server/site/content";
import { SECTION_KEYS, type SectionKey } from "@/lib/site-content";

const Body = z.discriminatedUnion("op", [
  z.object({ op: z.literal("save"), section: z.enum(SECTION_KEYS as [SectionKey, ...SectionKey[]]), data: z.unknown(), publish: z.boolean().default(false) }),
  z.object({ op: z.literal("threshold"), kg: z.number().min(0.5).max(1000) }),
]);

/** Admin → Website Content: save a section draft, publish it, or set the automatic B2C/B2B weight threshold. */
export async function POST(req: Request) {
  const s = await apiStaff("content.write");
  if (!s) return apiError(403, "forbidden", "You cannot edit website content");
  const p = await parseJson(req, Body);
  if (!p.ok) return p.res;
  if (p.data.op === "threshold") {
    const grams = Math.round(p.data.kg * 1000);
    const db = await getDb();
    const [row] = await db.select().from(schema.pricingSettings).where(eq(schema.pricingSettings.key, "b2b_threshold_grams"));
    if (row) await db.update(schema.pricingSettings).set({ value: grams, version: row.version + 1, updatedAt: new Date() }).where(eq(schema.pricingSettings.key, "b2b_threshold_grams"));
    else await db.insert(schema.pricingSettings).values({ key: "b2b_threshold_grams", value: grams });
    await audit({ actorUserId: s.userId, actorKind: "staff", action: "site.b2b_threshold", details: { grams } });
    return NextResponse.json({ ok: true, grams });
  }
  const r = await saveSection(p.data.section, p.data.data, s.userId, p.data.publish);
  if (!r.ok) return apiError(422, "validation_error", r.message);
  await audit({ actorUserId: s.userId, actorKind: "staff", action: p.data.publish ? "site.publish" : "site.save_draft", targetType: "site_section", targetId: p.data.section });
  return NextResponse.json({ ok: true });
}
