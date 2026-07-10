import { InterviewAnswersSchema } from "@anvil/types";
import { getRunDetail, getRunStore } from "@/lib/server/runs";
import { spawnConsult } from "@/lib/server/spawnConsult";

// 인터뷰 답변 제출 → answers.json 기록 후 CLI를 resume spawn한다 (ADR-007, 파일 기반 재개).
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

  const parsed = InterviewAnswersSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "answers 형식이 올바르지 않다" },
      { status: 400 },
    );
  }

  const { id } = await params;
  const detail = getRunDetail(id);
  if (detail === null) {
    return Response.json({ error: `run을 찾을 수 없다: ${id}` }, { status: 404 });
  }

  // 답변 대기(waiting) 상태의 run만 답변을 받아 재개할 수 있다
  if (detail.status !== "waiting") {
    return Response.json(
      { error: `${detail.status} 상태의 run에는 답변을 제출할 수 없다` },
      { status: 409 },
    );
  }

  getRunStore().saveInterviewAnswers(id, parsed.data);
  spawnConsult(id);
  return Response.json({ runId: id }, { status: 202 });
}
