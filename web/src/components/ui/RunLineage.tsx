import Link from "next/link";
import type { RunDisplayStatus } from "@anvil/runStore";
import type { RunOrigin } from "@/lib/server/runs";

interface RunLineageProps {
  /** 이번(포크된) run */
  runId: string;
  status: RunDisplayStatus;
  origin: RunOrigin;
}

/**
 * 계보 표시 (UI_GUIDE "계보 표시").
 *
 * 상단 배너가 아니라 상세 헤더의 메타 줄이다 — 계보는 요약이 아니라 메타데이터다
 * (리포트 상단 배너 금지: 원칙 2, ADR-008).
 * 원본이 삭제되면 rerun_of가 끊겨(ON DELETE SET NULL) origin이 없고, 호출부가 이 줄을 그리지 않는다.
 */
export function RunLineage({ runId, status, origin }: RunLineageProps) {
  // 같은 입력으로 두 번 돌렸을 때 결론이 얼마나 흔들리는지가 이 도구의 신뢰도다 (ADR-015).
  // 단 미완료 run이 섞이면 비교 뷰가 차단되므로 죽은 링크가 된다 — 둘 다 완료일 때만 건다.
  const comparable = status === "completed" && origin.status === "completed";

  return (
    <p data-run-lineage={origin.runId} className="text-xs text-neutral-500">
      재실행 — 원본:{" "}
      <Link
        href={`/runs/${origin.runId}`}
        className="text-blue-700 underline-offset-4 hover:underline"
      >
        {origin.idea}
      </Link>
      {comparable ? (
        <>
          {" · "}
          <Link
            href={`/compare?a=${origin.runId}&b=${runId}`}
            className="font-medium underline-offset-4 hover:text-neutral-900 hover:underline"
          >
            비교하기
          </Link>
        </>
      ) : null}
    </p>
  );
}
