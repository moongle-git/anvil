import { getRunDetail, withRunStore } from "@/lib/server/runs";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  const detail = getRunDetail(id);
  if (detail === null) {
    return Response.json({ error: `run을 찾을 수 없다: ${id}` }, { status: 404 });
  }
  return Response.json(detail);
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  const detail = getRunDetail(id);
  if (detail === null) {
    return Response.json({ error: `run을 찾을 수 없다: ${id}` }, { status: 404 });
  }

  // running만 막는다: detached CLI 프로세스가 아직 살아서 쓰고 있다 (ADR-015).
  // waiting은 프로세스가 정상 종료해 살아 있는 writer가 없고, stalled의 좀비는 UPDATE-only
  // saveRun이 깨끗하게 실패시키므로 둘 다 삭제할 수 있다.
  if (detail.status === "running") {
    return Response.json(
      { error: "실행 중인 run은 삭제할 수 없다" },
      { status: 409 },
    );
  }

  // steps·artifacts는 FK CASCADE로 함께 지워진다 (ADR-014 PRAGMA foreign_keys=ON)
  withRunStore((store) => store.deleteRun(id));
  return new Response(null, { status: 204 });
}
