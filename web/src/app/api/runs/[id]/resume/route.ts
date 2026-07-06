import { getRunDetail } from "@/lib/server/runs";
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

  // 실행이 살아 있거나 이미 끝난 run의 재실행은 거부한다 (error/stalled만 resume)
  if (detail.status !== "error" && detail.status !== "stalled") {
    return Response.json(
      { error: `${detail.status} 상태의 run은 resume할 수 없다` },
      { status: 409 },
    );
  }

  spawnConsult(id);
  return Response.json({ runId: id }, { status: 202 });
}
