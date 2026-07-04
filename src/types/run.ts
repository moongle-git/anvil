import { z } from "zod";

export const PIPELINE_STEPS = [
  "context-hunter",
  "cold-critic",
  "solution-designer",
] as const;
export type PipelineStepName = (typeof PIPELINE_STEPS)[number];

export const PipelineStepNameSchema = z.enum(PIPELINE_STEPS);

export const StepStatusSchema = z.enum(["pending", "completed", "error"]);
export type StepStatus = z.infer<typeof StepStatusSchema>;

const isoDatetime = z.iso.datetime({ offset: true });

export const StepStateSchema = z.object({
  name: PipelineStepNameSchema,
  status: StepStatusSchema,
  startedAt: isoDatetime.optional(),
  completedAt: isoDatetime.optional(),
  failedAt: isoDatetime.optional(),
  errorMessage: z.string().optional(),
});
export type StepState = z.infer<typeof StepStateSchema>;

export const RunStateSchema = z.object({
  runId: z.string().min(1),
  idea: z.string().min(1),
  createdAt: isoDatetime,
  steps: z.array(StepStateSchema),
  completedAt: isoDatetime.optional(),
});
export type RunState = z.infer<typeof RunStateSchema>;
