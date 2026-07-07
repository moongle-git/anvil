import { Suspense } from "react";
import { PageShell } from "@/components/ui";
import { CompareClient } from "@/components/compare/CompareClient";

export default function ComparePage() {
  return (
    <PageShell>
      {/* useSearchParams는 Suspense 경계가 필요하다 (prerender 시 CSR bailout) */}
      <Suspense
        fallback={
          <p className="py-16 text-center text-sm text-neutral-500">
            불러오는 중…
          </p>
        }
      >
        <CompareClient />
      </Suspense>
    </PageShell>
  );
}
