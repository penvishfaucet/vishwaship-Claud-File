import { PolicyPage } from "@/components/public/PolicyPage";
import { pageMeta } from "@/lib/seo";
export const dynamic = "force-dynamic";
export const metadata = pageMeta("/privacy/", "Privacy Policy — Vishwaship", "How Vishwaship collects, uses and protects your personal and shipment data.");
export default function Page() { return <PolicyPage slug="privacy" title="Privacy Policy" />; }
