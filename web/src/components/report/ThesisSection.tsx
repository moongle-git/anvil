import type { Thesis } from "@anvil/types";
import { Card, EmptyState, SectionHeading } from "@/components/ui";
import { renderInline, renderRichText } from "@/lib/richText";

// 正: 수익 모델을 적극 긍정하는 낙관 논제. 구 run(thesis 없음)은 EmptyState.
export function ThesisSection({ thesis }: { thesis?: Thesis }) {
  return (
    <section aria-labelledby="thesis" className="flex flex-col gap-6">
      <SectionHeading id="thesis">② 낙관적 논제 (正)</SectionHeading>

      {thesis === undefined ? (
        <EmptyState
          title="낙관 논제 데이터가 없습니다"
          description="이 실행에는 낙관 논제 산출물이 포함되어 있지 않습니다."
        />
      ) : (
        <>
          {/* 결론(핵심 논지)을 먼저, 강조 테두리로 (역피라미드) */}
          <Card className="flex flex-col gap-2 border-neutral-900">
            <span className="text-sm font-medium text-neutral-500">
              핵심 논지
            </span>
            {renderRichText(thesis.winningThesis)}
          </Card>

          <div className="flex flex-col gap-2">
            <h3 className="text-base font-semibold text-neutral-900">
              수익 모델
            </h3>
            {renderRichText(thesis.revenueModel)}
          </div>

          <div className="flex flex-col gap-2">
            <h3 className="text-base font-semibold text-neutral-900">
              성장 지렛대
            </h3>
            <ul className="list-disc space-y-2 pl-5 text-[15px] leading-[1.8] text-neutral-700 marker:text-neutral-400">
              {thesis.growthLevers.map((lever) => (
                <li key={lever}>{renderInline(lever)}</li>
              ))}
            </ul>
          </div>

          <div className="flex flex-col gap-2">
            <h3 className="text-base font-semibold text-neutral-900">
              시장 순풍
            </h3>
            <ul className="list-disc space-y-2 pl-5 text-[15px] leading-[1.8] text-neutral-700 marker:text-neutral-400">
              {thesis.marketTailwinds.map((tailwind) => (
                <li key={tailwind}>{renderInline(tailwind)}</li>
              ))}
            </ul>
          </div>

          <div className="flex flex-col gap-2">
            <h3 className="text-base font-semibold text-neutral-900">
              최상 시나리오
            </h3>
            {renderRichText(thesis.bestCaseScenario)}
          </div>
        </>
      )}
    </section>
  );
}
