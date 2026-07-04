import { z } from "zod";

export const CriticismSeveritySchema = z.enum(["fatal", "major", "minor"]);
export type CriticismSeverity = z.infer<typeof CriticismSeveritySchema>;

export const CriticismPointSchema = z.object({
  claim: z.string().min(1),
  evidence: z.string().min(1),
  severity: CriticismSeveritySchema,
});
export type CriticismPoint = z.infer<typeof CriticismPointSchema>;

export const CriticismSchema = z.object({
  painPointReality: z.array(CriticismPointSchema).min(1),
  bmWeakness: z.array(CriticismPointSchema).min(1),
  copycatRisk: z.array(CriticismPointSchema).min(1),
  verdict: z.string().min(1),
});
export type Criticism = z.infer<typeof CriticismSchema>;
