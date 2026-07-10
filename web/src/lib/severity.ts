import type { Criticism } from "@anvil/types";

export interface SeverityCounts {
  fatal: number;
  major: number;
  minor: number;
}

// 세 축(painPoint/bm/copycat)에 걸친 points 전체를 합산해 severity별 개수를 센다.
export function countSeverities(criticism: Criticism): SeverityCounts {
  const counts: SeverityCounts = { fatal: 0, major: 0, minor: 0 };
  for (const point of criticism.points) {
    counts[point.severity] += 1;
  }
  return counts;
}
