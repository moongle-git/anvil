import { ComparePage } from "@/components/compare/ComparePage";
import { PageShell } from "@/components/ui";

interface CompareRouteProps {
  searchParams: Promise<{
    a?: string;
    b?: string;
  }>;
}

export default async function CompareRoute({ searchParams }: CompareRouteProps) {
  const { a, b } = await searchParams;
  return (
    <PageShell>
      <ComparePage runA={a} runB={b} />
    </PageShell>
  );
}
