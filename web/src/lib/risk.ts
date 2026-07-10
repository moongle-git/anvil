import {
  DIALECTIC_AXES,
  DIALECTIC_AXIS_LABELS,
  type Criticism,
  type CriticismPoint,
  type CriticismSeverity,
  type DialecticAxis,
} from "@anvil/types";

export interface RiskAxisScore {
  axis: DialecticAxis;
  label: string;
  score: number;
  keyword: string;
}

/**
 * points를 axis별로 묶는다. 모든 축 키가 존재하며, 해당 축에 point가 없으면 빈 배열이다.
 * 正(ThesisPoint)과 反(CriticismPoint) 양쪽이 같은 좌표계를 쓰므로 제네릭이다 (ADR-011).
 */
export function groupPointsByAxis<T extends { axis: DialecticAxis }>(
  points: readonly T[],
): Record<DialecticAxis, T[]> {
  const grouped = Object.fromEntries(
    DIALECTIC_AXES.map((axis) => [axis, [] as T[]]),
  ) as Record<DialecticAxis, T[]>;

  for (const point of points) {
    // 알 수 없는 축(구버전·손상 데이터)은 조용히 버린다 — 리포트 전체가 죽으면 안 된다
    grouped[point.axis]?.push(point);
  }
  return grouped;
}

/**
 * 레이더 차트의 축별 점수. LLM에게 따로 묻지 않고 criticism.points에서 파생한다 —
 * 항목별 riskScore와 축별 점수가 어긋날 여지를 없앤다.
 *
 * 축 점수는 평균이 아니라 최댓값이다: 리스크는 최악의 항목이 지배하며,
 * fatal 하나가 minor 셋에 희석되면 레이더가 실제보다 안전해 보인다.
 * 동점이면 배열에서 먼저 나온 point를 쓴다(결정적 동작).
 */
export function buildRiskProfile(criticism: Criticism): RiskAxisScore[] {
  const grouped = groupPointsByAxis(criticism.points);

  return DIALECTIC_AXES.map((axis) => {
    const worst = grouped[axis].reduce<CriticismPoint | undefined>(
      (current, point) =>
        current === undefined || point.riskScore > current.riskScore
          ? point
          : current,
      undefined,
    );

    return {
      axis,
      label: DIALECTIC_AXIS_LABELS[axis],
      // CriticismSchema의 refine이 빈 축을 막지만, 구버전·손상 데이터를 방어한다
      score: worst?.riskScore ?? 0,
      keyword: worst?.riskKeyword ?? "",
    };
  });
}

/** rebuts → ThesisPoint 조회용 맵. 끊어진 참조는 단순히 조회 실패(undefined)가 된다. */
export function indexById<T extends { id: string }>(
  items: readonly T[],
): Map<string, T> {
  return new Map(items.map((item) => [item.id, item]));
}

// 색·정렬용 severity 서열. fatal이 가장 위험하다.
const SEVERITY_RANK: Record<CriticismSeverity, number> = {
  minor: 0,
  major: 1,
  fatal: 2,
};

/**
 * criticism.points 중 가장 높은 severity. RiskRadar 폴리곤 색을 결정한다.
 * 빈 배열·구버전/손상 데이터는 'minor'로 수렴한다 (no-throw).
 */
export function maxSeverity(criticism: Criticism): CriticismSeverity {
  return criticism.points.reduce<CriticismSeverity>(
    (worst, point) =>
      SEVERITY_RANK[point.severity] > SEVERITY_RANK[worst]
        ? point.severity
        : worst,
    "minor",
  );
}
