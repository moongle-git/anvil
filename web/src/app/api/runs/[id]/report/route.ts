import fs from "node:fs";
import path from "node:path";
import { getRunsDir } from "@/lib/server/runs";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  const reportPath = path.join(getRunsDir(), id, "report.md");
  // runId에 경로 구분자가 섞인 요청은 runs/ 밖을 가리킬 수 있으므로 거부한다
  if (path.basename(id) !== id || !fs.existsSync(reportPath)) {
    return Response.json(
      { error: `report.md를 찾을 수 없다: ${id}` },
      { status: 404 },
    );
  }

  // runId에 한글이 올 수 있어 헤더 filename에는 runId를 넣지 않는다 (ByteString 제약)
  return new Response(fs.readFileSync(reportPath, "utf-8"), {
    headers: {
      "content-type": "text/markdown; charset=utf-8",
      "content-disposition": 'attachment; filename="report.md"',
    },
  });
}
