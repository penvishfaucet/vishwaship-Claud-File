"use client";
import { Sparkles } from "lucide-react";
import { useState } from "react";
import { Msg, api } from "./ui";

const EXAMPLE = "We are Asha Traders from Jaipur. We sell hand-block printed cotton kurtas and dupattas for women, made by local artisans. Prices ₹800–₹2,500. Colours we like: indigo and warm mustard. We offer Cash on Delivery across India and easy 7-day returns.";

/** "Paste your description (for example from ChatGPT) and we design your store." Writes a draft the merchant reviews. */
export function AiDesign({ ready, compact = false }: { ready: boolean; compact?: boolean }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok?: string; err?: string } | null>(null);
  async function go(e: React.FormEvent) {
    e.preventDefault();
    if (text.trim().length < 20) { setMsg({ err: "Describe your business in a few sentences" }); return; }
    setBusy(true); setMsg(null);
    const r = await api<{ themeKey: string; categoriesAdded: number }>("POST", "/api/portal/store/ai-design", { prompt: text });
    setBusy(false);
    if (!r.ok) { setMsg({ err: r.error }); return; }
    setMsg({ ok: `Your design is ready as a draft${r.data.categoriesAdded ? ` (and ${r.data.categoriesAdded} categories were added)` : ""}. Check the preview, change anything you like, then publish.` });
    setTimeout(() => window.location.reload(), 1500);
  }
  return (
    <form className="card" onSubmit={go} style={{ padding: compact ? 14 : 18, marginBottom: 12, border: "1.5px solid var(--orange)", background: "linear-gradient(135deg, #fff7f1, #fff)" }}>
      <div className="row" style={{ gap: 8, alignItems: "center" }}><Sparkles size={18} color="var(--orange)" aria-hidden /><b>Design my store with AI</b></div>
      {!ready ? <p className="small muted" style={{ margin: "6px 0 0" }}>Coming soon: describe your business and get a ready design. For now, pick a theme below.</p> : (
        <>
          <p className="small muted" style={{ margin: "6px 0 8px" }}>Describe your business in your own words, or paste a description you wrote with ChatGPT. We create the colours, fonts, banner slides and texts as a draft. Nothing goes live until you publish.</p>
          <label htmlFor="ai-prompt" className="sr-only">Describe your business</label>
          <textarea id="ai-prompt" className="input" rows={compact ? 4 : 5} maxLength={4000} value={text} onChange={(e) => setText(e.target.value)} placeholder={EXAMPLE} />
          <div className="row between wrap" style={{ gap: 8, marginTop: 8 }}>
            <span className="tiny muted">{text.length}/4000 · Replaces your current draft design. Your logo, images and products stay.</span>
            <button className="btn btn-orange" disabled={busy}>{busy ? "Designing… (up to a minute)" : "Design my store"}</button>
          </div>
          <Msg m={msg} />
        </>
      )}
    </form>
  );
}
