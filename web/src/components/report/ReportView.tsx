import type { RunDetail } from "@/lib/server/runs";
import { SectionHeading } from "@/components/ui";
import { MarketContextSection } from "./MarketContextSection";
import { ReportHeader } from "./ReportHeader";
import { SectionNav } from "./SectionNav";
import { VerdictBanner } from "./VerdictBanner";

interface ReportViewProps {
  detail: RunDetail;
}

// step 7이 실제 내용으로 교체할 스텁 (② 비판 / ③ 재설계 / ④ BM)
function StubSection({ id, title }: { id: string; title: string }) {
  return (
    <section aria-labelledby={id} className="flex flex-col gap-3">
      <SectionHeading id={id}>{title}</SectionHeading>
      <p className="text-sm text-neutral-400">다음 step에서 구현됩니다.</p>
    </section>
  );
}

// 리포트 뷰(완료 run). 역피라미드: 헤더 → verdict 배너 → 목차 → 섹션.
export function ReportView({ detail }: ReportViewProps) {
  const { state, context, criticism } = detail;

  return (
    <div className="flex flex-col gap-8">
      <ReportHeader
        runId={state.runId}
        idea={state.idea}
        createdAt={state.createdAt}
        hasReport={detail.hasReport}
      />
      <VerdictBanner criticism={criticism} />

      <div className="lg:grid lg:grid-cols-[11rem_1fr] lg:gap-10">
        <div className="mb-6 lg:mb-0 lg:sticky lg:top-6 lg:self-start">
          <SectionNav />
        </div>
        <div className="flex min-w-0 max-w-3xl flex-col gap-12">
          <MarketContextSection context={context} />
          <StubSection id="criticism" title="② 냉정한 현실 인식 및 비판" />
          <StubSection id="solution" title="③ AI 네이티브 관점의 해결책" />
          <StubSection id="monetization" title="④ 지속 가능한 비즈니스 모델" />
        </div>
      </div>
    </div>
  );
}
