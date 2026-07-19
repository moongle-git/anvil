"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  DeleteRunButton,
  ErrorState,
  RerunButton,
  RunLineage,
} from "@/components/ui";
import { ReportView } from "@/components/report/ReportView";
import { OpportunityPicker } from "./OpportunityPicker";
import { ProgressView } from "./ProgressView";
import { QuestionForm } from "./QuestionForm";
import { useRunDetail } from "./useRunDetail";

// run 상세: 폴링 결과 status로 진행 뷰/리포트 뷰를 분기한다 (같은 URL, 폴링으로 자동 전환).
export function RunDetailClient({ runId }: { runId: string }) {
  const { detail, notFound, error, restart } = useRunDetail(runId);
  const router = useRouter();
  const [actionError, setActionError] = useState<string | null>(null);

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

  // 재실행은 원본을 덮어쓰지 않고 새 run으로 포크한다 (ADR-015) — 그래서 원본에 머무르지 않고
  // 새 run의 상세(진행 뷰)로 이동한다. 원본 리포트는 그대로 남는다.
  async function handleRerun() {
    let res: Response;
    try {
      res = await fetch(`/api/runs/${runId}/rerun`, { method: "POST" });
    } catch {
      setActionError("재실행에 실패했습니다.");
      return;
    }
    if (!res.ok) {
      setActionError(
        res.status === 409
          ? "아직 결과가 없는 run은 재실행할 수 없습니다."
          : "재실행에 실패했습니다.",
      );
      return;
    }
    const { runId: newRunId } = (await res.json()) as { runId: string };
    router.push(`/runs/${newRunId}`);
  }

  async function handleDelete() {
    let res: Response;
    try {
      res = await fetch(`/api/runs/${runId}`, { method: "DELETE" });
    } catch {
      setActionError("삭제에 실패했습니다.");
      return;
    }
    if (!res.ok) {
      // UI는 running에서 버튼을 비활성으로 두지만 그건 2선 방어다 — API의 409를 그대로 알린다
      setActionError(
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

  // 원본이 삭제되면 rerun_of가 끊겨 origin이 없다 — 그때는 계보 줄 자체를 그리지 않는다 (UI_GUIDE)
  const lineage = detail.origin ? (
    <RunLineage
      runId={detail.state.runId}
      status={detail.status}
      origin={detail.origin}
    />
  ) : undefined;

  return (
    <div className="flex flex-col gap-4">
      {actionError ? (
        <p role="alert" className="text-sm text-red-600">
          {actionError}
        </p>
      ) : null}

      {detail.status === "completed" ? (
        // 재실행은 완료된 run에서만 뜬다 — resume(error·stalled)과 한 화면에 같이 놓이지 않는다
        <ReportView
          detail={detail}
          lineage={lineage}
          rerunControl={<RerunButton onRerun={handleRerun} />}
          deleteControl={deleteControl}
        />
      ) : detail.status === "waiting" && detail.opportunities !== undefined ? (
        // 후보 선택 대기: 스카우트 run은 인터뷰를 돌지 않으므로(두 번 멈춰 세우지 않는다)
        // waiting의 의미가 인터뷰 run과 다르다. 판별은 상태가 아니라 실린 아티팩트로 한다 —
        // 후보 목록이 없으면 그릴 것도 없다.
        <OpportunityPicker
          runId={runId}
          opportunities={detail.opportunities}
          onSubmitted={restart}
          lineage={lineage}
          deleteControl={deleteControl}
        />
      ) : detail.status === "waiting" ? (
        // 답변 대기: 인터뷰 질문 폼을 보여주고, 제출하면 폴링이 진행 뷰로 전환한다
        <QuestionForm
          runId={runId}
          questions={detail.questions?.questions ?? []}
          onSubmitted={restart}
          lineage={lineage}
          deleteControl={deleteControl}
        />
      ) : (
        <ProgressView
          detail={detail}
          onResume={handleResume}
          lineage={lineage}
          deleteControl={deleteControl}
        />
      )}
    </div>
  );
}
