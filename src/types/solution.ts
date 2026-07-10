import { z } from "zod";

export const SolutionSchema = z.object({
  minimalInput: z.string().min(1),
  agenticWorkflow: z.string().min(1),
  dataFlywheel: z.string().min(1),
  monetization: z.string().min(1),
  revisedConcept: z.string().min(1),
  // 合: 낙관 논제(正)와 냉정 반론(反)을 종합한 새 통찰·최종 결론.
  // 구 solution.json 하위호환을 위해 optional.
  synthesis: z.string().min(1).optional(),
});
export type Solution = z.infer<typeof SolutionSchema>;
