import { PolicyPage } from "@/components/public/PolicyPage";
import { pageMeta } from "@/lib/seo";
export const dynamic = "force-dynamic";
export const metadata = pageMeta("/shipping-policy/", "Shipping & Delivery Policy — Vishwaship", "How Vishwaship pickups, delivery times, tracking, failed deliveries, returns (RTO) and damaged or missing shipments work.");
export default function Page() { return <PolicyPage slug="shipping" title="Shipping & Delivery Policy" />; }
