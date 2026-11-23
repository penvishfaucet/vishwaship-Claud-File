import { llmsTxt } from "@/lib/seo";

/** /llms.txt — what Vishwaship is, for ChatGPT, Gemini, Claude and other AI tools (see src/lib/seo.ts). */
export const dynamic = "force-dynamic";

export function GET() {
  return new Response(llmsTxt(), { headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "public, max-age=3600" } });
}
