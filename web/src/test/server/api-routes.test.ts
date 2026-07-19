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
import { POST as postRerun } from "@/app/api/runs/[id]/rerun/route";
import { POST as postResume } from "@/app/api/runs/[id]/resume/route";
import { POST as postSelection } from "@/app/api/runs/[id]/selection/route";
import { MarketContextSchema, type Opportunities } from "@anvil/types";
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

const SCOUT_OPPORTUNITIES: Opportunities = {
  scope: "기후 기술",
  searchedAt: "2026-07-19T00:00:00.000Z",
  candidates: [
    {
      id: "O1",
      title: "산업용 폐열 회수 최적화 에이전트",
      whatItIs: "공장 폐열 데이터를 읽어 회수 설비 운전을 자동 조정한다.",
      whyNow: "규제 시행일이 확정되면서 설비 투자가 앞당겨졌다.",
      whoPays: "중견 제조사의 설비 운영팀",
      horizon: "mid",
      signals: [
        {
          signalType: "funding",
          statement: "폐열 회수 스타트업이 시리즈B로 $42M을 조달했다.",
          observedAt: "2026-05-02",
          citation: { uri: "https://example.com/funding", kind: "origin" },
          figures: [],
        },
        {
          signalType: "regulation",
          statement: "배출 규제가 2027년부터 시행된다.",
          observedAt: "2026-04-11",
          effectiveAt: "2027-01-01",
          citation: { uri: "https://example.com/reg", kind: "redirect" },
          figures: [],
        },
      ],
      counterSignal: {
        signalType: "incumbent",
        statement: "대형 설비사가 같은 기능을 번들로 무상 제공한다고 밝혔다.",
        observedAt: "2026-06-01",
        citation: { uri: "https://example.com/incumbent", kind: "origin" },
        figures: [],
      },
    },
  ],
};

/**
 * 후보 선택을 기다리는 스카우트 run을 만든다 — step 4가 pause시킨 상태의 재현이다.
 * 파일 fixture가 아니라 RunStore로 직접 만드는 이유: 스카우트는 파일 저장 시대 이후의 기능이라
 * 이송기(migrateRuns)가 옮길 원본이 애초에 없다.
 */
function seedScoutWaitingRun(scope = ""): string {
  return withRunStore((store) => {
    const { runId } = store.createRun(scope, { scout: true });
    store.saveOpportunities(runId, SCOUT_OPPORTUNITIES);
    const state = store.loadRun(runId);
    store.saveRun({
      ...state,
      steps: state.steps.map((step) =>
        step.name === "trend-scout"
          ? { ...step, status: "waiting" as const }
          : step,
      ),
    });
    return runId;
  });
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

  it("mode:scout은 scope 없이도 201이고 trend-scout run을 만든다", async () => {
    const res = await post({ mode: "scout" });

    expect(res.status).toBe(201);
    const { runId } = await res.json();
    expect(spawnConsult).toHaveBeenCalledExactlyOnceWith(runId);

    const stored = withRunStore((store) => store.loadRun(runId));
    expect(stored.scout).toBe(true);
    expect(stored.steps[0]?.name).toBe("trend-scout");
    // 범위 없는 전 범위 탐색이 이 기능의 기본 사용법이다 — 400이 아니다
    expect(stored.idea).toBe("전 범위 탐색");
    // 스카우트는 사용자를 두 번 멈춰 세우지 않는다 (step 1)
    expect(stored.steps.some((s) => s.name === "interviewer")).toBe(false);
  });

  it("mode:scout의 scope는 run의 idea가 된다", async () => {
    const res = await post({ mode: "scout", scope: "B2B SaaS" });

    expect(res.status).toBe(201);
    const { runId } = await res.json();
    expect(withRunStore((store) => store.loadRun(runId)).idea).toBe("B2B SaaS");
  });

  it("mode도 idea도 없으면 400이고 spawn하지 않는다", async () => {
    expect((await post({ mode: "bogus" })).status).toBe(400);
    expect(spawnConsult).not.toHaveBeenCalled();
    expect(withRunStore((store) => store.listRuns())).toEqual([]);
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

describe("POST /api/runs/[id]/rerun", () => {
  function rerun(id: string): Promise<Response> {
    return postRerun(
      new Request(`http://localhost/api/runs/${id}/rerun`, { method: "POST" }),
      params(id),
    );
  }

  const QUESTIONS = {
    questions: [
      { id: "q1", question: "핵심 타깃은 누구인가?", why: "검증 방향이 갈린다" },
    ],
  };
  const ANSWERS = {
    answers: [{ questionId: "q1", answer: "주 2회 이상 회의하는 팀" }],
  };

  /** 포크가 인터뷰 산출물을 복사하는지 보려면 원본에 그것이 있어야 한다 (fixture는 CLI run이라 없다) */
  function seedCompletedWithInterview(): void {
    seedFixtureRun(COMPLETED_RUN_ID);
    withRunStore((store) => {
      store.saveInterviewQuestions(COMPLETED_RUN_ID, QUESTIONS);
      store.saveInterviewAnswers(COMPLETED_RUN_ID, ANSWERS);
    });
  }

  it("completed run을 포크해 새 runId로 spawn하고 201을 응답한다", async () => {
    seedCompletedWithInterview();
    let forkExistedWhenSpawned = false;
    vi.mocked(spawnConsult).mockImplementation((spawnedId: string) => {
      forkExistedWhenSpawned = withRunStore(
        (store) => store.loadRunRecord(spawnedId) !== null,
      );
    });

    const res = await rerun(COMPLETED_RUN_ID);

    expect(res.status).toBe(201);
    const { runId } = await res.json();
    expect(runId).not.toBe(COMPLETED_RUN_ID);
    expect(spawnConsult).toHaveBeenCalledExactlyOnceWith(runId);
    // ADR-007 순서: 포크를 DB에 먼저 써야 CLI의 --resume {newRunId}가 찾는다
    expect(forkExistedWhenSpawned).toBe(true);
    // 계보가 남는다 (ADR-015)
    expect(withRunStore((store) => store.loadRunRecord(runId))?.rerunOf).toBe(
      COMPLETED_RUN_ID,
    );
  });

  it("포크는 idea·questions·answers만 복사하고 자료조사 이후는 복사하지 않는다", async () => {
    seedCompletedWithInterview();

    const { runId } = await (await rerun(COMPLETED_RUN_ID)).json();

    withRunStore((store) => {
      expect(store.loadRun(runId).idea).toBe(
        store.loadRun(COMPLETED_RUN_ID).idea,
      );
      // 인터뷰를 다시 묻지 않는다 (PRD Phase 6)
      expect(store.loadInterviewQuestions(runId)).toEqual(QUESTIONS);
      expect(store.loadInterviewAnswers(runId)).toEqual(ANSWERS);
      // 원본에는 있고 포크에는 없다 — 자료조사부터 다시 도는 것이 재실행의 정의다 (ADR-015)
      expect(
        store.loadStepOutput(COMPLETED_RUN_ID, "context-hunter", MarketContextSchema),
      ).not.toBeNull();
      expect(
        store.loadStepOutput(runId, "context-hunter", MarketContextSchema),
      ).toBeNull();
      expect(store.hasReport(runId)).toBe(false);
    });
  });

  it("원본은 덮어쓰지 않는다 — 리포트가 그대로 남는다", async () => {
    seedCompletedWithInterview();
    const before = withRunStore((store) => store.loadReport(COMPLETED_RUN_ID));

    await rerun(COMPLETED_RUN_ID);

    const after = withRunStore((store) => ({
      report: store.loadReport(COMPLETED_RUN_ID),
      status: store.listRuns().find((r) => r.runId === COMPLETED_RUN_ID)?.status,
    }));
    expect(after.report).toBe(before);
    expect(after.status).toBe("completed");
  });

  it("error run도 재실행할 수 있다", async () => {
    seedFixtureRun(ERROR_RUN_ID);

    const res = await rerun(ERROR_RUN_ID);

    expect(res.status).toBe(201);
    const { runId } = await res.json();
    expect(spawnConsult).toHaveBeenCalledExactlyOnceWith(runId);
  });

  it("stalled run도 재실행할 수 있다", async () => {
    seedFixtureRun(RUNNING_RUN_ID);
    touchUpdatedAt(
      RUNNING_RUN_ID,
      new Date(Date.now() - SIXTEEN_MINUTES_MS).toISOString(),
    );

    expect((await rerun(RUNNING_RUN_ID)).status).toBe(201);
  });

  it("running run은 409이고 새 run이 생기지 않는다", async () => {
    seedFixtureRun(RUNNING_RUN_ID);

    const res = await rerun(RUNNING_RUN_ID);

    expect(res.status).toBe(409);
    expect(spawnConsult).not.toHaveBeenCalled();
    expect(withRunStore((store) => store.listRuns())).toHaveLength(1);
  });

  it("waiting run은 409이고 새 run이 생기지 않는다", async () => {
    seedFixtureRun(WAITING_RUN_ID);

    const res = await rerun(WAITING_RUN_ID);

    expect(res.status).toBe(409);
    expect(spawnConsult).not.toHaveBeenCalled();
    expect(withRunStore((store) => store.listRuns())).toHaveLength(1);
  });

  it("없는 run은 404이고 spawn하지 않는다", async () => {
    const res = await rerun("nope");

    expect(res.status).toBe(404);
    expect(spawnConsult).not.toHaveBeenCalled();
    expect(withRunStore((store) => store.listRuns())).toEqual([]);
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

describe("POST /api/runs/[id]/selection", () => {
  function selection(id: string, body: unknown): Promise<Response> {
    return postSelection(
      new Request(`http://localhost/api/runs/${id}/selection`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
      params(id),
    );
  }

  it("waiting run은 선택을 기록하고 spawn 후 202", async () => {
    const runId = seedScoutWaitingRun();

    const res = await selection(runId, { candidateId: "O1" });

    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ runId });
    expect(spawnConsult).toHaveBeenCalledExactlyOnceWith(runId);
    expect(
      withRunStore((store) => store.loadOpportunitySelection(runId)),
    ).toEqual({ candidateId: "O1" });
  });

  it("없는 run은 404이고 spawn하지 않는다", async () => {
    const res = await selection("nope", { candidateId: "O1" });

    expect(res.status).toBe(404);
    expect(spawnConsult).not.toHaveBeenCalled();
  });

  it("waiting이 아닌 run은 409이고 spawn하지 않는다", async () => {
    seedFixtureRun(COMPLETED_RUN_ID);

    const res = await selection(COMPLETED_RUN_ID, { candidateId: "O1" });

    expect(res.status).toBe(409);
    expect(spawnConsult).not.toHaveBeenCalled();
  });

  it("저장된 후보에 없는 candidateId는 400이고 저장·spawn하지 않는다", async () => {
    const runId = seedScoutWaitingRun();

    const res = await selection(runId, { candidateId: "O99" });

    // spawnConsult는 stdio:"ignore"라 CLI 안의 에러가 사용자에게 닿지 못한다.
    // API가 동기적으로 거절하지 않으면 run이 조용히 죽는다 (ADR-018과 같은 함정)
    expect(res.status).toBe(400);
    expect(spawnConsult).not.toHaveBeenCalled();
    expect(withRunStore((store) => store.loadOpportunitySelection(runId))).toBe(
      null,
    );
  });

  it("selection 형식이 잘못되면 400이고 spawn하지 않는다", async () => {
    const runId = seedScoutWaitingRun();

    expect((await selection(runId, { candidateId: "" })).status).toBe(400);
    expect((await selection(runId, {})).status).toBe(400);
    expect(spawnConsult).not.toHaveBeenCalled();
  });

  it("본문이 JSON이 아니면 400", async () => {
    const runId = seedScoutWaitingRun();

    const res = await postSelection(
      new Request(`http://localhost/api/runs/${runId}/selection`, {
        method: "POST",
        body: "oops",
      }),
      params(runId),
    );

    expect(res.status).toBe(400);
    expect(spawnConsult).not.toHaveBeenCalled();
  });
});

describe("GET /api/runs/[id] — 스카우트 후보 노출", () => {
  it("스카우트 run은 opportunities를 실어 보낸다", async () => {
    const runId = seedScoutWaitingRun("기후 기술");

    const res = await getRunById(
      new Request(`http://localhost/api/runs/${runId}`),
      params(runId),
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("waiting");
    expect(body.opportunities).toEqual(SCOUT_OPPORTUNITIES);
  });

  it("비-스카우트 run은 opportunities 없이도 응답 형태가 깨지지 않는다", async () => {
    seedFixtureRun(COMPLETED_RUN_ID);

    const res = await getRunById(
      new Request(`http://localhost/api/runs/${COMPLETED_RUN_ID}`),
      params(COMPLETED_RUN_ID),
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.opportunities).toBeUndefined();
    expect(body.state.runId).toBe(COMPLETED_RUN_ID);
    expect(body.hasReport).toBe(true);
  });
});
