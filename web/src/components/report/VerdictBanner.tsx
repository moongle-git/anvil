import type { Criticism, CriticismSeverity } from "@anvil/types";
import { Card, SeverityBadge } from "@/components/ui";
import { renderInline } from "@/lib/richText";
import { countSeverities } from "@/lib/severity";

const SEVERITY_ORDER: CriticismSeverity[] = ["fatal", "major", "minor"];

interface VerdictBannerProps {
  criticism?: Criticism;
}

// 역피라미드의 핵심: 스크롤 없이 verdict와 severity 집계가 보인다. 헤더 바로 아래에 둔다.
export function VerdictBanner({ criticism }: VerdictBannerProps) {
  if (!criticism) {
    return (
      <Card className="border-neutral-300 bg-neutral-50">
        <p className="text-[15px] leading-[1.8] text-neutral-700">
          비판 데이터를 불러올 수 없습니다.
        </p>
      </Card>
    );
  }

  const counts = countSeverities(criticism);

  return (
    <Card className="flex flex-col gap-4 border-neutral-300 bg-neutral-50">
      <div className="flex flex-col gap-1">
        <span className="text-sm font-medium text-neutral-500">종합 판정</span>
        {/* renderRichText가 아닌 renderInline — <p> 안에 <div><p>를 중첩하지 않고
            배너 고유의 text-neutral-900을 유지한다 */}
        <p className="max-w-3xl text-[15px] leading-[1.8] text-neutral-900">
          {renderInline(criticism.verdict)}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-3" aria-label="심각도 집계">
        {SEVERITY_ORDER.map((severity) => (
          <span key={severity} className="inline-flex items-center gap-1.5">
            <SeverityBadge severity={severity} />
            <span
              data-severity-count={severity}
              className="text-sm font-semibold tabular-nums text-neutral-900"
            >
              {counts[severity]}
            </span>
          </span>
        ))}
      </div>
    </Card>
  );
}
