import type { ReactNode } from "react";
import type { RunDetail } from "@/lib/server/runs";
import { Card, type CardAccent } from "@/components/ui";
import { DialecticSplit } from "./DialecticSplit";
import { MarketContextSection } from "./MarketContextSection";
import { ReportHeader } from "./ReportHeader";
import { SectionNav } from "./SectionNav";
import { SolutionSection } from "./SolutionSection";
import { VerdictSection } from "./VerdictSection";

interface ReportViewProps {
  detail: RunDetail;
  /** 상세 헤더 메타 줄에 놓이는 계보 (RunDetailClient가 소유한다) */
  lineage?: ReactNode;
  /** 상세 헤더에 놓이는 재실행 컨트롤 (RunDetailClient가 소유한다) */
  rerunControl?: ReactNode;
  /** 상세 헤더에 놓이는 삭제 컨트롤 (RunDetailClient가 소유한다) */
  deleteControl?: ReactNode;
}

const LEGACY_ACCENT: CardAccent = { side: "left", tone: "strong" };

// 리포트 뷰(완료 run). 5단계 순차 논증 서사 (ADR-008 결론 후치):
// 시장 맥락 → 正 → 反 → 合 → 최종 판정. 결론(verdict·생존 점수·severity 집계)을 상단에 두지
// 않는다 — 사용자는 끝까지 읽어야 판정을 본다. 결론 선노출은 正/反 대립을 장식으로 만든다.
export function ReportView({
  detail,
  lineage,
  rerunControl,
  deleteControl,
}: ReportViewProps) {
  const { state, context, thesis, criticism, solution, verdict } = detail;

  // 완료됐지만 새 스키마 산출물이 없는 구버전 run. 결론 스포일러가 아니라 데이터 상태 안내이므로
  // 상단에 두어도 ADR-008에 어긋나지 않는다.
  const isLegacyReport = verdict === undefined && detail.hasReport;

  return (
    <div className="flex flex-col gap-8">
      <ReportHeader
        runId={state.runId}
        idea={state.idea}
        createdAt={state.createdAt}
        hasReport={detail.hasReport}
        lineage={lineage}
        rerunControl={rerunControl}
        deleteControl={deleteControl}
      />

      {isLegacyReport ? (
        // 레일 + 배경 콜아웃은 카드 골격을 그대로 쓴다 (UI_GUIDE 테두리 블록 여백 규격) — padding은
        // Card 기본값(p-6). severity가 아닌 데이터 상태 안내이므로 레일은 무채색이다.
        // bg-neutral-50!의 `!`는 필수다: Card 골격의 bg-white와 같은 레이어·같은 명시도인데
        // 생성 CSS에서 .bg-white가 뒤에 와, 그냥 얹으면 배경이 조용히 흰색으로 진다.
        <Card
          accent={LEGACY_ACCENT}
          className="bg-neutral-50! text-[15px] leading-[1.8] text-neutral-700"
        >
          이 리포트는 이전 버전 형식으로 생성되었습니다. 전체 내용은 report.md
          다운로드로 확인하세요.
        </Card>
      ) : null}

      <div className="lg:grid lg:grid-cols-[11rem_1fr] lg:gap-10">
        <div className="mb-6 lg:mb-0 lg:sticky lg:top-6 lg:self-start">
          <SectionNav />
        </div>
        {/* 섹션 폭은 각 섹션이 스스로 정한다: DialecticSplit만 max-w-5xl, 나머지는 max-w-3xl.
            바깥을 max-w-3xl로 감싸면 Split View가 좁아지므로 여기서 폭을 제한하지 않는다. */}
        <div className="flex min-w-0 flex-col gap-12">
          <MarketContextSection context={context} />
          <DialecticSplit thesis={thesis} criticism={criticism} />
          {/* 원장은 criticism과의 대조라 두 섹션 모두 criticism을 받는다. SolutionSection에
              verdict를 넘기지 않는 것이 ADR-008의 구조적 방어다 — 넘길 수 없으면 샐 수 없다. */}
          <SolutionSection solution={solution} criticism={criticism} />
          <VerdictSection
            verdict={verdict}
            criticism={criticism}
            solution={solution}
          />
        </div>
      </div>
    </div>
  );
}
