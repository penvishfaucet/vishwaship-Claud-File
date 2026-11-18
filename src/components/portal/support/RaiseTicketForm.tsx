"use client";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { ChevronDown, Save, UploadCloud, X } from "lucide-react";
import { COMMENT_MAX, FILE_ACCEPT, FILE_HINT, TICKET_CATEGORIES, categoryNeedsRef, checkFileClient } from "@/lib/support";

const newKey = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`).replace(/[^A-Za-z0-9_-]/g, "");

/** Raise Ticket: category (sheet on phones, listbox on desktop), Order ID / AWB, comment (500), one file, Dismiss / Save. */
export function RaiseTicketForm({ backHref, initial }: { backHref: string; initial: { category?: string; ref?: string } }) {
  const router = useRouter();
  const [category, setCategory] = useState(TICKET_CATEGORIES.some((c) => c.key === initial.category) ? initial.category! : "");
  const [ref, setRef] = useState(initial.ref ?? "");
  const [comment, setComment] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [errs, setErrs] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [fail, setFail] = useState<string | null>(null);
  const idem = useRef(newKey()); // same key for every retry of this form → one ticket
  const inFlight = useRef(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const needsRef = category ? categoryNeedsRef(category) : false;

  function validate() {
    const e: Record<string, string> = {};
    if (!category) e.category = "Select a category.";
    if (needsRef && !ref.trim()) e.ref = "Enter the Order ID or AWB number for this category.";
    if (!comment.trim()) e.comment = "Write a comment.";
    else if (comment.length > COMMENT_MAX) e.comment = `Comment can be up to ${COMMENT_MAX} characters.`;
    if (file) { const m = checkFileClient(file); if (m) e.file = m; }
    setErrs(e);
    return Object.keys(e).length === 0;
  }

  async function save(ev: React.FormEvent) {
    ev.preventDefault();
    if (inFlight.current || !validate()) return;
    inFlight.current = true; setBusy(true); setFail(null);
    const fd = new FormData();
    fd.set("idem", idem.current); fd.set("category", category); fd.set("ref", ref.trim()); fd.set("comment", comment.trim());
    if (file) fd.set("file", file);
    try {
      const r = await fetch("/api/portal/support/tickets", { method: "POST", body: fd });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        const msg: string = j.error?.message ?? "Could not save the ticket. Please try again.";
        if (/category/i.test(msg)) setErrs({ category: msg }); else if (/order id|awb|find/i.test(msg)) setErrs({ ref: msg }); else if (/file|MB/i.test(msg)) setErrs({ file: msg }); else if (/comment/i.test(msg)) setErrs({ comment: msg });
        setFail(msg); setBusy(false); inFlight.current = false;
        return;
      }
      const back = backHref.includes("?") ? `?back=${encodeURIComponent(backHref.split("?")[1])}` : "";
      router.replace(`/portal/support/${j.id}/${back}`);
    } catch {
      setFail("Network problem, nothing was lost. Tap Save again to retry."); setBusy(false); inFlight.current = false;
    }
  }

  return (
    <form className="rt-card" onSubmit={save} noValidate>
      <div className="rt-field">
        <span className="rt-label" id="rt-cat-l"><i aria-hidden>*</i> Select Category</span>
        <CategoryPicker value={category} onPick={(k) => { setCategory(k); setErrs((e) => ({ ...e, category: "", ref: "" })); }} invalid={!!errs.category} />
        {errs.category && <p className="rt-err" role="alert">{errs.category}</p>}
      </div>
      <div className="rt-field">
        <label className="rt-label" htmlFor="rt-ref">{needsRef && <i aria-hidden>*</i>} Order id or awb number{!needsRef && category ? <span className="muted"> (optional)</span> : null}</label>
        <input id="rt-ref" className="rt-input" value={ref} onChange={(e) => setRef(e.target.value)} placeholder="Enter order ID or AWB number" maxLength={60} autoComplete="off" aria-invalid={!!errs.ref} aria-describedby={errs.ref ? "rt-ref-e" : undefined} />
        {errs.ref && <p className="rt-err" id="rt-ref-e" role="alert">{errs.ref}</p>}
      </div>
      <div className="rt-field">
        <label className="rt-label" htmlFor="rt-c"><i aria-hidden>*</i> Comment</label>
        <textarea id="rt-c" className="rt-input rt-ta" value={comment} onChange={(e) => setComment(e.target.value.slice(0, COMMENT_MAX))} placeholder="Enter your comment" rows={5} maxLength={COMMENT_MAX} aria-invalid={!!errs.comment} aria-describedby="rt-c-h" />
        <p className="rt-hint" id="rt-c-h"><span>Maximum {COMMENT_MAX} characters</span><span aria-live="polite" className={comment.length >= COMMENT_MAX ? "t-bad" : undefined}>{comment.length}/{COMMENT_MAX}</span></p>
        {errs.comment && <p className="rt-err" role="alert">{errs.comment}</p>}
      </div>
      <div className="rt-field">
        <span className="rt-label" id="rt-f-l">Attach File</span>
        <div className="rt-file">
          <button type="button" className="rt-input rt-filebtn" onClick={() => fileInput.current?.click()} aria-describedby="rt-f-h">
            <span className={file ? undefined : "ph"}>{file ? file.name : "Select file"}</span><UploadCloud size={22} aria-hidden />
          </button>
          {file && <button type="button" className="rt-x" aria-label="Remove file" onClick={() => { setFile(null); setErrs((e) => ({ ...e, file: "" })); if (fileInput.current) fileInput.current.value = ""; }}><X size={18} /></button>}
          <input ref={fileInput} type="file" accept={FILE_ACCEPT} hidden aria-labelledby="rt-f-l" onChange={(e) => { const f = e.target.files?.[0] ?? null; setFile(f); setErrs((x) => ({ ...x, file: f ? checkFileClient(f) ?? "" : "" })); }} />
        </div>
        <p className="rt-hint" id="rt-f-h">{FILE_HINT}</p>
        {errs.file && <p className="rt-err" role="alert">{errs.file}</p>}
      </div>
      {fail && !Object.values(errs).some(Boolean) && <p className="rt-err" role="alert">{fail}</p>}
      <div className="rt-actions">
        <button type="button" className="rt-dismiss" onClick={() => router.push(backHref)} disabled={busy}>Dismiss</button>
        <button type="submit" className="rt-save" disabled={busy} aria-busy={busy}><Save size={18} aria-hidden /> {busy ? "Saving…" : "Save"}</button>
      </div>
    </form>
  );
}

/** Category field: bottom sheet on phones, keyboard-accessible listbox popover on desktop. */
function CategoryPicker({ value, onPick, invalid }: { value: string; onPick: (k: string) => void; invalid: boolean }) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const btn = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const label = TICKET_CATEGORIES.find((c) => c.key === value)?.label;
  const close = (focus = true) => { setOpen(false); if (focus) btn.current?.focus(); };
  useEffect(() => {
    if (!open) return;
    const i = Math.max(0, TICKET_CATEGORIES.findIndex((c) => c.key === value));
    setActive(i);
    requestAnimationFrame(() => list.current?.focus());
  }, [open, value]);
  useEffect(() => { list.current?.querySelector<HTMLElement>(`[data-i="${active}"]`)?.scrollIntoView({ block: "nearest" }); }, [active]);
  const pick = (i: number) => { onPick(TICKET_CATEGORIES[i].key); close(); };
  function key(e: React.KeyboardEvent) {
    const n = TICKET_CATEGORIES.length;
    if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => (a + 1) % n); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => (a - 1 + n) % n); }
    else if (e.key === "Home") { e.preventDefault(); setActive(0); }
    else if (e.key === "End") { e.preventDefault(); setActive(n - 1); }
    else if (e.key === "Enter" || e.key === " ") { e.preventDefault(); pick(active); }
    else if (e.key === "Escape" || e.key === "Tab") { if (e.key === "Escape") e.preventDefault(); close(e.key === "Escape"); }
  }
  return (
    <div className="rt-pick">
      <button ref={btn} type="button" className="rt-input rt-select" aria-haspopup="listbox" aria-expanded={open} aria-labelledby="rt-cat-l rt-cat-v" aria-invalid={invalid}
        onClick={() => setOpen(true)} onKeyDown={(e) => { if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); setOpen(true); } }}>
        <span id="rt-cat-v" className={label ? undefined : "ph"}>{label ?? "Select Category"}</span><ChevronDown size={20} aria-hidden />
      </button>
      {open && (
        <>
          <div className="rt-backdrop" onClick={() => close()} aria-hidden />
          <div className="rt-sheet" role="dialog" aria-modal="true" aria-labelledby="rt-sheet-h">
            <span className="sc-grip" aria-hidden />
            <h2 id="rt-sheet-h">Select Category</h2>
            <ul ref={list} role="listbox" tabIndex={-1} aria-labelledby="rt-sheet-h" aria-activedescendant={`rt-opt-${active}`} onKeyDown={key}>
              {TICKET_CATEGORIES.map((c, i) => (
                <li key={c.key} id={`rt-opt-${i}`} data-i={i} role="option" aria-selected={c.key === value} className={i === active ? "act" : undefined}
                  onMouseEnter={() => setActive(i)} onClick={() => pick(i)}>{c.label}</li>
              ))}
            </ul>
          </div>
        </>
      )}
    </div>
  );
}
