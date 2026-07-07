"use client";

import { useEffect, useMemo, useState } from "react";
import type { PipelineStepName, StepState } from "@anvil/types";
import { formatDuration } from "@/lib/client/format";
import type { RunDetail } from "@/lib/client/types";
import { Button, Card, RunStatusBadge } from "@/components/ui";

const STEPS: PipelineStepName[] = [
  "context-hunter",
  "cold-critic",
  "solution-designer",
];

const STEP_LABELS: Record<PipelineStepName, string> = {
  "context-hunter": "시장 조사",
  "cold-critic": "냉정한 비판",
  "solution-designer": "AI 네이티브 재설계",
};

interface ProgressViewProps {
  detail: RunDetail;
  onResume: () => Promise<void>;
  isResuming: boolean;
  resumeError?: string;
}

function stepElapsed(step: StepState, nowMs: number): string | null {
  if (!step.startedAt) {
    return null;
  }
  const started = new Date(step.startedAt).getTime();
  const ended = step.completedAt ? new Date(step.completedAt).getTime() : nowMs;
  return formatDuration(ended - started);
}

function stepStateLabel(step: StepState): string {
  if (step.status === "completed") {
    return "완료";
  }
  if (step.status === "error") {
    return "실패";
  }
  if (step.startedAt) {
    return "진행중";
  }
  return "대기";
}

function StepIcon({ step }: { step: StepState }) {
  if (step.status === "completed") {
    return (
      <svg viewBox="0 0 20 20" className="h-5 w-5 text-green-600" aria-label="완료">
        <path
          d="M4.5 10.5 8 14l7.5-8"
          fill="none"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="1.8"
        />
      </svg>
    );
  }
  if (step.status === "error") {
    return (
      <svg viewBox="0 0 20 20" className="h-5 w-5 text-red-600" aria-label="실패">
        <path
          d="m6 6 8 8M14 6l-8 8"
          fill="none"
          stroke="currentColor"
          strokeLinecap="round"
          strokeWidth="1.8"
        />
      </svg>
    );
  }
  if (step.startedAt) {
    return (
      <span
        className="block h-5 w-5 animate-spin rounded-full border-2 border-blue-700 border-t-transparent"
        aria-label="진행중"
      />
    );
  }
  return (
    <span
      className="block h-5 w-5 rounded-full border border-neutral-300"
      aria-label="대기"
    />
  );
}

export function ProgressView({
  detail,
  onResume,
  isResuming,
  resumeError,
}: ProgressViewProps) {
  const [nowMs, setNowMs] = useState(() => Date.now());
  const stepsByName = useMemo(
    () => new Map(detail.state.steps.map((step) => [step.name, step])),
    [detail.state.steps],
  );
  const failedStep = detail.state.steps.find((step) => step.status === "error");

  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <div className="space-y-8">
      <header className="space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-3xl font-semibold tracking-tight text-neutral-900">
            {detail.state.idea}
          </h1>
          <RunStatusBadge status={detail.status} />
        </div>
        <p className="text-xs tabular-nums text-neutral-500">
          시작 {new Date(detail.state.createdAt).toLocaleString("ko-KR")}
        </p>
      </header>

      <section className="space-y-3" aria-label="진행 단계">
        {STEPS.map((stepName, index) => {
          const step = stepsByName.get(stepName) ?? {
            name: stepName,
            status: "pending" as const,
          };
          const elapsed = stepElapsed(step, nowMs);
          return (
            <Card key={stepName} className="p-5">
              <div className="grid grid-cols-[28px_1fr_auto] items-start gap-3">
                <StepIcon step={step} />
                <div className="space-y-1">
                  <h2 className="text-base font-semibold text-neutral-900">
                    {index + 1}. {STEP_LABELS[stepName]}
                  </h2>
                  <p className="text-sm text-neutral-500">{stepStateLabel(step)}</p>
                </div>
                {elapsed ? (
                  <span className="text-xs tabular-nums text-neutral-500">
                    {elapsed}
                  </span>
                ) : null}
              </div>
            </Card>
          );
        })}
      </section>

      {failedStep ? (
        <Card className="space-y-4 border-red-200 bg-red-50">
          <div>
            <h2 className="text-base font-semibold text-red-900">
              {STEP_LABELS[failedStep.name]} 단계에서 실패했습니다
            </h2>
            <p className="mt-2 text-[15px] leading-relaxed text-red-800">
              {failedStep.errorMessage ?? "구체적인 오류 메시지가 없습니다."}
            </p>
          </div>
          <Button variant="secondary" onClick={onResume} disabled={isResuming}>
            {isResuming ? "재개 중" : "이어서 실행"}
          </Button>
        </Card>
      ) : null}

      {detail.status === "stalled" ? (
        <Card className="space-y-4 bg-neutral-50">
          <div>
            <h2 className="text-base font-semibold text-neutral-900">
              실행이 중단된 것 같습니다
            </h2>
            <p className="mt-2 text-[15px] leading-relaxed text-neutral-700">
              마지막 상태 갱신 이후 시간이 지나 실행 프로세스가 멈춘 것으로 판단했습니다.
            </p>
          </div>
          <Button variant="secondary" onClick={onResume} disabled={isResuming}>
            {isResuming ? "재개 중" : "이어서 실행"}
          </Button>
        </Card>
      ) : null}

      {resumeError ? (
        <p className="text-sm text-red-700" role="alert">
          {resumeError}
        </p>
      ) : null}
    </div>
  );
}
