import { z } from "zod";

export const SolutionSchema = z.object({
  minimalInput: z.string().min(1),
  agenticWorkflow: z.string().min(1),
  dataFlywheel: z.string().min(1),
  monetization: z.string().min(1),
  revisedConcept: z.string().min(1),
});
export type Solution = z.infer<typeof SolutionSchema>;
