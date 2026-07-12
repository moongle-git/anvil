"use client";

import { useState, type ReactNode } from "react";
import type { InterviewQuestion } from "@anvil/types";
import { Button, Card, TextAreaField } from "@/components/ui";

interface QuestionFormProps {
  runId: string;
  questions: InterviewQuestion[];
  onSubmitted?: () => void;
  /** 상세 헤더 메타 줄에 놓이는 계보 (RunDetailClient가 소유한다) */
  lineage?: ReactNode;
  /** 상세 헤더에 놓이는 삭제 컨트롤 (RunDetailClient가 소유한다) */
  deleteControl?: ReactNode;
}

interface InterviewAnswerInput {
  questionId: string;
  answer: string;
}

// 인터뷰 답변 폼. 제출 시 POST /api/runs/{id}/answers → answers.json 기록 후 파이프라인 재개.
// 폴링(useRunDetail)이 waiting→running 전이를 잡아 진행 뷰로 자동 전환한다.
export function QuestionForm({
  runId,
  questions,
  onSubmitted,
  lineage,
  deleteControl,
}: QuestionFormProps) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(answers: InterviewAnswerInput[]) {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/runs/${runId}/answers`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ answers }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(data?.error ?? "답변 제출에 실패했습니다.");
      }
      setSubmitted(true);
      onSubmitted?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "답변 제출에 실패했습니다.");
      setSubmitting(false);
    }
  }

  function collect(all: boolean): InterviewAnswerInput[] {
    return questions.map((q) => ({
      questionId: q.id,
      answer: all ? "" : (values[q.id] ?? "").trim(),
    }));
  }

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (submitting || submitted) return;
    void submit(collect(false));
  }

  function handleSkip() {
    if (submitting || submitted) return;
    void submit(collect(true));
  }

  if (submitted) {
    return (
      <Card className="border-amber-200 bg-amber-50">
        <p className="text-[15px] leading-[1.8] text-neutral-700">
          답변을 제출했습니다. 분석을 재개합니다…
        </p>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <header className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-2">
          <h1 className="text-2xl font-semibold tracking-tight text-neutral-900">
            몇 가지만 확인할게요
          </h1>
          <p className="text-sm leading-relaxed text-neutral-500">
            아이디어를 더 정확히 검증하기 위한 질문입니다. 답변은 건너뛸 수 있어요.
          </p>
          {lineage}
        </div>
        {deleteControl}
      </header>

      <form onSubmit={handleSubmit} className="flex flex-col gap-5">
        {questions.map((q, index) => (
          <div key={q.id} className="flex flex-col gap-2">
            <TextAreaField
              label={`${index + 1}. ${q.question}`}
              rows={3}
              value={values[q.id] ?? ""}
              onChange={(event) =>
                setValues((prev) => ({ ...prev, [q.id]: event.target.value }))
              }
            />
            {q.why ? (
              <p className="text-xs text-neutral-400">왜 묻나요? {q.why}</p>
            ) : null}
          </div>
        ))}

        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" disabled={submitting}>
            {submitting ? "제출하는 중…" : "답변 제출하고 분석 계속"}
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={handleSkip}
            disabled={submitting}
          >
            건너뛰고 진행
          </Button>
          {error ? (
            <p role="alert" className="text-sm text-red-600">
              {error}
            </p>
          ) : null}
        </div>
      </form>
    </div>
  );
}
