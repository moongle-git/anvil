import {
  isWithinBand,
  RECOMMENDATION_SCORE_BANDS,
  RECOMMENDATIONS,
  type Recommendation,
} from "@anvil/types";

interface SurvivalGaugeProps {
  score: number; // 0~100
  recommendation: Recommendation;
}

// 게이지 값 색은 recommendation prop이 아니라 '점수가 속한 밴드'에서 파생한다.
// 경계 숫자(39/40/69/70)는 RECOMMENDATION_SCORE_BANDS가 단일 소스 — 여기에 다시 적지 않는다.
function scoreBand(score: number): Recommendation {
  return (
    RECOMMENDATIONS.find((rec) =>
      isWithinBand(score, RECOMMENDATION_SCORE_BANDS[rec]),
    ) ?? "abandon"
  );
}

// 밴드 → UI_GUIDE 팔레트(값 부분). severity/run 상태 색을 재사용하고 새 hex를 만들지 않는다.
const BAND_FILL: Record<Recommendation, string> = {
  abandon: "bg-red-600",
  pivot: "bg-amber-600",
  proceed: "bg-green-600",
};

// 최종 판정의 생존 점수 게이지(UI_GUIDE SurvivalGauge). 정적 렌더링 — 애니메이션·트랜지션 없음.
export function SurvivalGauge({ score, recommendation }: SurvivalGaugeProps) {
  const clamped = Math.max(0, Math.min(100, score));
  const band = scoreBand(clamped);

  return (
    <div className="flex items-center gap-3">
      <div
        role="meter"
        aria-valuenow={clamped}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`생존 점수 ${clamped}/100`}
        data-survival-score={score}
        data-recommendation={recommendation}
        data-score-band={band}
        className="h-2 w-full max-w-xs overflow-hidden rounded-full bg-neutral-200"
      >
        <div
          className={`h-full ${BAND_FILL[band]}`}
          style={{ width: `${clamped}%` }}
        />
      </div>
      <span className="text-base font-semibold tabular-nums text-neutral-900">
        {clamped}
        <span className="font-normal text-neutral-500">/100</span>
      </span>
    </div>
  );
}
