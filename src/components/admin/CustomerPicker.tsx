"use client";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

/** Admin dashboard: pick one customer (or All customers); keeps the date range in the URL. */
export function CustomerPicker({ customers, value }: { customers: Array<{ id: string; name: string }>; value: string }) {
  const router = useRouter();
  const path = usePathname();
  const params = useSearchParams();
  return (
    <label className="cust-pick">
      <span className="sr-only">Customer</span>
      <select className="input" value={value} onChange={(e) => {
        const p = new URLSearchParams(params.toString());
        if (e.target.value) p.set("customer", e.target.value); else p.delete("customer");
        p.delete("q");
        router.push(`${path}?${p.toString()}`);
      }}>
        <option value="">All customers ({customers.length})</option>
        {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
      </select>
    </label>
  );
}
