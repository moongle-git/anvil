import { z } from "zod";
import {
  CriticismSeveritySchema,
  DialecticAxisSchema,
  SEVERITY_SCORE_BANDS,
  coversAllAxes,
  hasUniqueIds,
  isWithinBand,
} from "./dialectic.js";

export const CriticismPointSchema = z
  .object({
    id: z.string().min(1),
    axis: DialecticAxisSchema,
    /**
     * 반박 대상 ThesisPoint.id. 존재 여부는 검증하지 않는다 — CriticismSchema는 Thesis를 모른다.
     * Split View의 좌우 정렬은 axis가 담당하고, rebuts는 "이 낙관을 정면 반박함" 칩 용도다.
     */
    rebuts: z.string().min(1).optional(),
    claim: z.string().min(1),
    evidence: z.string().min(1),
    severity: CriticismSeveritySchema,
    riskScore: z.number().int().min(0).max(100),
    /** 뱃지·레이더 라벨용 짧은 명사구 */
    riskKeyword: z.string().min(1),
  })
  .refine(
    (point) =>
      isWithinBand(point.riskScore, SEVERITY_SCORE_BANDS[point.severity]),
    { message: "riskScore가 severity 밴드를 벗어났다" },
  );
export type CriticismPoint = z.infer<typeof CriticismPointSchema>;

export const CriticismSchema = z
  .object({
    points: z.array(CriticismPointSchema).min(3),
    /** 反 섹션의 소결론. 리포트의 최종 판정이 아니다 — 그건 verdict.json이 담당한다 (ADR-010). */
    verdict: z.string().min(1),
  })
  .refine((criticism) => coversAllAxes(criticism.points), {
    message: "points는 painPoint·bm·copycat 세 축을 모두 포함해야 한다",
  })
  .refine((criticism) => hasUniqueIds(criticism.points), {
    message: "CriticismPoint.id는 고유해야 한다",
  });
export type Criticism = z.infer<typeof CriticismSchema>;
