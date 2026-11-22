/** Small count pill for a sidebar entry: red = needs action, green = in progress / for info. */
export type NavBadgeData = { n: number; tone: "red" | "green"; title?: string };

export function NavBadge({ b }: { b?: NavBadgeData }) {
  if (!b || b.n <= 0) return null;
  return (
    <span className="nav-badge" title={b.title} aria-label={b.title ?? `${b.n} items`}
      style={{ marginLeft: "auto", minWidth: 18, height: 18, padding: "0 5px", borderRadius: 9, background: b.tone === "red" ? "#dc2626" : "#16a34a", color: "#fff", fontSize: 11, fontWeight: 700, display: "inline-flex", alignItems: "center", justifyContent: "center", lineHeight: 1 }}>
      {b.n > 99 ? "99+" : b.n}
    </span>
  );
}
