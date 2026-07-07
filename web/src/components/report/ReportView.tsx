import type { RunDetail } from "@/lib/server/runs";

interface ReportViewProps {
  detail: RunDetail;
}

// PLACEHOLDER — step 6~7이 실제 리포트(시장 맥락/비판/솔루션 렌더링)로 교체한다.
// 지금은 제목 + "리포트 준비 완료" + report.md 다운로드 링크만 제공한다.
export function ReportView({ detail }: ReportViewProps) {
  const { state, hasReport } = detail;
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-3xl font-semibold tracking-tight text-neutral-900">
        {state.idea}
      </h1>
      <p className="text-[15px] leading-relaxed text-neutral-700">
        리포트 준비 완료
      </p>
      {hasReport ? (
        <div>
          <a
            href={`/api/runs/${state.runId}/report`}
            className="text-sm font-medium text-blue-700 underline-offset-4 hover:underline"
          >
            report.md 다운로드
          </a>
        </div>
      ) : null}
    </div>
  );
}
