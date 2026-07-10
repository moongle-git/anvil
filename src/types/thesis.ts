import { z } from "zod";
import {
  DialecticAxisSchema,
  coversAllAxes,
  hasUniqueIds,
} from "./dialectic.js";

export const ThesisPointSchema = z.object({
  id: z.string().min(1),
  axis: DialecticAxisSchema,
  /** 한 문장 낙관 주장 — Split View 좌측 카드 제목 */
  claim: z.string().min(1),
  /** MarketContext의 실제 데이터를 인용한 근거 */
  rationale: z.string().min(1),
});
export type ThesisPoint = z.infer<typeof ThesisPointSchema>;

export const ThesisSchema = z
  .object({
    points: z.array(ThesisPointSchema).min(3),
    revenueModel: z.string().min(1),
    growthLevers: z.array(z.string().min(1)).min(1),
    marketTailwinds: z.array(z.string().min(1)).min(1),
    bestCaseScenario: z.string().min(1),
    winningThesis: z.string().min(1),
  })
  .refine((thesis) => coversAllAxes(thesis.points), {
    message: "points는 painPoint·bm·copycat 세 축을 모두 포함해야 한다",
  })
  .refine((thesis) => hasUniqueIds(thesis.points), {
    message: "ThesisPoint.id는 고유해야 한다",
  });
export type Thesis = z.infer<typeof ThesisSchema>;
