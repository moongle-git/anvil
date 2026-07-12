// @vitest-environment node
import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as getRuns, POST as postRun } from "@/app/api/runs/route";
import {
  DELETE as deleteRunById,
  GET as getRunById,
} from "@/app/api/runs/[id]/route";
import { POST as postAnswers } from "@/app/api/runs/[id]/answers/route";
import { GET as getReport } from "@/app/api/runs/[id]/report/route";
import { POST as postResume } from "@/app/api/runs/[id]/resume/route";
import { withRunStore } from "@/lib/server/runs";
import { spawnConsult } from "@/lib/server/spawnConsult";
import {
  ALL_RUN_IDS,
  COMPLETED_RUN_ID,
  ERROR_RUN_ID,
  FIXTURES_DIR,
  RUNNING_RUN_ID,
  WAITING_RUN_ID,
  cleanupTempDb,
  countRunRows,
  makeTempDb,
  seedFixtureRun,
  touchUpdatedAt,
} from "@/test/fixtures";

// 실제 child process spawn 금지 — 모듈 mock으로 대체한다
vi.mock("@/lib/server/spawnConsult", () => ({
  spawnConsult: vi.fn(),
}));

// STALLED_THRESHOLD_MS(15분)를 넘겨야 stalled로 파생된다 (ADR-012)
const SIXTEEN_MINUTES_MS = 16 * 60 * 1000;

function params(id: string): { params: Promise<{ id: string }> } {
  return { params: Promise.resolve({ id }) };
}

let dbPath: string;

beforeEach(() => {
  dbPath = makeTempDb();
});

afterEach(() => {
  cleanupTempDb(dbPath);
  vi.clearAllMocks();
});

describe("GET /api/runs", () => {
  it("전체 run 목록을 { runs }로 반환한다", async () => {
    for (const runId of ALL_RUN_IDS) {
      seedFixtureRun(runId);
    }

    const res = getRuns(new Request("http://localhost/api/runs"));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.runs.map((r: { runId: string }) => r.runId)).toEqual([
      ERROR_RUN_ID,
      RUNNING_RUN_ID,
      COMPLETED_RUN_ID,
    ]);
  });

  it("q·status 쿼리로 필터한다", async () => {
    for (const runId of ALL_RUN_IDS) {
      seedFixtureRun(runId);
    }

    const res = getRuns(
      new Request("http://localhost/api/runs?q=%EC%B6%94%EC%B2%9C&status=error"),
    );

    const body = await res.json();
    expect(body.runs.map((r: { runId: string }) => r.runId)).toEqual([
      ERROR_RUN_ID,
    ]);
  });

  it("알 수 없는 status 값은 400이다", () => {
    const res = getRuns(new Request("http://localhost/api/runs?status=bogus"));

    expect(res.status).toBe(400);
  });
});

describe("POST /api/runs", () => {
  function post(body: unknown): Promise<Response> {
    return postRun(
      new Request("http://localhost/api/runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
    );
  }

  it("createRun 후 spawnConsult 순서로 실행하고 201 { runId }를 응답한다", async () => {
    let runExistedWhenSpawned = false;
    vi.mocked(spawnConsult).mockImplementation((runId: string) => {
      runExistedWhenSpawned = withRunStore(
        (store) => store.loadRunRecord(runId) !== null,
      );
    });

    const res = await post({ idea: "AI 이력서 첨삭 서비스" });

    expect(res.status).toBe(201);
    const { runId } = await res.json();
    expect(runId).toBeTruthy();
    // ADR-007 핵심 순서: runId 선생성(DB에 run 행이 이미 있다) 후 spawn
    expect(spawnConsult).toHaveBeenCalledExactlyOnceWith(runId);
    expect(runExistedWhenSpawned).toBe(true);

    const stored = withRunStore((store) => store.loadRun(runId));
    expect(stored.idea).toBe("AI 이력서 첨삭 서비스");
    // 웹 생성 run은 인터뷰가 활성화된다
    expect(stored.interview).toBe(true);
    expect(stored.steps[0]?.name).toBe("interviewer");
  });

  it("idea가 공백뿐이면 400이고 spawn하지 않는다", async () => {
    const res = await post({ idea: "   " });

    expect(res.status).toBe(400);
    expect(spawnConsult).not.toHaveBeenCalled();
    expect(withRunStore((store) => store.listRuns())).toEqual([]);
  });

  it("idea가 문자열이 아니면 400", async () => {
    expect((await post({ idea: 42 })).status).toBe(400);
    expect((await post({})).status).toBe(400);
    expect(spawnConsult).not.toHaveBeenCalled();
  });

  it("본문이 JSON이 아니면 400", async () => {
    const res = await postRun(
      new Request("http://localhost/api/runs", { method: "POST", body: "oops" }),
    );

    expect(res.status).toBe(400);
    expect(spawnConsult).not.toHaveBeenCalled();
  });
});

describe("GET /api/runs/[id]", () => {
  it("RunDetail을 반환한다", async () => {
    seedFixtureRun(COMPLETED_RUN_ID);

    const res = await getRunById(
      new Request(`http://localhost/api/runs/${COMPLETED_RUN_ID}`),
      params(COMPLETED_RUN_ID),
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.state.runId).toBe(COMPLETED_RUN_ID);
    expect(body.status).toBe("completed");
    expect(body.hasReport).toBe(true);
    expect(body.context.competitors.length).toBeGreaterThanOrEqual(10);
  });

  it("없는 run은 404", async () => {
    const res = await getRunById(
      new Request("http://localhost/api/runs/nope"),
      params("nope"),
    );

    expect(res.status).toBe(404);
  });
});

describe("DELETE /api/runs/[id]", () => {
  function del(id: string): Promise<Response> {
    return deleteRunById(
      new Request(`http://localhost/api/runs/${id}`, { method: "DELETE" }),
      params(id),
    );
  }

  it("completed run을 지우면 204이고 steps·artifacts까지 CASCADE로 사라진다", async () => {
    seedFixtureRun(COMPLETED_RUN_ID);
    expect(countRunRows(COMPLETED_RUN_ID).artifacts).toBeGreaterThan(0);

    const res = await del(COMPLETED_RUN_ID);

    expect(res.status).toBe(204);
    expect(countRunRows(COMPLETED_RUN_ID)).toEqual({
      runs: 0,
      steps: 0,
      artifacts: 0,
    });
    expect(withRunStore((store) => store.loadRunRecord(COMPLETED_RUN_ID))).toBe(
      null,
    );
  });

  it("error run도 지울 수 있다", async () => {
    seedFixtureRun(ERROR_RUN_ID);

    expect((await del(ERROR_RUN_ID)).status).toBe(204);
    expect(countRunRows(ERROR_RUN_ID).runs).toBe(0);
  });

  it("waiting run도 지울 수 있다 (프로세스가 정상 종료해 살아 있는 writer가 없다)", async () => {
    seedFixtureRun(WAITING_RUN_ID);

    expect((await del(WAITING_RUN_ID)).status).toBe(204);
    expect(countRunRows(WAITING_RUN_ID).runs).toBe(0);
  });

  it("stalled run도 지울 수 있다 (좀비의 쓰기는 UPDATE-only saveRun이 막는다)", async () => {
    seedFixtureRun(RUNNING_RUN_ID);
    touchUpdatedAt(
      RUNNING_RUN_ID,
      new Date(Date.now() - SIXTEEN_MINUTES_MS).toISOString(),
    );

    expect((await del(RUNNING_RUN_ID)).status).toBe(204);
    expect(countRunRows(RUNNING_RUN_ID).runs).toBe(0);
  });

  it("running run은 409이고 DB에 그대로 남는다", async () => {
    seedFixtureRun(RUNNING_RUN_ID);
    const before = countRunRows(RUNNING_RUN_ID);

    const res = await del(RUNNING_RUN_ID);

    expect(res.status).toBe(409);
    expect((await res.json()).error).toBeTruthy();
    expect(countRunRows(RUNNING_RUN_ID)).toEqual(before);
  });

  it("없는 run은 404", async () => {
    const res = await del("nope");

    expect(res.status).toBe(404);
  });
});

describe("GET /api/runs/[id]/report", () => {
  it("리포트 원문을 다운로드 헤더와 함께 반환한다", async () => {
    seedFixtureRun(COMPLETED_RUN_ID);

    const res = await getReport(
      new Request(`http://localhost/api/runs/${COMPLETED_RUN_ID}/report`),
      params(COMPLETED_RUN_ID),
    );

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/markdown; charset=utf-8");
    expect(res.headers.get("content-disposition")).toContain("attachment");
    // DB에 든 바이트가 원본 report.md와 한 글자도 다르지 않아야 한다
    const expected = fs.readFileSync(
      path.join(FIXTURES_DIR, COMPLETED_RUN_ID, "report.md"),
      "utf-8",
    );
    expect(await res.text()).toBe(expected);
  });

  it("리포트가 없는 run은 404", async () => {
    seedFixtureRun(RUNNING_RUN_ID);

    const res = await getReport(
      new Request(`http://localhost/api/runs/${RUNNING_RUN_ID}/report`),
      params(RUNNING_RUN_ID),
    );

    expect(res.status).toBe(404);
  });

  it("없는 run은 404", async () => {
    const res = await getReport(
      new Request("http://localhost/api/runs/nope/report"),
      params("nope"),
    );

    expect(res.status).toBe(404);
  });
});

describe("POST /api/runs/[id]/resume", () => {
  function resume(id: string): Promise<Response> {
    return postResume(
      new Request(`http://localhost/api/runs/${id}/resume`, { method: "POST" }),
      params(id),
    );
  }

  it("없는 run은 404이고 spawn하지 않는다", async () => {
    const res = await resume("nope");

    expect(res.status).toBe(404);
    expect(spawnConsult).not.toHaveBeenCalled();
  });

  it("error run은 spawn 후 202", async () => {
    seedFixtureRun(ERROR_RUN_ID);

    const res = await resume(ERROR_RUN_ID);

    expect(res.status).toBe(202);
    expect(spawnConsult).toHaveBeenCalledExactlyOnceWith(ERROR_RUN_ID);
  });

  it("stalled run은 spawn 후 202", async () => {
    seedFixtureRun(RUNNING_RUN_ID);
    touchUpdatedAt(
      RUNNING_RUN_ID,
      new Date(Date.now() - SIXTEEN_MINUTES_MS).toISOString(),
    );

    const res = await resume(RUNNING_RUN_ID);

    expect(res.status).toBe(202);
    expect(spawnConsult).toHaveBeenCalledExactlyOnceWith(RUNNING_RUN_ID);
  });

  it("running run은 409이고 spawn하지 않는다", async () => {
    seedFixtureRun(RUNNING_RUN_ID);

    const res = await resume(RUNNING_RUN_ID);

    expect(res.status).toBe(409);
    expect(spawnConsult).not.toHaveBeenCalled();
  });

  it("completed run은 409이고 spawn하지 않는다", async () => {
    seedFixtureRun(COMPLETED_RUN_ID);

    const res = await resume(COMPLETED_RUN_ID);

    expect(res.status).toBe(409);
    expect(spawnConsult).not.toHaveBeenCalled();
  });
});

describe("POST /api/runs/[id]/answers", () => {
  const validBody = { answers: [{ questionId: "q1", answer: "초보 식집사" }] };

  function answers(id: string, body: unknown): Promise<Response> {
    return postAnswers(
      new Request(`http://localhost/api/runs/${id}/answers`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
      params(id),
    );
  }

  it("waiting run은 답변을 기록하고 spawn 후 202", async () => {
    seedFixtureRun(WAITING_RUN_ID);

    const res = await answers(WAITING_RUN_ID, validBody);

    expect(res.status).toBe(202);
    expect(spawnConsult).toHaveBeenCalledExactlyOnceWith(WAITING_RUN_ID);
    const stored = withRunStore((store) =>
      store.loadInterviewAnswers(WAITING_RUN_ID),
    );
    expect(stored).toEqual(validBody);
  });

  it("빈 답변(전체 스킵)도 202로 재개한다", async () => {
    seedFixtureRun(WAITING_RUN_ID);

    const res = await answers(WAITING_RUN_ID, { answers: [] });

    expect(res.status).toBe(202);
    expect(spawnConsult).toHaveBeenCalledExactlyOnceWith(WAITING_RUN_ID);
  });

  it("없는 run은 404이고 spawn하지 않는다", async () => {
    const res = await answers("nope", validBody);

    expect(res.status).toBe(404);
    expect(spawnConsult).not.toHaveBeenCalled();
  });

  it("waiting이 아닌 run은 409이고 spawn하지 않는다", async () => {
    seedFixtureRun(COMPLETED_RUN_ID);

    const res = await answers(COMPLETED_RUN_ID, validBody);

    expect(res.status).toBe(409);
    expect(spawnConsult).not.toHaveBeenCalled();
  });

  it("answers 형식이 잘못되면 400이고 spawn하지 않는다", async () => {
    const res = await answers(WAITING_RUN_ID, { answers: [{ answer: "no id" }] });

    expect(res.status).toBe(400);
    expect(spawnConsult).not.toHaveBeenCalled();
  });

  it("본문이 JSON이 아니면 400", async () => {
    const res = await postAnswers(
      new Request(`http://localhost/api/runs/${WAITING_RUN_ID}/answers`, {
        method: "POST",
        body: "oops",
      }),
      params(WAITING_RUN_ID),
    );

    expect(res.status).toBe(400);
    expect(spawnConsult).not.toHaveBeenCalled();
  });
});
