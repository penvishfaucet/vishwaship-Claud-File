import { PolicyPage } from "@/components/public/PolicyPage";
import { pageMeta } from "@/lib/seo";
export const dynamic = "force-dynamic";
export const metadata = pageMeta("/terms/", "Terms & Conditions — Vishwaship", "Terms and conditions for using Vishwaship shipping services.");
export default function Page() { return <PolicyPage slug="terms" title="Terms & Conditions" />; }
