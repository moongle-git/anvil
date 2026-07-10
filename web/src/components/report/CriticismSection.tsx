import {
  DIALECTIC_AXES,
  DIALECTIC_AXIS_LABELS,
  type Criticism,
  type CriticismPoint,
} from "@anvil/types";
import {
  Card,
  Collapsible,
  EmptyState,
  SectionHeading,
  SeverityBadge,
} from "@/components/ui";
import { renderRichText } from "@/lib/richText";
import { groupPointsByAxis } from "@/lib/risk";

function CriticismCard({ point }: { point: CriticismPoint }) {
  return (
    <Card className="flex flex-col gap-3">
      <div className="flex items-start gap-2">
        <span className="pt-0.5">
          <SeverityBadge severity={point.severity} />
        </span>
        <h4 className="text-base font-semibold text-neutral-900">
          {point.claim}
        </h4>
      </div>
      {/* 근거는 기본 접힘 — 주장 먼저 훑고 필요할 때 펼치는 스캔 동선(PRD) */}
      <Collapsible summary="근거 보기">
        {renderRichText(point.evidence)}
      </Collapsible>
    </Card>
  );
}

function VerdictCallout({ verdict }: { verdict: string }) {
  return (
    <div className="border-l-2 border-neutral-300 bg-neutral-50 p-4">
      <p className="text-sm font-medium text-neutral-500">최종 판정</p>
      <div className="mt-2">{renderRichText(verdict)}</div>
    </div>
  );
}

export function CriticismSection({ criticism }: { criticism?: Criticism }) {
  const grouped =
    criticism !== undefined ? groupPointsByAxis(criticism.points) : undefined;

  return (
    <section aria-labelledby="criticism" className="flex flex-col gap-6">
      <SectionHeading id="criticism">③ 냉정한 반론 (反)</SectionHeading>

      {criticism === undefined || grouped === undefined ? (
        <EmptyState
          title="비판 데이터가 없습니다"
          description="이 실행에는 비판 산출물이 포함되어 있지 않습니다."
        />
      ) : (
        <>
          {DIALECTIC_AXES.map((axis) => (
            <div key={axis} className="flex flex-col gap-3">
              <h3 className="text-base font-semibold text-neutral-900">
                {DIALECTIC_AXIS_LABELS[axis]}
              </h3>
              <div className="flex flex-col gap-3">
                {grouped[axis].map((point) => (
                  <CriticismCard key={point.id} point={point} />
                ))}
              </div>
            </div>
          ))}
          <VerdictCallout verdict={criticism.verdict} />
        </>
      )}
    </section>
  );
}
