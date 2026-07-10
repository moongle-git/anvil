import type { ReactNode } from "react";
import Link from "next/link";
import type { CriticismSeverity } from "@anvil/types";
import type { RunDetail } from "@/lib/server/runs";
import { SeverityBadge } from "@/components/ui";
import { formatDateTime } from "@/lib/format";
import { renderRichText } from "@/lib/richText";
import { countSeverities } from "@/lib/severity";

const SEVERITY_ORDER: CriticismSeverity[] = ["fatal", "major", "minor"];

function Dash() {
  return <span className="text-sm text-neutral-400">—</span>;
}

function SeverityCounts({ detail }: { detail: RunDetail }) {
  if (!detail.criticism) {
    return <Dash />;
  }
  const counts = countSeverities(detail.criticism);
  return (
    <div className="flex flex-wrap gap-3">
      {SEVERITY_ORDER.map((severity) => (
        <span key={severity} className="inline-flex items-center gap-1.5">
          <SeverityBadge severity={severity} />
          <span className="text-sm font-semibold tabular-nums text-neutral-900">
            {counts[severity]}
          </span>
        </span>
      ))}
    </div>
  );
}

// 행 순서 고정 (PRD 비교 뷰 스펙). 실행 정보는 컬럼 헤더로 별도 렌더.
const ROWS: { key: string; label: string; render: (detail: RunDetail) => ReactNode }[] =
  [
    {
      key: "severity",
      label: "severity 집계",
      render: (detail) => <SeverityCounts detail={detail} />,
    },
    {
      key: "verdict",
      label: "최종 판정",
      render: (detail) =>
        detail.criticism ? renderRichText(detail.criticism.verdict) : <Dash />,
    },
    {
      key: "concept",
      label: "재설계된 컨셉",
      render: (detail) =>
        detail.solution ? (
          renderRichText(detail.solution.revisedConcept)
        ) : (
          <Dash />
        ),
    },
    {
      key: "monetization",
      label: "비즈니스 모델",
      render: (detail) =>
        detail.solution ? renderRichText(detail.solution.monetization) : <Dash />,
    },
  ];

export function CompareMatrix({ a, b }: { a: RunDetail; b: RunDetail }) {
  const runs = [a, b];
  return (
    <div className="flex flex-col gap-8">
      <h1 className="text-3xl font-semibold tracking-tight text-neutral-900">
        컨설팅 비교
      </h1>

      {/* 실행 정보 = 컬럼 헤더 (행 1) */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {runs.map((run, index) => (
          <div
            key={index}
            className="flex flex-col gap-1 border-t-2 border-neutral-900 pt-3"
          >
            <Link
              href={`/runs/${run.state.runId}`}
              className="text-base font-semibold text-neutral-900 underline-offset-4 hover:underline"
            >
              {run.state.idea}
            </Link>
            <span className="text-xs tabular-nums text-neutral-500">
              {formatDateTime(run.state.createdAt)}
            </span>
          </div>
        ))}
      </div>

      {/* 행 2~5: 같은 행의 두 셀이 나란히 정렬된다 */}
      {ROWS.map((row) => (
        <div key={row.key} className="flex flex-col gap-3">
          <h3 className="text-sm font-medium text-neutral-500">{row.label}</h3>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {runs.map((run, index) => (
              <div key={index} className="min-w-0">
                {/* 모바일에서 어느 run인지 식별 (데스크톱은 컬럼 헤더로 충분) */}
                <p className="mb-1 truncate text-xs text-neutral-400 sm:hidden">
                  {run.state.idea}
                </p>
                {row.render(run)}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
