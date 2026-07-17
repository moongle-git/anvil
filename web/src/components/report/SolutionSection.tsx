import type { Criticism, Solution } from "@anvil/types";
import { Card, EmptyState, SectionHeading } from "@/components/ui";
import { renderRichText } from "@/lib/richText";
import { RemedyClaims } from "./RemedyLedger";

type SolutionPartKey =
  | "minimalInput"
  | "agenticWorkflow"
  | "dataFlywheel"
  | "monetization";

// 순서·제목 고정 (PRD 리포트 규격). ④ 비즈니스 모델은 최상위 섹션이 아니라 合의 하위 절이다 —
// 5단계 서사에서 최상위 5번 섹션은 최종 판정 하나뿐이고, 수익화는 재설계의 일부다.
const PARTS: { key: SolutionPartKey; title: string }[] = [
  { key: "minimalInput", title: "① 최소 입력 구조" },
  { key: "agenticWorkflow", title: "② 에이전틱 워크플로우" },
  { key: "dataFlywheel", title: "③ 독점적 데이터 플라이휠" },
  { key: "monetization", title: "④ 지속 가능한 비즈니스 모델" },
];

// 5단계 서사의 4단계(合) — 이 리포트에서 가장 중요한 섹션.
// 단순 절충이 아니라 反의 비판을 방어·우회해 새 가치를 만드는 피벗(Pivot) 전략이다.
//
// criticism은 결함↔해결책 원장을 위해 받는다. verdict는 받지 않는다 — 감사 결과가 이 섹션에
// 닿을 수 없어야 독자가 5절 전에 결론을 알지 못한다 (ADR-008).
export function SolutionSection({
  solution,
  criticism,
}: {
  solution?: Solution;
  criticism?: Criticism;
}) {
  return (
    <section aria-labelledby="solution" className="flex max-w-3xl flex-col gap-6">
      <SectionHeading id="solution">④ 인사이트 및 재설계 (合)</SectionHeading>

      {solution === undefined ? (
        <EmptyState
          title="재설계 데이터가 없습니다"
          description="이 실행에는 솔루션 산출물이 포함되어 있지 않습니다."
        />
      ) : (
        <>
          {/* 合의 리드: 正·反을 종합한 피벗 통찰을 섹션 맨 위 강조 카드로 (있을 때만) */}
          {solution.synthesis !== undefined ? (
            <Card className="flex flex-col gap-2 border-neutral-900 bg-neutral-50">
              <span className="text-sm font-medium text-neutral-500">
                정반합 통찰
              </span>
              {renderRichText(solution.synthesis)}
            </Card>
          ) : null}

          {/* 처방의 결론(재설계된 컨셉)을 강조 테두리로 (역피라미드) */}
          <Card className="flex flex-col gap-2 border-neutral-900">
            <span className="text-sm font-medium text-neutral-500">
              재설계된 컨셉
            </span>
            {renderRichText(solution.revisedConcept)}
          </Card>

          {/* 구 run은 criticism이 검증에 실패해 없을 수 있다 — 그때는 원장을 통째로 생략한다 */}
          {criticism !== undefined ? (
            <RemedyClaims criticism={criticism} solution={solution} />
          ) : null}

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
