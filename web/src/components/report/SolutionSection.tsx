import type { Solution } from "@anvil/types";
import { Card, EmptyState, SectionHeading } from "@/components/ui";
import { renderRichText } from "@/lib/richText";

type SolutionPartKey = "minimalInput" | "agenticWorkflow" | "dataFlywheel";

// 순서·제목 고정 (PRD 리포트 규격)
const PARTS: { key: SolutionPartKey; title: string }[] = [
  { key: "minimalInput", title: "① 데이터 수집 및 최소 입력 구조" },
  { key: "agenticWorkflow", title: "② 에이전틱 워크플로우" },
  { key: "dataFlywheel", title: "③ 독점적 데이터 플라이휠" },
];

export function SolutionSection({ solution }: { solution?: Solution }) {
  return (
    <section aria-labelledby="solution" className="flex flex-col gap-6">
      <SectionHeading id="solution">③ AI 네이티브 관점의 해결책</SectionHeading>

      {solution === undefined ? (
        <EmptyState
          title="재설계 데이터가 없습니다"
          description="이 실행에는 솔루션 산출물이 포함되어 있지 않습니다."
        />
      ) : (
        <>
          {/* 처방의 결론(재설계된 컨셉)을 먼저, 강조 테두리로 (역피라미드) */}
          <Card className="flex flex-col gap-2 border-neutral-900">
            <span className="text-sm font-medium text-neutral-500">
              재설계된 컨셉
            </span>
            {renderRichText(solution.revisedConcept)}
          </Card>

          {PARTS.map((part) => (
            <div key={part.key} className="flex flex-col gap-2">
              <h3 className="text-base font-semibold text-neutral-900">
                {part.title}
              </h3>
              {renderRichText(solution[part.key])}
            </div>
          ))}
        </>
      )}
    </section>
  );
}
