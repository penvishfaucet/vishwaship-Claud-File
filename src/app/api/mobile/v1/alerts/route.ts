import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "@/server/db/client";
import { parseJson } from "@/server/http";
import { appLinkFor } from "@/server/mobile/push";
import { mobileJson, withCustomer } from "@/server/mobile/http";

/** In-app inbox: the same alerts as the website bell. */
export async function GET() {
  return withCustomer(async (s) => {
    const db = await getDb();
    const rows = await db.select().from(schema.inAppAlerts).where(eq(schema.inAppAlerts.orgId, s.orgId)).orderBy(desc(schema.inAppAlerts.createdAt)).limit(100);
    return mobileJson({ alerts: rows.map((a) => ({ id: a.id, kind: a.kind, title: a.title, link: appLinkFor(a.href), read: !!a.readAt, createdAt: a.createdAt.toISOString() })), unread: rows.filter((a) => !a.readAt).length });
  });
}

/** Mark read: { ids: [...] } or { all: true }. Only this org's alerts can change. */
export async function POST(req: Request) {
  return withCustomer(async (s) => {
    const p = await parseJson(req, z.object({ ids: z.array(z.string().max(64)).max(200).optional(), all: z.boolean().optional() }));
    if (!p.ok) return p.res;
    const db = await getDb();
    const scope = and(eq(schema.inAppAlerts.orgId, s.orgId), isNull(schema.inAppAlerts.readAt));
    if (p.data.all) await db.update(schema.inAppAlerts).set({ readAt: new Date() }).where(scope);
    else if (p.data.ids?.length) await db.update(schema.inAppAlerts).set({ readAt: new Date() }).where(and(scope, inArray(schema.inAppAlerts.id, p.data.ids)));
    return mobileJson({ ok: true });
  });
}
