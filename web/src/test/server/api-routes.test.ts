// @vitest-environment node
import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RunStateSchema } from "@anvil/types";
import { GET as getRuns, POST as postRun } from "@/app/api/runs/route";
import { GET as getRunById } from "@/app/api/runs/[id]/route";
import { GET as getReport } from "@/app/api/runs/[id]/report/route";
import { POST as postResume } from "@/app/api/runs/[id]/resume/route";
import { spawnConsult } from "@/lib/server/spawnConsult";
import {
  ALL_RUN_IDS,
  COMPLETED_RUN_ID,
  ERROR_RUN_ID,
  FIXTURES_DIR,
  RUNNING_RUN_ID,
  ageStateFile,
  cleanupTempRunsDir,
  copyFixtureRun,
  makeTempRunsDir,
} from "@/test/fixtures";

// 실제 child process spawn 금지 — 모듈 mock으로 대체한다
vi.mock("@/lib/server/spawnConsult", () => ({
  spawnConsult: vi.fn(),
}));

const ELEVEN_MINUTES_MS = 11 * 60 * 1000;

function params(id: string): { params: Promise<{ id: string }> } {
  return { params: Promise.resolve({ id }) };
}

let runsDir: string;

beforeEach(() => {
  runsDir = makeTempRunsDir();
});

afterEach(() => {
  cleanupTempRunsDir(runsDir);
  vi.clearAllMocks();
});

describe("GET /api/runs", () => {
  it("전체 run 목록을 { runs }로 반환한다", async () => {
    for (const runId of ALL_RUN_IDS) {
      copyFixtureRun(runsDir, runId);
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
      copyFixtureRun(runsDir, runId);
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
    let stateExistedWhenSpawned = false;
    vi.mocked(spawnConsult).mockImplementation((runId: string) => {
      stateExistedWhenSpawned = fs.existsSync(
        path.join(runsDir, runId, "state.json"),
      );
    });

    const res = await post({ idea: "AI 이력서 첨삭 서비스" });

    expect(res.status).toBe(201);
    const { runId } = await res.json();
    expect(runId).toBeTruthy();
    // ADR-007 핵심 순서: runId 선생성(state.json 존재) 후 spawn
    expect(spawnConsult).toHaveBeenCalledExactlyOnceWith(runId);
    expect(stateExistedWhenSpawned).toBe(true);

    const onDisk = RunStateSchema.parse(
      JSON.parse(fs.readFileSync(path.join(runsDir, runId, "state.json"), "utf-8")),
    );
    expect(onDisk.idea).toBe("AI 이력서 첨삭 서비스");
  });

  it("idea가 공백뿐이면 400이고 spawn하지 않는다", async () => {
    const res = await post({ idea: "   " });

    expect(res.status).toBe(400);
    expect(spawnConsult).not.toHaveBeenCalled();
    expect(fs.readdirSync(runsDir)).toEqual([]);
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
    copyFixtureRun(runsDir, COMPLETED_RUN_ID);

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

describe("GET /api/runs/[id]/report", () => {
  it("report.md를 다운로드 헤더와 함께 반환한다", async () => {
    copyFixtureRun(runsDir, COMPLETED_RUN_ID);

    const res = await getReport(
      new Request(`http://localhost/api/runs/${COMPLETED_RUN_ID}/report`),
      params(COMPLETED_RUN_ID),
    );

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/markdown; charset=utf-8");
    expect(res.headers.get("content-disposition")).toContain("attachment");
    const expected = fs.readFileSync(
      path.join(FIXTURES_DIR, COMPLETED_RUN_ID, "report.md"),
      "utf-8",
    );
    expect(await res.text()).toBe(expected);
  });

  it("report.md가 없는 run은 404", async () => {
    copyFixtureRun(runsDir, RUNNING_RUN_ID);

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
    copyFixtureRun(runsDir, ERROR_RUN_ID);

    const res = await resume(ERROR_RUN_ID);

    expect(res.status).toBe(202);
    expect(spawnConsult).toHaveBeenCalledExactlyOnceWith(ERROR_RUN_ID);
  });

  it("stalled run은 spawn 후 202", async () => {
    copyFixtureRun(runsDir, RUNNING_RUN_ID);
    ageStateFile(runsDir, RUNNING_RUN_ID, ELEVEN_MINUTES_MS);

    const res = await resume(RUNNING_RUN_ID);

    expect(res.status).toBe(202);
    expect(spawnConsult).toHaveBeenCalledExactlyOnceWith(RUNNING_RUN_ID);
  });

  it("running run은 409이고 spawn하지 않는다", async () => {
    copyFixtureRun(runsDir, RUNNING_RUN_ID);

    const res = await resume(RUNNING_RUN_ID);

    expect(res.status).toBe(409);
    expect(spawnConsult).not.toHaveBeenCalled();
  });

  it("completed run은 409이고 spawn하지 않는다", async () => {
    copyFixtureRun(runsDir, COMPLETED_RUN_ID);

    const res = await resume(COMPLETED_RUN_ID);

    expect(res.status).toBe(409);
    expect(spawnConsult).not.toHaveBeenCalled();
  });
});
