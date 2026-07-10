import { getRunDetail } from "@/lib/server/runs";

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
