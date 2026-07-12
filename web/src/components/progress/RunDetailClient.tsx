"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { DeleteRunButton, ErrorState } from "@/components/ui";
import { ReportView } from "@/components/report/ReportView";
import { ProgressView } from "./ProgressView";
import { QuestionForm } from "./QuestionForm";
import { useRunDetail } from "./useRunDetail";

// run 상세: 폴링 결과 status로 진행 뷰/리포트 뷰를 분기한다 (같은 URL, 폴링으로 자동 전환).
export function RunDetailClient({ runId }: { runId: string }) {
  const { detail, notFound, error, restart } = useRunDetail(runId);
  const router = useRouter();
  const [deleteError, setDeleteError] = useState<string | null>(null);

  async function handleResume() {
    try {
      const res = await fetch(`/api/runs/${runId}/resume`, { method: "POST" });
      if (res.ok) {
        restart();
      }
    } catch {
      // 폴링 에러 UI가 후속 상태를 표시하므로 여기서는 조용히 무시한다
    }
  }

  async function handleDelete() {
    let res: Response;
    try {
      res = await fetch(`/api/runs/${runId}`, { method: "DELETE" });
    } catch {
      setDeleteError("삭제에 실패했습니다.");
      return;
    }
    if (!res.ok) {
      // UI는 running에서 버튼을 비활성으로 두지만 그건 2선 방어다 — API의 409를 그대로 알린다
      setDeleteError(
        res.status === 409
          ? "실행 중에는 삭제할 수 없습니다."
          : "삭제에 실패했습니다.",
      );
      return;
    }
    router.push("/");
  }

  if (notFound) {
    return (
      <div className="flex flex-col items-center gap-3 py-16 text-center">
        <h1 className="text-xl font-semibold text-neutral-900">
          run을 찾을 수 없습니다
        </h1>
        <p className="text-sm text-neutral-500">
          삭제되었거나 잘못된 주소일 수 있습니다.
        </p>
        <Link
          href="/"
          className="text-sm font-medium text-blue-700 underline-offset-4 hover:underline"
        >
          홈으로 돌아가기
        </Link>
      </div>
    );
  }

  // 최초 로딩이 실패해 아직 표시할 데이터가 없으면 에러 카드 + 다시 시도
  if (detail === null && error !== null) {
    return <ErrorState message={error} onRetry={restart} />;
  }

  if (detail === null) {
    return (
      <p className="py-16 text-center text-sm text-neutral-500">불러오는 중…</p>
    );
  }

  // 실행 중인 run은 삭제할 수 없다 — 숨기지 않고 비활성으로 둔다 (UI_GUIDE "삭제 버튼")
  const deleteControl = (
    <DeleteRunButton
      onConfirm={handleDelete}
      {...(detail.status === "running"
        ? { disabledReason: "실행 중에는 삭제할 수 없습니다" }
        : {})}
    />
  );

  return (
    <div className="flex flex-col gap-4">
      {deleteError ? (
        <p role="alert" className="text-sm text-red-600">
          {deleteError}
        </p>
      ) : null}

      {detail.status === "completed" ? (
        <ReportView detail={detail} deleteControl={deleteControl} />
      ) : detail.status === "waiting" ? (
        // 답변 대기: 인터뷰 질문 폼을 보여주고, 제출하면 폴링이 진행 뷰로 전환한다
        <QuestionForm
          runId={runId}
          questions={detail.questions?.questions ?? []}
          onSubmitted={restart}
          deleteControl={deleteControl}
        />
      ) : (
        <ProgressView
          detail={detail}
          onResume={handleResume}
          deleteControl={deleteControl}
        />
      )}
    </div>
  );
}
