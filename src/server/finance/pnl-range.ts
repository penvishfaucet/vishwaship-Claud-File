/** Period for P&L screens: ?from=YYYY-MM-DD&to=YYYY-MM-DD (IST days); nothing = all time. */
export function pnlRange(sp: { from?: string; to?: string }) {
  const ok = (d?: string) => !!d && /^\d{4}-\d{2}-\d{2}$/.test(d);
  if (!ok(sp.from) && !ok(sp.to)) return { range: null, label: "All time", qs: "", from: "", to: "" };
  const today = new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
  const to = ok(sp.to) ? sp.to! : today, from = ok(sp.from) ? sp.from! : "2020-01-01";
  return { range: { from: new Date(`${from}T00:00:00+05:30`), to: new Date(`${to}T23:59:59.999+05:30`) }, label: `${from} to ${to}`, qs: `from=${from}&to=${to}`, from, to };
}

/** Quick periods for the P&L screens. */
export function pnlPresets() {
  const ist = new Date(Date.now() + 5.5 * 3600_000);
  const d = (x: Date) => x.toISOString().slice(0, 10);
  const today = d(ist);
  const minus = (n: number) => d(new Date(ist.getTime() - n * 86400_000));
  const monthStart = `${today.slice(0, 7)}-01`;
  const lastMonthEnd = d(new Date(new Date(`${monthStart}T00:00:00Z`).getTime() - 86400_000));
  return [
    { label: "All time", qs: "" },
    { label: "This month", qs: `from=${monthStart}&to=${today}` },
    { label: "Last month", qs: `from=${lastMonthEnd.slice(0, 7)}-01&to=${lastMonthEnd}` },
    { label: "Last 30 days", qs: `from=${minus(29)}&to=${today}` },
    { label: "Today", qs: `from=${today}&to=${today}` },
  ];
}
