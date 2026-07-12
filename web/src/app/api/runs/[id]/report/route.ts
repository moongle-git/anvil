import { withRunStore } from "@/lib/server/runs";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  // 경로 트래버설 방어(path.basename(id) !== id)가 사라졌다: 리포트는 더 이상 runs/{id}/report.md
  // 파일이 아니라 artifacts 행이고, id는 파일 경로가 아니라 primary key 조회값이다 (ADR-014).
  const markdown = withRunStore((store) => store.loadReport(id));
  if (markdown === null) {
    return Response.json(
      { error: `리포트를 찾을 수 없다: ${id}` },
      { status: 404 },
    );
  }

  // runId에 한글이 올 수 있어 헤더 filename에는 runId를 넣지 않는다 (ByteString 제약)
  return new Response(markdown, {
    headers: {
      "content-type": "text/markdown; charset=utf-8",
      "content-disposition": 'attachment; filename="report.md"',
    },
  });
}
