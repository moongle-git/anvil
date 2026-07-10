import { z } from "zod";

/**
 * 正(Thesis)과 反(Criticism)이 공유하는 좌표계.
 * 두 산출물이 같은 축을 쓰기 때문에 Split View에서 좌우를 짝지을 수 있다 (ADR-011).
 */
export const DIALECTIC_AXES = ["painPoint", "bm", "copycat"] as const;
export const DialecticAxisSchema = z.enum(DIALECTIC_AXES);
export type DialecticAxis = (typeof DIALECTIC_AXES)[number];

/**
 * 축의 한국어 라벨 단일 소스. 正/反 양쪽 컬럼 헤더와 레이더 축 라벨이 함께 쓴다.
 * 라벨은 어느 한쪽 입장도 담지 않는 중립어여야 한다 — "페인포인트의 허구성"은 反의 언어다.
 */
export const DIALECTIC_AXIS_LABELS: Record<DialecticAxis, string> = {
  painPoint: "페인포인트",
  bm: "수익 모델",
  copycat: "해자와 카피캣",
};

/**
 * severity는 criticism.ts가 아니라 여기 산다: verdict.ts의 잔존 리스크도 같은 등급을 쓰므로,
 * criticism.ts에 두면 dialectic ↔ criticism 순환 import가 생긴다.
 */
export const CriticismSeveritySchema = z.enum(["fatal", "major", "minor"]);
export type CriticismSeverity = z.infer<typeof CriticismSeveritySchema>;

/** 점수와 등급의 대응 구간 (양 끝 포함) */
export interface ScoreBand {
  min: number;
  max: number;
}

/** severity와 riskScore의 대응 밴드. UI·테스트·프롬프트가 모두 이 상수를 참조한다. */
export const SEVERITY_SCORE_BANDS: Record<CriticismSeverity, ScoreBand> = {
  minor: { min: 0, max: 33 },
  major: { min: 34, max: 66 },
  fatal: { min: 67, max: 100 },
};

export function isWithinBand(score: number, band: ScoreBand): boolean {
  return score >= band.min && score <= band.max;
}

/** points가 세 축을 모두 최소 1개씩 덮는지 */
export function coversAllAxes(
  points: readonly { axis: DialecticAxis }[],
): boolean {
  return DIALECTIC_AXES.every((axis) => points.some((p) => p.axis === axis));
}

/** id가 고유한지 */
export function hasUniqueIds(points: readonly { id: string }[]): boolean {
  return new Set(points.map((p) => p.id)).size === points.length;
}
