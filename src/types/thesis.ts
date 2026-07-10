import { z } from "zod";

export const ThesisSchema = z.object({
  revenueModel: z.string().min(1),
  growthLevers: z.array(z.string().min(1)).min(1),
  marketTailwinds: z.array(z.string().min(1)).min(1),
  bestCaseScenario: z.string().min(1),
  winningThesis: z.string().min(1),
});
export type Thesis = z.infer<typeof ThesisSchema>;
