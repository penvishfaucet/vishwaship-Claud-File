import { PolicyPage } from "@/components/public/PolicyPage";
import { pageMeta } from "@/lib/seo";
export const dynamic = "force-dynamic";
export const metadata = pageMeta("/refund-policy/", "Refund & Cancellation — Vishwaship", "Vishwaship refund and cancellation policy for shipments, wallet recharges and services.");
export default function Page() { return <PolicyPage slug="refund" title="Refund & Cancellation" />; }
