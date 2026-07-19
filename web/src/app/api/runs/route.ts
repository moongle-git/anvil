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

  const { mode, idea, scope } = (body ?? {}) as {
    mode?: unknown;
    idea?: unknown;
    scope?: unknown;
  };

  // 스카우트 모드는 주제를 아직 모르는 run이다. 범위 힌트(scope)는 **선택**이고, 없거나 비어도
  // 400이 아니다 — 범위 없는 전 범위 탐색이 이 기능의 기본 사용법이다. 빈 문자열을
  // "전 범위 탐색"으로 승격하는 것은 createRun이 소유한다 (SCOUT_FULL_SCOPE_IDEA — step 1).
  if (mode === "scout") {
    return start(typeof scope === "string" ? scope.trim() : "", { scout: true });
  }

  // mode가 없으면 기존 동작이다 — 기존 클라이언트 요청이 그대로 동작해야 한다
  if (typeof idea !== "string" || idea.trim() === "") {
    return Response.json(
      { error: "idea는 비어 있지 않은 문자열이어야 한다" },
      { status: 400 },
    );
  }
  return start(idea.trim(), { interview: true });
}

/**
 * ADR-007 핵심 순서: createRun으로 runId를 먼저 확보한 뒤 spawn하고 즉시 응답한다.
 *
 * 웹에서 생성한 run은 인터뷰(질문-답변)를 활성화하지만 스카우트는 예외다 — 후보 선택으로
 * 이미 한 번 멈춰 세우므로 createRun이 interviewer를 seed하지 않는다 (step 1).
 */
function start(
  initialIdea: string,
  opts: { interview?: boolean; scout?: boolean },
): Response {
  const { runId } = withRunStore((store) => store.createRun(initialIdea, opts));
  spawnConsult(runId);
  return Response.json({ runId }, { status: 201 });
}
