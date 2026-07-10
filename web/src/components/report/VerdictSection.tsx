import {
  RECOMMENDATION_LABELS,
  type Recommendation,
  type Verdict,
} from "@anvil/types";
import {
  Badge,
  type BadgeTone,
  EmptyState,
  SectionHeading,
  SeverityBadge,
} from "@/components/ui";
import { renderInline, renderRichText } from "@/lib/richText";
import { SurvivalGauge } from "./SurvivalGauge";

// recommendation → 뱃지 시맨틱 톤. 새 색이 아니라 기존 Badge 톤을 재사용한다.
const RECOMMENDATION_TONES: Record<Recommendation, BadgeTone> = {
  proceed: "success",
  pivot: "warning",
  abandon: "danger",
};

function Subheading({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-base font-semibold text-neutral-900">{children}</h3>
  );
}

// 5단계 서사의 마지막 절: 제3의 판정 에이전트가 낸 최종 판정(verdict.json).
// criticism.verdict(反의 소결론)와 다르다 — 최종 판정의 유일한 소스는 verdict.json이다 (ADR-010).
export function VerdictSection({ verdict }: { verdict?: Verdict }) {
  if (verdict === undefined) {
    // 구버전 run은 verdict step 이전에 생성돼 verdict.json이 없다 (ADR-011)
    return (
      <section aria-labelledby="verdict" className="flex max-w-3xl flex-col gap-6">
        <SectionHeading id="verdict">⑤ 최종 판정</SectionHeading>
        <EmptyState
          title="최종 판정이 없습니다"
          description="이 실행은 최종 판정 단계 이전에 생성되었습니다."
        />
      </section>
    );
  }

  return (
    <section aria-labelledby="verdict" className="flex max-w-3xl flex-col gap-6">
      <SectionHeading id="verdict">⑤ 최종 판정</SectionHeading>

      {/* 결론 한 문장: 페이지 제목(3xl)보다 작고 섹션 제목(xl)보다 큰 급 */}
      <p className="text-2xl font-semibold leading-snug text-neutral-900">
        {renderInline(verdict.headline)}
      </p>

      {/* 생존 점수 게이지 + 권고 뱃지 */}
      <div className="flex flex-wrap items-center gap-4">
        <SurvivalGauge
          score={verdict.survivalScore}
          recommendation={verdict.recommendation}
        />
        <Badge tone={RECOMMENDATION_TONES[verdict.recommendation]}>
          {RECOMMENDATION_LABELS[verdict.recommendation]}
        </Badge>
      </div>

      {/* 종합 결론 단락 */}
      {renderRichText(verdict.rationale)}

      <div className="flex flex-col gap-3">
        <Subheading>잔존 리스크</Subheading>
        <ul className="flex flex-col gap-3">
          {verdict.residualRisks.map((risk, index) => (
            <li key={`${risk.keyword}-${index}`} className="flex flex-col gap-1">
              <div className="flex items-center gap-2">
                <SeverityBadge severity={risk.severity} />
                {/* 키워드는 뱃지 옆에 분리 노출 */}
                <span className="text-sm font-medium text-neutral-700">
                  {risk.keyword}
                </span>
              </div>
              <p className="text-[15px] leading-[1.8] text-neutral-700">
                {renderInline(risk.note)}
              </p>
            </li>
          ))}
        </ul>
      </div>

      <div className="flex flex-col gap-3">
        <Subheading>생존 조건</Subheading>
        <ol className="list-decimal space-y-3 pl-6 text-[15px] leading-[1.8] text-neutral-700 marker:font-medium marker:text-neutral-500">
          {verdict.conditions.map((condition, index) => (
            <li key={index}>{renderInline(condition)}</li>
          ))}
        </ol>
      </div>
    </section>
  );
}
