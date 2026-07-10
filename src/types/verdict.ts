import { z } from "zod";
import {
  CriticismSeveritySchema,
  isWithinBand,
  type ScoreBand,
} from "./dialectic.js";

/** 合(재설계) 이후의 최종 판정 — 제3의 에이전트가 생성한다 (ADR-010) */
export const RECOMMENDATIONS = ["proceed", "pivot", "abandon"] as const;
export const RecommendationSchema = z.enum(RECOMMENDATIONS);
export type Recommendation = (typeof RECOMMENDATIONS)[number];

/** 한국어 라벨 단일 소스 */
export const RECOMMENDATION_LABELS: Record<Recommendation, string> = {
  proceed: "추진",
  pivot: "피벗",
  abandon: "철회",
};

/** survivalScore와 recommendation의 대응 밴드 */
export const RECOMMENDATION_SCORE_BANDS: Record<Recommendation, ScoreBand> = {
  abandon: { min: 0, max: 39 },
  pivot: { min: 40, max: 69 },
  proceed: { min: 70, max: 100 },
};

export const ResidualRiskSchema = z.object({
  /** 짧은 명사구 */
  keyword: z.string().min(1),
  severity: CriticismSeveritySchema,
  note: z.string().min(1),
});
export type ResidualRisk = z.infer<typeof ResidualRiskSchema>;

export const VerdictSchema = z
  .object({
    survivalScore: z.number().int().min(0).max(100),
    recommendation: RecommendationSchema,
    /** 한 문장 결론 */
    headline: z.string().min(1),
    /** 종합 결론 단락 */
    rationale: z.string().min(1),
    /** 合의 피벗 이후에도 남는 리스크 */
    residualRisks: z.array(ResidualRiskSchema).min(1),
    /** 이 조건이 충족되면 생존한다 */
    conditions: z.array(z.string().min(1)).min(1),
  })
  // "생존 점수 20점인데 recommendation은 proceed" 같은 자기모순 출력을 막는다.
  // 위반하면 gemini.ts의 재시도 루프가 에러 메시지를 되먹여 교정한다.
  .refine(
    (verdict) =>
      isWithinBand(
        verdict.survivalScore,
        RECOMMENDATION_SCORE_BANDS[verdict.recommendation],
      ),
    { message: "survivalScore가 recommendation 밴드와 모순된다" },
  );
export type Verdict = z.infer<typeof VerdictSchema>;
