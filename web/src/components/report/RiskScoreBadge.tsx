import type { CriticismSeverity } from "@anvil/types";
import { SeverityBadge } from "@/components/ui";

interface RiskScoreBadgeProps {
  severity: CriticismSeverity;
  score: number; // 0~100
  keyword: string;
}

// 위험도 점수와 리스크 키워드를 분리해 노출한다(사용자 요구). severity 라벨은 SeverityBadge 재사용.
export function RiskScoreBadge({
  severity,
  score,
  keyword,
}: RiskScoreBadgeProps) {
  return (
    <span
      className="inline-flex items-center gap-1.5"
      data-risk-score={score}
      data-risk-keyword={keyword}
    >
      <SeverityBadge severity={severity} />
      <span className="text-xs font-medium tabular-nums text-neutral-700">
        {`${score}/100`}
      </span>
      {/* 키워드는 뱃지 바깥에 분리 노출 (UI_GUIDE RiskScoreBadge) */}
      {keyword ? (
        <span className="text-xs text-neutral-500">{keyword}</span>
      ) : null}
    </span>
  );
}
