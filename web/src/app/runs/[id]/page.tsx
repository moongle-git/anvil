import { PageShell } from "@/components/ui";
import { RunDetailClient } from "@/components/progress/RunDetailClient";

export default async function RunDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <PageShell>
      <RunDetailClient runId={id} />
    </PageShell>
  );
}
