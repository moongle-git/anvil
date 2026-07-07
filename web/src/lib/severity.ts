import type { Criticism } from "@anvil/types";

export interface SeverityCounts {
  fatal: number;
  major: number;
  minor: number;
}

// 3축(페인포인트 허구성/BM 취약성/카피캣 리스크) 전체를 합산해 severity별 개수를 센다.
export function countSeverities(criticism: Criticism): SeverityCounts {
  const counts: SeverityCounts = { fatal: 0, major: 0, minor: 0 };
  const allPoints = [
    ...criticism.painPointReality,
    ...criticism.bmWeakness,
    ...criticism.copycatRisk,
  ];
  for (const point of allPoints) {
    counts[point.severity] += 1;
  }
  return counts;
}
