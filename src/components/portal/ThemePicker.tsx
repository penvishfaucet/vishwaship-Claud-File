"use client";
import { useEffect, useState } from "react";

type Mode = "light" | "dark" | "system";

export function applyTheme(m: Mode) {
  const dark = m === "dark" || (m === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", dark);
}

/** Uses the live stylesheet's existing `html.dark .shell` theme. Default Light. */
export function ThemePicker() {
  const [mode, setMode] = useState<Mode>("light");
  useEffect(() => {
    try { const m = (localStorage.getItem("vs-theme") as Mode) || "light"; setMode(m); applyTheme(m); } catch { /* storage blocked */ }
  }, []);
  const set = (m: Mode) => { setMode(m); applyTheme(m); try { localStorage.setItem("vs-theme", m); } catch { /* ignore */ } };
  return (
    <div className="seg" role="radiogroup" aria-label="Theme" style={{ width: "fit-content" }}>
      {(["light", "dark", "system"] as const).map((m) => <button key={m} type="button" role="radio" aria-checked={mode === m} className={mode === m ? "on" : ""} onClick={() => set(m)}>{m[0].toUpperCase() + m.slice(1)}</button>)}
    </div>
  );
}
