import { FranchiseShell } from "@/components/franchise/FranchiseShell";
import { franchiseLogout } from "@/server/franchise/auth-actions";
import { requireFranchise } from "@/server/franchise/session";

export const dynamic = "force-dynamic";
export const metadata = { title: "Franchise — Vishwaship", robots: { index: false } };

export default async function FranchiseLayout({ children }: { children: React.ReactNode }) {
  const { session, franchise } = await requireFranchise();
  return (
    <FranchiseShell user={{ name: session.name }} franchise={{ code: franchise.code, name: franchise.businessName, status: franchise.status }} logout={franchiseLogout}>
      {children}
    </FranchiseShell>
  );
}
