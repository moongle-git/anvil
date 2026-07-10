import type { RunDetail } from "@/lib/server/runs";
import { DialecticSplit } from "./DialecticSplit";
import { MarketContextSection } from "./MarketContextSection";
import { ReportHeader } from "./ReportHeader";
import { SectionNav } from "./SectionNav";
import { SolutionSection } from "./SolutionSection";
import { VerdictBanner } from "./VerdictBanner";

interface ReportViewProps {
  detail: RunDetail;
}

// 리포트 뷰(완료 run). 역피라미드: 헤더 → verdict 배너 → 목차 → 섹션.
export function ReportView({ detail }: ReportViewProps) {
  const { state, context, thesis, criticism, solution } = detail;

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
          <DialecticSplit thesis={thesis} criticism={criticism} />
          <SolutionSection solution={solution} />
        </div>
      </div>
    </div>
  );
}
