// @vitest-environment node
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { RunStore } from "@anvil/runStore";
import {
  getDbPath,
  getRepoRoot,
  getRunDetail,
  searchRuns,
  withRunStore,
} from "@/lib/server/runs";
import {
  ALL_RUN_IDS,
  COMPLETED_RUN_ID,
  ERROR_RUN_ID,
  RUNNING_RUN_ID,
  WAITING_RUN_ID,
  cleanupTempDb,
  corruptRunState,
  deleteArtifact,
  makeTempDb,
  seedFixtureRun,
  touchUpdatedAt,
  writeArtifact,
} from "@/test/fixtures";

// STALLED_THRESHOLD_MS(15분)를 넘겨야 stalled로 파생된다 (ADR-012)
const SIXTEEN_MINUTES_MS = 16 * 60 * 1000;

function minutesAgo(ms: number): string {
  return new Date(Date.now() - ms).toISOString();
}

describe("경로 해석 (env 주입)", () => {
  afterEach(() => {
    delete process.env.ANVIL_DB_PATH;
    delete process.env.ANVIL_REPO_ROOT;
  });

  it("getDbPath는 ANVIL_DB_PATH를 우선한다", () => {
    process.env.ANVIL_DB_PATH = "/tmp/injected/anvil.db";
    expect(getDbPath()).toBe("/tmp/injected/anvil.db");
  });

  it("getDbPath 기본값은 cwd 상위의 data/anvil.db다 (웹의 cwd는 web/이다)", () => {
    delete process.env.ANVIL_DB_PATH;
    expect(getDbPath()).toBe(
      path.resolve(process.cwd(), "..", "data", "anvil.db"),
    );
  });

  it("getRepoRoot는 ANVIL_REPO_ROOT를 우선한다", () => {
    process.env.ANVIL_REPO_ROOT = "/tmp/injected-root";
    expect(getRepoRoot()).toBe("/tmp/injected-root");
  });

  it("getRepoRoot 기본값은 cwd 상위다", () => {
    delete process.env.ANVIL_REPO_ROOT;
    expect(getRepoRoot()).toBe(path.resolve(process.cwd(), ".."));
  });
});

// 커넥션을 열고 닫지 않으면 Next dev 서버의 HMR이 죽은 핸들을 재활용한다 (ARCHITECTURE)
describe("withRunStore (요청마다 열고 닫는다)", () => {
  let dbPath: string;

  beforeEach(() => {
    dbPath = makeTempDb();
  });

  afterEach(() => {
    cleanupTempDb(dbPath);
  });

  it("fn에 열린 store를 주고 결과를 그대로 돌려준다", () => {
    expect(withRunStore((store) => store.listRuns())).toEqual([]);
  });

  it("fn이 끝나면 커넥션을 닫는다", () => {
    const escaped = withRunStore((store) => store);

    expect(() => escaped.listRuns()).toThrow();
  });

  it("fn이 throw해도 커넥션을 닫는다", () => {
    let escaped: RunStore | undefined;

    expect(() =>
      withRunStore((store) => {
        escaped = store;
        throw new Error("boom");
      }),
    ).toThrow("boom");
    expect(() => escaped?.listRuns()).toThrow();
  });
});

describe("getRunDetail", () => {
  let dbPath: string;

  beforeEach(() => {
    dbPath = makeTempDb();
  });

  afterEach(() => {
    cleanupTempDb(dbPath);
  });

  it("완료 run: 산출물 5종 + hasReport + completed 상태를 조립한다", () => {
    seedFixtureRun(COMPLETED_RUN_ID);

    const detail = getRunDetail(COMPLETED_RUN_ID);

    expect(detail).not.toBeNull();
    expect(detail?.state.runId).toBe(COMPLETED_RUN_ID);
    expect(detail?.status).toBe("completed");
    expect(detail?.context?.competitors.length).toBeGreaterThanOrEqual(10);
    expect(detail?.context?.communityVoices.length).toBeGreaterThanOrEqual(3);
    expect(detail?.context?.briefing).toBeTruthy();
    expect(detail?.thesis?.points.length).toBeGreaterThanOrEqual(3);
    expect(detail?.criticism?.points.length).toBeGreaterThanOrEqual(3);
    expect(detail?.criticism?.verdict).toBeTruthy();
    expect(detail?.solution?.revisedConcept).toBeTruthy();
    expect(detail?.hasReport).toBe(true);
  });

  it("완료 run: thesis와 verdict 산출물을 포함해 반환한다", () => {
    seedFixtureRun(COMPLETED_RUN_ID);

    const detail = getRunDetail(COMPLETED_RUN_ID);

    expect(detail?.thesis?.winningThesis).toBeTruthy();
    expect(detail?.verdict?.recommendation).toBeTruthy();
    expect(detail?.verdict?.survivalScore).toBeGreaterThanOrEqual(0);
    expect(detail?.verdict?.residualRisks.length).toBeGreaterThanOrEqual(1);
  });

  it("옛 스키마 criticism(3개 배열)은 criticism 필드가 생략되고 throw하지 않는다", () => {
    // 구버전 run 하위호환 회귀 방지: 평탄화 이전 형식(painPointReality 등)은 새 스키마 검증에
    // 실패하지만, loadStepOutput이 null을 반환해 해당 필드만 빠지고 나머지는 그대로 조립된다 (ADR-011).
    seedFixtureRun(COMPLETED_RUN_ID);
    writeArtifact(
      COMPLETED_RUN_ID,
      "criticism",
      JSON.stringify({
        painPointReality: [
          { claim: "옛 형식", evidence: "근거", severity: "major" },
        ],
        bmWeakness: [{ claim: "옛 형식", evidence: "근거", severity: "fatal" }],
        copycatRisk: [{ claim: "옛 형식", evidence: "근거", severity: "minor" }],
        verdict: "옛 판정",
      }),
    );

    const detail = getRunDetail(COMPLETED_RUN_ID);

    expect(detail).not.toBeNull();
    expect(detail && "criticism" in detail).toBe(false);
    // 다른 산출물은 정상적으로 조립된다 — 하나의 구버전 산출물이 상세 전체를 죽이지 않는다
    expect(detail?.context).toBeTruthy();
    expect(detail?.solution).toBeTruthy();
    expect(detail?.verdict).toBeTruthy();
  });

  it("진행중 run: context만 있고 criticism/solution 필드는 생략된다", () => {
    seedFixtureRun(RUNNING_RUN_ID);

    const detail = getRunDetail(RUNNING_RUN_ID);

    expect(detail?.status).toBe("running");
    expect(detail?.context?.ideaTitle).toBe("반려식물 케어 구독 서비스");
    expect(detail && "criticism" in detail).toBe(false);
    expect(detail && "solution" in detail).toBe(false);
    expect(detail?.hasReport).toBe(false);
  });

  it("실패 run: error 상태와 errorMessage를 노출한다", () => {
    seedFixtureRun(ERROR_RUN_ID);

    const detail = getRunDetail(ERROR_RUN_ID);

    expect(detail?.status).toBe("error");
    expect(
      detail?.state.steps.find((s) => s.name === "cold-critic")?.errorMessage,
    ).toContain("CriticismSchema");
  });

  it("답변 대기 run: status는 waiting이고 questions를 노출한다", () => {
    seedFixtureRun(WAITING_RUN_ID);

    const detail = getRunDetail(WAITING_RUN_ID);

    expect(detail?.status).toBe("waiting");
    expect(detail?.questions?.questions.length).toBe(2);
    expect(detail?.state.interview).toBe(true);
  });

  it("updated_at이 오래돼도 waiting run은 stalled로 바뀌지 않는다", () => {
    seedFixtureRun(WAITING_RUN_ID);
    touchUpdatedAt(WAITING_RUN_ID, minutesAgo(SIXTEEN_MINUTES_MS));

    expect(getRunDetail(WAITING_RUN_ID)?.status).toBe("waiting");
  });

  it("thesis 산출물이 있으면 thesis 필드를 조립한다", () => {
    seedFixtureRun(COMPLETED_RUN_ID);
    writeArtifact(
      COMPLETED_RUN_ID,
      "thesis",
      JSON.stringify({
        points: [
          { id: "t1", axis: "painPoint", claim: "통증 실재", rationale: "근거" },
          { id: "t2", axis: "bm", claim: "지불 의사", rationale: "근거" },
          { id: "t3", axis: "copycat", claim: "해자", rationale: "근거" },
        ],
        revenueModel: "구독 전환",
        growthLevers: ["바이럴 루프"],
        marketTailwinds: ["시장 성장"],
        bestCaseScenario: "국내 1위 달성",
        winningThesis: "명확한 가치가 유료 전환을 이끈다",
      }),
    );

    expect(getRunDetail(COMPLETED_RUN_ID)?.thesis?.revenueModel).toBe(
      "구독 전환",
    );
  });

  it("updated_at이 15분을 넘긴 미완료 run은 stalled다", () => {
    seedFixtureRun(RUNNING_RUN_ID);
    touchUpdatedAt(RUNNING_RUN_ID, minutesAgo(SIXTEEN_MINUTES_MS));

    expect(getRunDetail(RUNNING_RUN_ID)?.status).toBe("stalled");
  });

  it("이송된 구 run은 rerunOf가 없다 (계보 없음)", () => {
    seedFixtureRun(COMPLETED_RUN_ID);

    const detail = getRunDetail(COMPLETED_RUN_ID);

    expect(detail && "rerunOf" in detail).toBe(false);
  });

  it("재실행 run은 rerunOf로 원본을 가리킨다", () => {
    seedFixtureRun(COMPLETED_RUN_ID);
    const fork = withRunStore((store) => store.createRerun(COMPLETED_RUN_ID));

    expect(getRunDetail(fork.runId)?.rerunOf).toBe(COMPLETED_RUN_ID);
  });

  it("재실행 run은 원본의 아이디어·상태를 origin으로 함께 싣는다 (계보 표시용)", () => {
    seedFixtureRun(COMPLETED_RUN_ID);
    const source = withRunStore((store) => store.loadRun(COMPLETED_RUN_ID));
    const fork = withRunStore((store) => store.createRerun(COMPLETED_RUN_ID));

    expect(getRunDetail(fork.runId)?.origin).toEqual({
      runId: COMPLETED_RUN_ID,
      idea: source.idea,
      status: "completed",
    });
  });

  it("원본이 삭제되면 계보가 끊겨 rerunOf·origin이 모두 없다 (ON DELETE SET NULL)", () => {
    seedFixtureRun(COMPLETED_RUN_ID);
    const fork = withRunStore((store) => store.createRerun(COMPLETED_RUN_ID));
    withRunStore((store) => store.deleteRun(COMPLETED_RUN_ID));

    const detail = getRunDetail(fork.runId);

    // 포크는 살아남는다 — 끊기는 것은 계보뿐이다
    expect(detail?.state.runId).toBe(fork.runId);
    expect(detail && "rerunOf" in detail).toBe(false);
    expect(detail && "origin" in detail).toBe(false);
  });

  it("존재하지 않는 run은 null", () => {
    expect(getRunDetail("no-such-run")).toBeNull();
  });

  it("상태 행이 손상된 run은 null (throw하지 않는다)", () => {
    seedFixtureRun(RUNNING_RUN_ID);
    corruptRunState(RUNNING_RUN_ID);

    expect(getRunDetail(RUNNING_RUN_ID)).toBeNull();
  });

  it("산출물이 손상된 JSON이면 해당 필드만 생략한다", () => {
    seedFixtureRun(COMPLETED_RUN_ID);
    writeArtifact(COMPLETED_RUN_ID, "context", "{ not json");

    const detail = getRunDetail(COMPLETED_RUN_ID);

    expect(detail && "context" in detail).toBe(false);
    expect(detail?.criticism).toBeTruthy();
    expect(detail?.solution).toBeTruthy();
  });

  it("산출물이 스키마 검증에 실패하면 해당 필드만 생략한다", () => {
    seedFixtureRun(COMPLETED_RUN_ID);
    writeArtifact(
      COMPLETED_RUN_ID,
      "solution",
      JSON.stringify({ revisedConcept: "필수 필드 누락" }),
    );

    const detail = getRunDetail(COMPLETED_RUN_ID);

    expect(detail && "solution" in detail).toBe(false);
    expect(detail?.context).toBeTruthy();
    expect(detail?.criticism).toBeTruthy();
  });

  it("리포트가 없으면 hasReport는 false다", () => {
    seedFixtureRun(COMPLETED_RUN_ID);
    deleteArtifact(COMPLETED_RUN_ID, "report");

    expect(getRunDetail(COMPLETED_RUN_ID)?.hasReport).toBe(false);
  });
});

describe("searchRuns", () => {
  let dbPath: string;

  beforeEach(() => {
    dbPath = makeTempDb();
    for (const runId of ALL_RUN_IDS) {
      seedFixtureRun(runId);
    }
  });

  afterEach(() => {
    cleanupTempDb(dbPath);
  });

  it("인자 없이 호출하면 전체 run을 최신순으로 반환한다", () => {
    const runs = searchRuns();

    expect(runs.map((r) => r.runId)).toEqual([
      ERROR_RUN_ID,
      RUNNING_RUN_ID,
      COMPLETED_RUN_ID,
    ]);
  });

  it("q는 idea 부분 문자열로 필터한다", () => {
    const runs = searchRuns("회의록");

    expect(runs.map((r) => r.runId)).toEqual([COMPLETED_RUN_ID]);
  });

  it("q는 대소문자를 무시한다", () => {
    expect(searchRuns("ai").map((r) => r.runId)).toEqual([COMPLETED_RUN_ID]);
    expect(searchRuns("AI").map((r) => r.runId)).toEqual([COMPLETED_RUN_ID]);
  });

  it("status로 필터한다", () => {
    expect(searchRuns(undefined, "error").map((r) => r.runId)).toEqual([
      ERROR_RUN_ID,
    ]);
    expect(searchRuns(undefined, "completed").map((r) => r.runId)).toEqual([
      COMPLETED_RUN_ID,
    ]);
  });

  it("status는 updated_at으로 파생된 값으로 거른다 (SQL이 아니라 deriveRunStatus가 권위다)", () => {
    touchUpdatedAt(RUNNING_RUN_ID, minutesAgo(SIXTEEN_MINUTES_MS));

    expect(searchRuns(undefined, "stalled").map((r) => r.runId)).toEqual([
      RUNNING_RUN_ID,
    ]);
    expect(searchRuns(undefined, "running")).toEqual([]);
  });

  it("q와 status를 조합한다", () => {
    expect(searchRuns("추천", "error").map((r) => r.runId)).toEqual([
      ERROR_RUN_ID,
    ]);
    expect(searchRuns("추천", "completed")).toEqual([]);
  });

  it("매칭이 없으면 빈 배열", () => {
    expect(searchRuns("존재하지 않는 키워드")).toEqual([]);
  });
});
