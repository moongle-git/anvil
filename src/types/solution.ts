import { z, type ZodType } from "zod";
import type { Criticism } from "./criticism.js";
import { danglingRefs, duplicateRefs, uncoveredFatalIds } from "./ledger.js";

export const REMEDY_STRATEGIES = ["defend", "bypass"] as const;
export const RemedyStrategySchema = z.enum(REMEDY_STRATEGIES);
export type RemedyStrategy = (typeof REMEDY_STRATEGIES)[number];

/** 한국어 라벨 단일 소스 — 리포트·웹이 함께 쓴다 */
export const REMEDY_STRATEGY_LABELS: Record<RemedyStrategy, string> = {
  defend: "방어", // 결함이 지적한 취약점을 구조적으로 제거한다
  bypass: "우회", // 결함이 성립하는 전장을 떠나, 같은 자산으로 다른 가치를 판다
};

export const RemedySchema = z.object({
  /** 해결 대상 CriticismPoint.id. 존재 여부는 solutionSchemaFor(criticism)가 검증한다 */
  respondsTo: z.string().min(1),
  strategy: RemedyStrategySchema,
  /** 이 결함을 어떻게 푸는가 — 구체적인 해결책 */
  remedy: z.string().min(1),
});
export type Remedy = z.infer<typeof RemedySchema>;

export const SolutionSchema = z.object({
  minimalInput: z.string().min(1),
  agenticWorkflow: z.string().min(1),
  dataFlywheel: z.string().min(1),
  monetization: z.string().min(1),
  revisedConcept: z.string().min(1),
  // 合: 낙관 논제(正)와 냉정 반론(反)을 종합한 새 통찰·최종 결론.
  synthesis: z.string().min(1),
  /**
   * 결함↔해결책 원장 (ADR-017). 정적 스키마는 관대하다 — 원장 이전에 저장된 run이
   * 웹에서 조용히 빈 화면이 되면 안 된다. fatal 전건 커버리지는 팩토리가 강제한다.
   */
  remedies: z.array(RemedySchema).default([]),
});
export type Solution = z.infer<typeof SolutionSchema>;

/**
 * criticism을 아는 solution 스키마. 하류가 상류를 안다 — 의존은 파이프라인이 흐르는
 * 방향으로만 흐른다 (ADR-017).
 *
 * 여기서만 fatal 전건 커버리지를 강제한다. 반환 타입이 ZodType<Solution>이라
 * generateStructured의 재시도 루프를 그대로 타고, addIssue 메시지가 z.prettifyError를 거쳐
 * 그대로 교정 프롬프트가 된다 (ADR-004) — 그래서 모든 메시지가 문제의 id를 이름으로 지목한다.
 *
 * 점수 규칙은 없다. 재설계는 채점하지 않는다 (ADR-010).
 */
export function solutionSchemaFor(criticism: Criticism): ZodType<Solution> {
  return SolutionSchema.superRefine((solution, ctx) => {
    const refs = solution.remedies.map((remedy) => remedy.respondsTo);

    for (const id of danglingRefs(refs, criticism.points)) {
      ctx.addIssue({
        code: "custom",
        path: ["remedies"],
        message: `${id}라는 비판은 존재하지 않는다. respondsTo는 反이 제기한 비판의 id여야 한다`,
      });
    }

    for (const id of duplicateRefs(refs)) {
      ctx.addIssue({
        code: "custom",
        path: ["remedies"],
        message: `${id}에 대한 해결책이 중복됐다. 비판 하나에 해결책은 하나다`,
      });
    }

    for (const id of uncoveredFatalIds(refs, criticism.points)) {
      ctx.addIssue({
        code: "custom",
        path: ["remedies"],
        message: `${id}에 대한 해결책이 없다. 비판이 fatal로 판정한 항목은 전부 remedies에 등장해야 한다`,
      });
    }
  });
}
