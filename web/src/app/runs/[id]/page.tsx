import { RunDetailPage } from "@/components/progress/RunDetailPage";
import { PageShell } from "@/components/ui";

interface RunPageProps {
  params: Promise<{ id: string }>;
}

export default async function RunPage({ params }: RunPageProps) {
  const { id } = await params;
  return (
    <PageShell>
      <RunDetailPage runId={id} />
    </PageShell>
  );
}
