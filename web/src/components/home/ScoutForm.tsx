"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, TextAreaField } from "@/components/ui";

interface ScoutFormProps {
  scope: string;
  onScopeChange: (value: string) => void;
}

/**
 * 주제 발굴 폼. 제출 시 POST /api/runs { mode: "scout", scope } → 진행 뷰로 이동한다.
 *
 * **범위가 비어도 제출할 수 있어야 한다.** 범위 없는 전 범위 탐색이 이 기능의 기본 사용법이고,
 * 버튼을 비활성으로 두면 기본 경로가 막힌다 — IdeaForm이 빈 입력을 막는 것과는 다른 계약이다
 * (그쪽은 검증할 아이디어가 곧 입력이지만, 여기서는 아이디어를 아직 모르는 것이 정상 상태다).
 * 빈 문자열을 "전 범위 탐색"으로 승격하는 것은 서버(createRun)가 소유한다.
 */
export function ScoutForm({ scope, onScopeChange }: ScoutFormProps) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (submitting) {
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "scout", scope: scope.trim() }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(data?.error ?? "주제 탐색 시작에 실패했습니다.");
      }
      const { runId } = (await res.json()) as { runId: string };
      // 성공 시 submitting을 유지해 이동 전 이중 제출을 막는다 (IdeaForm과 같은 규율).
      router.push(`/runs/${runId}`);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "주제 탐색 시작에 실패했습니다.",
      );
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3">
      <TextAreaField
        label="탐색 범위 (선택)"
        rows={3}
        placeholder="예: 기후 기술, 물류 자동화 — 비워두면 전 범위를 탐색합니다"
        value={scope}
        onChange={(event) => onScopeChange(event.target.value)}
      />
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={submitting}>
          {submitting ? "탐색하는 중…" : "주제 찾기"}
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
