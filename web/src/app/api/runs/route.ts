import type { RunDisplayStatus } from "@anvil/runStore";
import { searchRuns, withRunStore } from "@/lib/server/runs";
import { spawnConsult } from "@/lib/server/spawnConsult";

const RUN_DISPLAY_STATUSES: readonly RunDisplayStatus[] = [
  "completed",
  "error",
  "waiting",
  "running",
  "stalled",
];

function isRunDisplayStatus(value: string): value is RunDisplayStatus {
  return (RUN_DISPLAY_STATUSES as readonly string[]).includes(value);
}

export function GET(request: Request): Response {
  const { searchParams } = new URL(request.url);
  const q = searchParams.get("q") ?? undefined;
  const status = searchParams.get("status");

  if (status !== null && !isRunDisplayStatus(status)) {
    return Response.json(
      { error: `알 수 없는 status 값이다: ${status}` },
      { status: 400 },
    );
  }

  return Response.json({ runs: searchRuns(q, status ?? undefined) });
}

export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "본문이 JSON이 아니다" }, { status: 400 });
  }

  const idea = (body as { idea?: unknown } | null)?.idea;
  if (typeof idea !== "string" || idea.trim() === "") {
    return Response.json(
      { error: "idea는 비어 있지 않은 문자열이어야 한다" },
      { status: 400 },
    );
  }

  // ADR-007 핵심 순서: createRun으로 runId를 먼저 확보한 뒤 spawn하고 즉시 응답한다.
  // 웹에서 생성한 run은 인터뷰(질문-답변)를 활성화한다.
  const { runId } = withRunStore((store) =>
    store.createRun(idea.trim(), { interview: true }),
  );
  spawnConsult(runId);
  return Response.json({ runId }, { status: 201 });
}
