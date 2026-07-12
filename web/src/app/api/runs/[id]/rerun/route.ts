import { getRunDetail, withRunStore } from "@/lib/server/runs";
import { spawnConsult } from "@/lib/server/spawnConsult";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  const detail = getRunDetail(id);
  if (detail === null) {
    return Response.json({ error: `run을 찾을 수 없다: ${id}` }, { status: 404 });
  }

  // running: 아직 살아 있는 CLI가 원본을 쓰는 중이고 결과도 없다.
  // waiting: 인터뷰 답변을 기다리는 중이라 포크가 복사할 답변 자체가 없다.
  // error·stalled는 포크할 수 있다 — 중간 산출물을 버리고 자료조사부터 다시 도는 것이 rerun이다.
  if (detail.status === "running" || detail.status === "waiting") {
    return Response.json(
      { error: `${detail.status} 상태의 run은 재실행할 수 없다` },
      { status: 409 },
    );
  }

  // ADR-007의 순서를 그대로 따른다: 포크를 DB에 먼저 쓴 뒤 spawn한다.
  // spawn된 CLI가 --resume {newRunId}로 이 run을 읽으므로, 뒤집으면 없는 run을 찾는다.
  // 원본은 건드리지 않는다 — 재실행은 덮어쓰기가 아니라 포크다 (ADR-015).
  const { runId } = withRunStore((store) => store.createRerun(id));
  spawnConsult(runId);
  return Response.json({ runId }, { status: 201 });
}
