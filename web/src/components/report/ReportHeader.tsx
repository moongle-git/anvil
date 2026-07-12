import type { ReactNode } from "react";
import { formatDateTime } from "@/lib/format";

interface ReportHeaderProps {
  runId: string;
  idea: string;
  createdAt: string;
  hasReport: boolean;
  /** 삭제 진입 + 인라인 확인 (RunDetailClient가 소유한다) */
  deleteControl?: ReactNode;
}

// 다운로드는 파일 응답이라 <button>이 아닌 <a>로 두되 Secondary 버튼 스타일을 재사용한다.
const DOWNLOAD_CLASS =
  "inline-flex shrink-0 items-center rounded-md border border-neutral-300 bg-white px-4 py-2 text-sm font-medium text-neutral-700 transition-colors hover:bg-neutral-50";

export function ReportHeader({
  runId,
  idea,
  createdAt,
  hasReport,
  deleteControl,
}: ReportHeaderProps) {
  return (
    <header className="flex items-start justify-between gap-4 border-b border-neutral-200 pb-6">
      <div className="flex min-w-0 flex-col gap-1">
        <h1 className="text-3xl font-semibold tracking-tight text-neutral-900">
          {idea}
        </h1>
        <p className="text-xs tabular-nums text-neutral-500">
          {formatDateTime(createdAt)}
        </p>
      </div>
      <div className="flex flex-wrap items-center justify-end gap-3">
        {hasReport ? (
          <a href={`/api/runs/${runId}/report`} className={DOWNLOAD_CLASS}>
            report.md 다운로드
          </a>
        ) : null}
        {deleteControl}
      </div>
    </header>
  );
}
