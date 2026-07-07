"use client";

import Link from "next/link";
import { ErrorState } from "@/components/ui";
import { ReportView } from "@/components/report/ReportView";
import { ProgressView } from "./ProgressView";
import { useRunDetail } from "./useRunDetail";

// run 상세: 폴링 결과 status로 진행 뷰/리포트 뷰를 분기한다 (같은 URL, 폴링으로 자동 전환).
export function RunDetailClient({ runId }: { runId: string }) {
  const { detail, notFound, error, restart } = useRunDetail(runId);

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

  if (detail.status === "completed") {
    return <ReportView detail={detail} />;
  }

  return <ProgressView detail={detail} onResume={handleResume} />;
}
