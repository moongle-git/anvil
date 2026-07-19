import { HORIZON_LABELS, type ScoutOrigin } from "@anvil/types";
import { CapitalSignalItem, CapitalSignalList } from "@/components/ui";
import { formatDateTime } from "@/lib/format";

/**
 * "이 주제는 어디서 왔는가" — 자동 탐색으로 시작한 run의 머리말.
 *
 * 배치는 report.md와 같다(step 6): 제목 바로 아래, ① 시장 맥락보다 **앞**. 새 번호 섹션을
 * 만들지 않고 목차(SectionNav)에도 올리지 않는다 — 항목이 늘면 5단계 서사가 6단계로 보인다.
 * 독자는 논증을 읽기 전에 주제의 출처를 알아야 하지만, 출처는 서사의 한 단계가 아니다.
 *
 * **담기는 것은 출처이지 판정이 아니다.** 그래서 이 컴포넌트는 verdict를 인자로 받지 않는다 —
 * 넘길 수 없으면 샐 수 없다(SolutionSection·remedySection과 같은 구조적 방어, ADR-008).
 */
export function ScoutOriginSection({ origin }: { origin: ScoutOrigin }) {
  const { opportunity } = origin;

  return (
    <section
      data-scout-origin=""
      aria-label="이 주제의 출처"
      className="flex max-w-3xl flex-col gap-6 border-b border-neutral-200 pb-8"
    >
      <div className="flex flex-col gap-2">
        <h2 className="text-base font-semibold text-neutral-900">
          이 주제의 출처 (자동 탐색)
        </h2>
        <p className="text-[15px] leading-[1.8] text-neutral-700">
          이 주제는 사람이 고른 것이 아니라 자본 신호 탐색이 후보로 올린 것입니다.
          아래는 그 근거입니다.
        </p>
        <p className="text-xs tabular-nums text-neutral-500">
          탐색 범위: {origin.scope} · 탐색 시점{" "}
          {formatDateTime(origin.searchedAt)} ·{" "}
          {HORIZON_LABELS[opportunity.horizon]}
        </p>
      </div>

      <dl className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <dt className="text-sm font-medium text-neutral-500">왜 지금인가</dt>
          <dd className="text-[15px] leading-[1.8] text-neutral-700">
            {opportunity.whyNow}
          </dd>
        </div>
        <div className="flex flex-col gap-1">
          <dt className="text-sm font-medium text-neutral-500">
            누가 돈을 내나
          </dt>
          <dd className="text-[15px] leading-[1.8] text-neutral-700">
            {opportunity.whoPays}
          </dd>
        </div>
      </dl>

      <div className="flex flex-col gap-3">
        <h3 className="text-sm font-medium text-neutral-500">근거 신호</h3>
        <CapitalSignalList signals={opportunity.signals} />
      </div>

      {/* 유리한 신호만 남기면 리포트가 자기 홍보물이 된다. 반대 증거는 후보 스키마가 필수로
          요구한 것이므로, 렌더링에서 조용히 빠지면 그 강제가 무의미해진다 (report.md와 같은 규율) */}
      <div className="flex flex-col gap-3">
        <h3 className="text-sm font-medium text-neutral-500">반대 증거</h3>
        <ul className="flex flex-col gap-4">
          <CapitalSignalItem signal={opportunity.counterSignal} />
        </ul>
      </div>
    </section>
  );
}
