import type { Solution } from "@anvil/types";
import { EmptyState, SectionHeading } from "@/components/ui";
import { renderRichText } from "@/lib/richText";

export function MonetizationSection({ solution }: { solution?: Solution }) {
  return (
    <section aria-labelledby="monetization" className="flex flex-col gap-6">
      <SectionHeading id="monetization">
        ⑤ 지속 가능한 비즈니스 모델
      </SectionHeading>

      {solution === undefined ? (
        <EmptyState
          title="비즈니스 모델 데이터가 없습니다"
          description="이 실행에는 솔루션 산출물이 포함되어 있지 않습니다."
        />
      ) : (
        renderRichText(solution.monetization)
      )}
    </section>
  );
}
