import type { CriticismSeverity } from "@anvil/types";
import type { RiskAxisScore } from "@/lib/risk";
import {
  axisLabelPositions,
  radarVertices,
  toPolygonPoints,
} from "@/lib/radar";

// severity → SVG stroke/fill 색. UI_GUIDE severity 팔레트(red-600/amber-600/gray-500)를
// 그대로 재사용한다 — 새 hex를 만들지 않는다 (UI_GUIDE 원칙 3).
const SEVERITY_SVG_COLOR: Record<CriticismSeverity, string> = {
  fatal: "fill-red-600 stroke-red-600",
  major: "fill-amber-600 stroke-amber-600",
  minor: "fill-gray-500 stroke-gray-500",
};

// 동심 다각형 3겹의 반지름 비율
const GRID_RINGS = [1 / 3, 2 / 3, 1] as const;
const MAX_SCORE = 100;

interface RiskRadarProps {
  profile: RiskAxisScore[]; // buildRiskProfile()의 결과
  maxSeverity: CriticismSeverity; // 폴리곤 색을 결정한다
  size?: number; // 기본 200
}

export function RiskRadar({ profile, maxSeverity, size = 200 }: RiskRadarProps) {
  const center = size / 2;
  const dataPoints = toPolygonPoints(
    radarVertices(
      profile.map((axisScore) => axisScore.score),
      size,
    ),
  );
  // 축선(스포크)의 바깥 끝 = 최대 반지름 정점
  const spokes = radarVertices(
    profile.map(() => MAX_SCORE),
    size,
  );
  const labels = axisLabelPositions(profile.length, size);
  const ariaSummary = profile
    .map((axisScore) => `${axisScore.label} ${axisScore.score}`)
    .join(", ");

  return (
    <div data-max-severity={maxSeverity}>
      <svg
        role="img"
        aria-label={`리스크 레이더 — ${ariaSummary}`}
        viewBox={`0 0 ${size} ${size}`}
        width={size}
        height={size}
      >
        {/* 격자: 동심 다각형 3겹 (neutral-200) */}
        {GRID_RINGS.map((ratio) => (
          <polygon
            key={ratio}
            points={toPolygonPoints(
              radarVertices(
                profile.map(() => ratio * MAX_SCORE),
                size,
              ),
            )}
            className="fill-none stroke-neutral-200"
          />
        ))}

        {/* 축선(스포크, neutral-200) */}
        {spokes.map((vertex, index) => (
          <line
            key={profile[index].axis}
            x1={center}
            y1={center}
            x2={vertex.x}
            y2={vertex.y}
            className="stroke-neutral-200"
          />
        ))}

        {/* 데이터 폴리곤: 색은 최고 severity 하나로 결정, fill opacity 0.08 */}
        <polygon
          points={dataPoints}
          className={SEVERITY_SVG_COLOR[maxSeverity]}
          fillOpacity={0.08}
          strokeWidth={1.5}
        />

        {/* 축 라벨 (text-xs neutral-500) */}
        {labels.map((position, index) => (
          <text
            key={profile[index].axis}
            data-axis={profile[index].axis}
            x={position.x}
            y={position.y}
            textAnchor="middle"
            dominantBaseline="middle"
            className="fill-neutral-500 text-xs"
          >
            {profile[index].label}
          </text>
        ))}
      </svg>

      {/* 차트는 장식이 아니라 데이터다 — 스크린리더용 텍스트 대안 */}
      <ul aria-label="축별 리스크 점수" className="sr-only">
        {profile.map((axisScore) => (
          <li key={axisScore.axis}>
            {axisScore.label}: {axisScore.score}/100
            {axisScore.keyword ? ` (${axisScore.keyword})` : ""}
          </li>
        ))}
      </ul>
    </div>
  );
}
