import { z } from "zod";
import { apiError, parseJson } from "@/server/http";
import { rateLimit } from "@/server/security/rate-limit";
import { AiDesignError, aiDesignReady, applyDesign, generateDesign } from "@/server/store/ai-design";
import { fail, run, storeAudit, storeGuard } from "@/server/store/api";
import { storeForOrg } from "@/server/store/service";

export const maxDuration = 300;

/** Design the store from the merchant's description. Writes the theme draft only; the merchant reviews and publishes. */
export async function POST(req: Request) {
  const g = await storeGuard(); if (g.err) return g.err;
  if (!aiDesignReady()) return apiError(503, "provider_error", "The AI designer is not switched on yet.");
  if (!(await rateLimit(`store-ai:${g.s.orgId}`, 10, 86_400)).ok) return apiError(429, "rate_limited", "You have used the AI designer 10 times today. Please try again tomorrow, or edit the design by hand.");
  const p = await parseJson(req, z.object({ prompt: z.string().trim().min(20, "Describe your business in a few sentences").max(4000, "Keep the description under 4,000 characters") })); if (!p.ok) return p.res;
  const store = await storeForOrg(g.s.orgId);
  if (!store) return fail("Create your store first");
  let design;
  try { design = await generateDesign(store.name, p.data.prompt); }
  catch (e) { if (e instanceof AiDesignError) return apiError(502, "provider_error", e.message); throw e; }
  return run(async () => {
    const r = await applyDesign(g.s.orgId, design);
    await storeAudit(g.s, "ai_design", store.id, { themeKey: r.themeKey, promptChars: p.data.prompt.length, categoriesAdded: r.categoriesAdded });
    return { ok: true, ...r };
  });
}
