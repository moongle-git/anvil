import { z, type ZodType } from "zod";
import type { Criticism } from "./criticism.js";
import {
  CriticismSeveritySchema,
  isWithinBand,
  type ScoreBand,
} from "./dialectic.js";
import { danglingRefs, duplicateRefs, uncoveredFatalIds } from "./ledger.js";

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

/** 合이 낸 해결책 하나에 대한 판정의 감사 결과 (ADR-017) */
export const REMEDY_VERDICTS = ["solid", "restated", "dismissed"] as const;
export const RemedyVerdictSchema = z.enum(REMEDY_VERDICTS);
export type RemedyVerdict = (typeof REMEDY_VERDICTS)[number];

/** 한국어 라벨 단일 소스 — 리포트·웹이 함께 쓴다 */
export const REMEDY_VERDICT_LABELS: Record<RemedyVerdict, string> = {
  solid: "유효한 해결책",
  restated: "재주장", // 비판이 이미 반박한 것을 수식어만 붙여 다시 제시
  dismissed: "비판 기각", // 풀지 않고 비판이 과장이라며 넘김
};

export const RemedyAuditSchema = z.object({
  /** 감사 대상 CriticismPoint.id. 존재 여부는 verdictSchemaFor(criticism)가 검증한다 */
  criticismId: z.string().min(1),
  assessment: RemedyVerdictSchema,
  note: z.string().min(1),
});
export type RemedyAudit = z.infer<typeof RemedyAuditSchema>;

export const ResidualRiskSchema = z.object({
  /** 짧은 명사구 */
  keyword: z.string().min(1),
  severity: CriticismSeveritySchema,
  note: z.string().min(1),
  /** 어느 비판에서 유래했는가. 피벗이 새로 만든 리스크면 생략한다 */
  criticismId: z.string().min(1).optional(),
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
    /**
     * 合이 낸 해결책의 항목별 감사 (ADR-017). 정적 스키마는 관대하다 — 감사 이전에 저장된
     * run이 웹에서 조용히 빈 화면이 되면 안 된다. fatal 전건 감사는 팩토리가 강제한다.
     */
    remedyAudits: z.array(RemedyAuditSchema).default([]),
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

/**
 * criticism을 아는 verdict 스키마. solutionSchemaFor와 같은 규율이다 (ADR-017) —
 * 참조 무결성·중복 금지·fatal 전건 감사만 강제하고, 유효성 판단은 판정 에이전트에 남긴다.
 *
 * 점수 하한(floor)은 두지 않는다. "잔존 fatal이 있으면 40점 미만"은 피벗 이전의 사망선고를
 * 코드로 자동화하는 것이라 ADR-010 위반이고, 실측상 잔존 fatal을 정직하게 보고한 유일한 run만
 * 처벌한다. 판정의 관대함은 remedyAudits[].assessment에 이름으로 적혀 반박 가능해질 뿐이다.
 */
export function verdictSchemaFor(criticism: Criticism): ZodType<Verdict> {
  return VerdictSchema.superRefine((verdict, ctx) => {
    const refs = verdict.remedyAudits.map((audit) => audit.criticismId);

    for (const id of danglingRefs(refs, criticism.points)) {
      ctx.addIssue({
        code: "custom",
        path: ["remedyAudits"],
        message: `${id}라는 비판은 존재하지 않는다. criticismId는 反이 제기한 비판의 id여야 한다`,
      });
    }

    for (const id of duplicateRefs(refs)) {
      ctx.addIssue({
        code: "custom",
        path: ["remedyAudits"],
        message: `${id}에 대한 감사가 중복됐다. 비판 하나에 감사는 하나다`,
      });
    }

    for (const id of uncoveredFatalIds(refs, criticism.points)) {
      ctx.addIssue({
        code: "custom",
        path: ["remedyAudits"],
        message: `${id}에 대한 감사가 없다. 비판이 fatal로 판정한 항목은 전부 remedyAudits에 등장해야 한다`,
      });
    }
  });
}
