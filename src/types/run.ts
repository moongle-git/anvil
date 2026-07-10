import { z } from "zod";

export const PIPELINE_STEPS = [
  "interviewer",
  "context-hunter",
  "thesis",
  "cold-critic",
  "solution-designer",
] as const;
export type PipelineStepName = (typeof PIPELINE_STEPS)[number];

export const PipelineStepNameSchema = z.enum(PIPELINE_STEPS);

// waiting: 인터뷰 질문에 대한 사용자 답변을 기다리며 일시 중지된 상태
export const StepStatusSchema = z.enum([
  "pending",
  "completed",
  "error",
  "waiting",
]);
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
  // 웹에서 생성된 run만 인터뷰(질문-답변)를 활성화한다. 구 state.json 하위호환을 위해 default(false).
  interview: z.boolean().optional().default(false),
});
export type RunState = z.infer<typeof RunStateSchema>;
