"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, TextAreaField } from "@/components/ui";

interface IdeaFormProps {
  idea: string;
  onIdeaChange: (value: string) => void;
}

// 아이디어 입력 폼. 제출 시 POST /api/runs → 응답 runId로 진행 뷰로 이동한다.
// 데이터 접근은 API route로만 (서버 컴포넌트에서 RunStore 직접 호출 금지).
export function IdeaForm({ idea, onIdeaChange }: IdeaFormProps) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const trimmed = idea.trim();
  const canSubmit = trimmed !== "" && !submitting;

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!canSubmit) {
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idea: trimmed }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(data?.error ?? "컨설팅 시작에 실패했습니다.");
      }
      const { runId } = (await res.json()) as { runId: string };
      // 성공 시 submitting을 유지해 이동 전 이중 제출을 막는다.
      router.push(`/runs/${runId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "컨설팅 시작에 실패했습니다.");
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3">
      <TextAreaField
        label="검증할 아이디어"
        rows={4}
        placeholder="예: 회의 녹음을 자동으로 요약하고 할 일을 뽑아주는 서비스"
        value={idea}
        onChange={(event) => onIdeaChange(event.target.value)}
      />
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={!canSubmit}>
          {submitting ? "시작하는 중…" : "컨설팅 시작"}
        </Button>
        {error ? (
          <p role="alert" className="text-sm text-red-600">
            {error}
          </p>
        ) : null}
      </div>
    </form>
  );
}
