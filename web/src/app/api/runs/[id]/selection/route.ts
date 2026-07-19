import { OpportunitySelectionSchema } from "@anvil/types";
import { getRunDetail, withRunStore } from "@/lib/server/runs";
import { spawnConsult } from "@/lib/server/spawnConsult";

// 후보 선택 제출 → artifacts(kind='selection') 기록 후 CLI를 resume spawn한다 (ADR-007).
// answers 라우트와 형태가 같다 — 둘 다 사람의 아티팩트를 받아 waiting을 푸는 일이다.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "본문이 JSON이 아니다" }, { status: 400 });
  }

  const parsed = OpportunitySelectionSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "selection 형식이 올바르지 않다" },
      { status: 400 },
    );
  }

  const { id } = await params;
  const detail = getRunDetail(id);
  if (detail === null) {
    return Response.json({ error: `run을 찾을 수 없다: ${id}` }, { status: 404 });
  }

  // 후보 선택 대기(waiting) 상태의 run만 선택을 받아 재개할 수 있다
  if (detail.status !== "waiting") {
    return Response.json(
      { error: `${detail.status} 상태의 run에는 선택을 제출할 수 없다` },
      { status: 409 },
    );
  }

  // 없는 후보를 저장하면 orchestrator가 error로 죽는데(step 4), 그 실패는 CLI 프로세스 안에서
  // 일어나고 spawnConsult가 stdio: "ignore"라 사용자에게 아무 메시지도 도달하지 않는다.
  // run이 조용히 죽는 것을 막으려면 API가 동기적으로 거절해야 한다 (ADR-018이 기록한 같은 함정).
  const known = detail.opportunities?.candidates.some(
    (candidate) => candidate.id === parsed.data.candidateId,
  );
  if (known !== true) {
    return Response.json(
      { error: `후보를 찾을 수 없다: ${parsed.data.candidateId}` },
      { status: 400 },
    );
  }

  withRunStore((store) => store.saveOpportunitySelection(id, parsed.data));
  spawnConsult(id);
  return Response.json({ runId: id }, { status: 202 });
}
