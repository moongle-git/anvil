import type { ReactNode } from "react";
import Link from "next/link";
import {
  RECOMMENDATION_LABELS,
  type CriticismSeverity,
  type Recommendation,
} from "@anvil/types";
import type { RunDetail } from "@/lib/server/runs";
import { Badge, type BadgeTone, SeverityBadge } from "@/components/ui";
import { SurvivalGauge } from "@/components/report/SurvivalGauge";
import { formatDateTime } from "@/lib/format";
import { renderInline, renderRichText } from "@/lib/richText";
import { countSeverities } from "@/lib/severity";
import { buildRiskProfile } from "@/lib/risk";

const SEVERITY_ORDER: CriticismSeverity[] = ["fatal", "major", "minor"];

// recommendation → 뱃지 시맨틱 톤. VerdictSection과 같은 매핑을 쓰되 새 색은 만들지 않는다.
const RECOMMENDATION_TONES: Record<Recommendation, BadgeTone> = {
  proceed: "success",
  pivot: "warning",
  abandon: "danger",
};

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

// 축별 '최고' 위험도(buildRiskProfile — 평균이 아니라 최댓값). 세 축을 항상 같은 순서로 나열한다.
function RiskAxes({ detail }: { detail: RunDetail }) {
  if (!detail.criticism) {
    return <Dash />;
  }
  return (
    <ul className="flex flex-col gap-1.5">
      {buildRiskProfile(detail.criticism).map((axis) => (
        <li
          key={axis.axis}
          data-risk-axis={axis.axis}
          className="text-[15px] leading-[1.8] text-neutral-700"
        >
          <span className="font-medium text-neutral-900">{axis.label}</span>{" "}
          <span className="tabular-nums">{axis.score}/100</span>
          {axis.keyword ? (
            <span className="text-neutral-500"> · {axis.keyword}</span>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

interface CompareRow {
  key: string;
  label: string;
  // verdict.json에서만 나오는 행. 두 run 모두 verdict가 없으면 통째로 생략한다(빈 행 노이즈 제거).
  requiresVerdict?: boolean;
  render: (detail: RunDetail) => ReactNode;
}

// 행 순서는 "결론 → 근거"의 역피라미드가 아니라 '비교 효용' 순서다.
// 비교 뷰에는 ADR-008(결론 후치)이 적용되지 않는다 — 이미 두 리포트를 다 읽은 사용자가 오는 화면이라
// 생존 점수·판정을 맨 위에 두는 편이 유용하다. (리포트 뷰 ReportView는 여전히 ADR-008을 따른다.)
// 최종 판정의 유일한 출처는 verdict.json이다 — criticism.verdict(反의 소결론)를 여기 쓰지 않는다(ADR-010).
const ROWS: CompareRow[] = [
  {
    key: "survival",
    label: "생존 점수",
    requiresVerdict: true,
    render: (detail) =>
      detail.verdict ? (
        <SurvivalGauge
          score={detail.verdict.survivalScore}
          recommendation={detail.verdict.recommendation}
        />
      ) : (
        <Dash />
      ),
  },
  {
    key: "recommendation",
    label: "판정",
    requiresVerdict: true,
    render: (detail) =>
      detail.verdict ? (
        <Badge tone={RECOMMENDATION_TONES[detail.verdict.recommendation]}>
          {RECOMMENDATION_LABELS[detail.verdict.recommendation]}
        </Badge>
      ) : (
        <Dash />
      ),
  },
  {
    key: "headline",
    label: "한 줄 결론",
    requiresVerdict: true,
    render: (detail) =>
      detail.verdict ? (
        <p className="text-[15px] leading-[1.8] text-neutral-700">
          {renderInline(detail.verdict.headline)}
        </p>
      ) : (
        <Dash />
      ),
  },
  {
    key: "severity",
    label: "리스크 집계",
    render: (detail) => <SeverityCounts detail={detail} />,
  },
  {
    key: "risk",
    label: "축별 최고 위험도",
    render: (detail) => <RiskAxes detail={detail} />,
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
  const hasAnyVerdict = Boolean(a.verdict) || Boolean(b.verdict);
  // 두 run 모두 verdict가 없으면 생존 점수·판정·한 줄 결론 행은 세 칸 모두 대시라 노이즈다 — 생략한다.
  const rows = ROWS.filter((row) => !row.requiresVerdict || hasAnyVerdict);

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

      {/* 각 행: 같은 행의 두 셀이 나란히 정렬된다 */}
      {rows.map((row) => (
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
