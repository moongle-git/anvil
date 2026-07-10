"use client";

import type { PipelineStepName, StepState } from "@anvil/types";
import type { RunDetail } from "@/lib/server/runs";
import { Button, Card } from "@/components/ui";
import { formatDateTime, formatDuration } from "@/lib/format";
import { StepStatusIcon, type StepVisualStatus } from "./StepStatusIcon";
import { useNow } from "./useNow";

// 내부 step명 → 사용자 언어 (PRD 진행 뷰 번역 표)
const STEP_LABELS: Record<PipelineStepName, string> = {
  interviewer: "질문 준비",
  "context-hunter": "시장 조사",
  thesis: "낙관적 논제",
  "cold-critic": "냉정한 비판",
  "solution-designer": "AI 네이티브 재설계",
};

// 진행중 판정: startedAt 있고 completedAt·error 없음 (PRD 규칙)
function stepVisual(step: StepState): StepVisualStatus {
  if (step.status === "completed") return "completed";
  if (step.status === "error") return "error";
  if (step.status === "waiting") return "waiting";
  if (step.startedAt && !step.completedAt) return "running";
  return "pending";
}

// 완료 step은 completedAt-startedAt, 진행중 step은 now-startedAt. 그 외 null.
function stepElapsedMs(step: StepState, nowMs: number): number | null {
  if (!step.startedAt) return null;
  const started = new Date(step.startedAt).getTime();
  if (step.completedAt) {
    return new Date(step.completedAt).getTime() - started;
  }
  if (step.status === "error") return null;
  return nowMs - started;
}

interface ProgressViewProps {
  detail: RunDetail;
  onResume: () => void;
}

export function ProgressView({ detail, onResume }: ProgressViewProps) {
  const { state } = detail;
  const hasRunning = state.steps.some((step) => stepVisual(step) === "running");
  // 진행중 step이 있을 때만 1초 간격으로 경과 시간을 갱신한다
  const now = useNow(hasRunning);

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-1">
        <h1 className="text-3xl font-semibold tracking-tight text-neutral-900">
          {state.idea}
        </h1>
        <p className="text-xs tabular-nums text-neutral-500">
          시작 {formatDateTime(state.createdAt)}
        </p>
      </header>

      {detail.status === "stalled" ? (
        <Card className="flex flex-col gap-3 border-amber-200 bg-amber-50">
          <p className="text-[15px] leading-[1.8] text-neutral-700">
            실행이 중단된 것 같습니다. 실행 프로세스가 종료되었을 수 있어요.
          </p>
          <div>
            <Button onClick={onResume}>이어서 실행</Button>
          </div>
        </Card>
      ) : null}

      <ol className="flex flex-col gap-2">
        {state.steps.map((step) => {
          const visual = stepVisual(step);
          const elapsed = stepElapsedMs(step, now);
          return (
            <li
              key={step.name}
              data-step-name={step.name}
              data-step-status={visual}
              className="flex items-start gap-3 rounded-md border border-neutral-200 p-4"
            >
              <StepStatusIcon status={visual} />
              <div className="flex-1">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-base font-semibold text-neutral-900">
                    {STEP_LABELS[step.name]}
                  </span>
                  {elapsed !== null ? (
                    <span className="text-xs tabular-nums text-neutral-500">
                      {formatDuration(elapsed)}
                    </span>
                  ) : null}
                </div>
                {visual === "error" ? (
                  <div className="mt-3 flex flex-col gap-3 rounded-md border border-red-200 bg-red-50 p-3">
                    <p className="text-sm leading-relaxed text-red-700">
                      {step.errorMessage ?? "이 단계에서 오류가 발생했습니다."}
                    </p>
                    <div>
                      <Button onClick={onResume}>이어서 실행</Button>
                    </div>
                  </div>
                ) : null}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
