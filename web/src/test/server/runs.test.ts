// @vitest-environment node
import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  getRepoRoot,
  getRunDetail,
  getRunsDir,
  getRunStore,
  searchRuns,
} from "@/lib/server/runs";
import {
  ALL_RUN_IDS,
  COMPLETED_RUN_ID,
  ERROR_RUN_ID,
  RUNNING_RUN_ID,
  WAITING_RUN_ID,
  ageStateFile,
  cleanupTempRunsDir,
  copyFixtureRun,
  makeTempRunsDir,
} from "@/test/fixtures";

// STALLED_THRESHOLD_MS(15분)를 넘겨야 stalled로 파생된다 (ADR-012)
const SIXTEEN_MINUTES_MS = 16 * 60 * 1000;

describe("경로 해석 (env 주입)", () => {
  afterEach(() => {
    delete process.env.ANVIL_RUNS_DIR;
    delete process.env.ANVIL_REPO_ROOT;
  });

  it("getRunsDir는 ANVIL_RUNS_DIR를 우선한다", () => {
    process.env.ANVIL_RUNS_DIR = "/tmp/injected-runs";
    expect(getRunsDir()).toBe("/tmp/injected-runs");
  });

  it("getRunsDir 기본값은 cwd 상위의 runs/다", () => {
    delete process.env.ANVIL_RUNS_DIR;
    expect(getRunsDir()).toBe(path.resolve(process.cwd(), "..", "runs"));
  });

  it("getRepoRoot는 ANVIL_REPO_ROOT를 우선한다", () => {
    process.env.ANVIL_REPO_ROOT = "/tmp/injected-root";
    expect(getRepoRoot()).toBe("/tmp/injected-root");
  });

  it("getRepoRoot 기본값은 cwd 상위다", () => {
    delete process.env.ANVIL_REPO_ROOT;
    expect(getRepoRoot()).toBe(path.resolve(process.cwd(), ".."));
  });

  it("getRunStore는 getRunsDir 기반 RunStore를 만든다", () => {
    process.env.ANVIL_RUNS_DIR = "/tmp/injected-runs";
    // baseDir가 없으면 listRuns가 빈 배열 — getRunsDir를 쓰고 있다는 간접 증거
    expect(getRunStore().listRuns()).toEqual([]);
  });
});

describe("getRunDetail", () => {
  let runsDir: string;

  beforeEach(() => {
    runsDir = makeTempRunsDir();
  });

  afterEach(() => {
    cleanupTempRunsDir(runsDir);
  });

  it("완료 run: 산출물 5종 + hasReport + completed 상태를 조립한다", () => {
    copyFixtureRun(runsDir, COMPLETED_RUN_ID);

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
    copyFixtureRun(runsDir, COMPLETED_RUN_ID);

    const detail = getRunDetail(COMPLETED_RUN_ID);

    expect(detail?.thesis?.winningThesis).toBeTruthy();
    expect(detail?.verdict?.recommendation).toBeTruthy();
    expect(detail?.verdict?.survivalScore).toBeGreaterThanOrEqual(0);
    expect(detail?.verdict?.residualRisks.length).toBeGreaterThanOrEqual(1);
  });

  it("옛 스키마 criticism.json(3개 배열)은 criticism 필드가 생략되고 throw하지 않는다", () => {
    // 구버전 run 하위호환 회귀 방지: 평탄화 이전 형식(painPointReality 등)은 새 스키마 검증에
    // 실패하지만, loadStepOutput이 null을 반환해 해당 필드만 빠지고 나머지는 그대로 조립된다 (ADR-011).
    copyFixtureRun(runsDir, COMPLETED_RUN_ID);
    fs.writeFileSync(
      path.join(runsDir, COMPLETED_RUN_ID, "criticism.json"),
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
    // 다른 산출물은 정상적으로 조립된다 — 하나의 구버전 파일이 상세 전체를 죽이지 않는다
    expect(detail?.context).toBeTruthy();
    expect(detail?.solution).toBeTruthy();
    expect(detail?.verdict).toBeTruthy();
  });

  it("진행중 run: context만 있고 criticism/solution 필드는 생략된다", () => {
    copyFixtureRun(runsDir, RUNNING_RUN_ID);

    const detail = getRunDetail(RUNNING_RUN_ID);

    expect(detail?.status).toBe("running");
    expect(detail?.context?.ideaTitle).toBe("반려식물 케어 구독 서비스");
    expect(detail && "criticism" in detail).toBe(false);
    expect(detail && "solution" in detail).toBe(false);
    expect(detail?.hasReport).toBe(false);
  });

  it("실패 run: error 상태와 errorMessage를 노출한다", () => {
    copyFixtureRun(runsDir, ERROR_RUN_ID);

    const detail = getRunDetail(ERROR_RUN_ID);

    expect(detail?.status).toBe("error");
    expect(
      detail?.state.steps.find((s) => s.name === "cold-critic")?.errorMessage,
    ).toContain("CriticismSchema");
  });

  it("답변 대기 run: status는 waiting이고 questions를 노출한다", () => {
    copyFixtureRun(runsDir, WAITING_RUN_ID);

    const detail = getRunDetail(WAITING_RUN_ID);

    expect(detail?.status).toBe("waiting");
    expect(detail?.questions?.questions.length).toBe(2);
    expect(detail?.state.interview).toBe(true);
  });

  it("mtime이 오래돼도 waiting run은 stalled로 바뀌지 않는다", () => {
    copyFixtureRun(runsDir, WAITING_RUN_ID);
    ageStateFile(runsDir, WAITING_RUN_ID, SIXTEEN_MINUTES_MS);

    expect(getRunDetail(WAITING_RUN_ID)?.status).toBe("waiting");
  });

  it("thesis.json이 있으면 thesis 필드를 조립한다", () => {
    copyFixtureRun(runsDir, COMPLETED_RUN_ID);
    fs.writeFileSync(
      path.join(runsDir, COMPLETED_RUN_ID, "thesis.json"),
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

  it("mtime이 15분을 넘긴 미완료 run은 stalled다", () => {
    copyFixtureRun(runsDir, RUNNING_RUN_ID);
    ageStateFile(runsDir, RUNNING_RUN_ID, SIXTEEN_MINUTES_MS);

    expect(getRunDetail(RUNNING_RUN_ID)?.status).toBe("stalled");
  });

  it("존재하지 않는 run은 null", () => {
    expect(getRunDetail("no-such-run")).toBeNull();
  });

  it("state.json이 손상된 run은 null (throw하지 않는다)", () => {
    copyFixtureRun(runsDir, RUNNING_RUN_ID);
    fs.writeFileSync(
      path.join(runsDir, RUNNING_RUN_ID, "state.json"),
      "{ not json",
    );

    expect(getRunDetail(RUNNING_RUN_ID)).toBeNull();
  });

  it("산출물이 손상된 JSON이면 해당 필드만 생략한다", () => {
    copyFixtureRun(runsDir, COMPLETED_RUN_ID);
    fs.writeFileSync(
      path.join(runsDir, COMPLETED_RUN_ID, "context.json"),
      "{ not json",
    );

    const detail = getRunDetail(COMPLETED_RUN_ID);

    expect(detail && "context" in detail).toBe(false);
    expect(detail?.criticism).toBeTruthy();
    expect(detail?.solution).toBeTruthy();
  });

  it("산출물이 스키마 검증에 실패하면 해당 필드만 생략한다", () => {
    copyFixtureRun(runsDir, COMPLETED_RUN_ID);
    fs.writeFileSync(
      path.join(runsDir, COMPLETED_RUN_ID, "solution.json"),
      JSON.stringify({ revisedConcept: "필수 필드 누락" }),
    );

    const detail = getRunDetail(COMPLETED_RUN_ID);

    expect(detail && "solution" in detail).toBe(false);
    expect(detail?.context).toBeTruthy();
    expect(detail?.criticism).toBeTruthy();
  });

  it("report.md가 없으면 hasReport는 false다", () => {
    copyFixtureRun(runsDir, COMPLETED_RUN_ID);
    fs.rmSync(path.join(runsDir, COMPLETED_RUN_ID, "report.md"));

    expect(getRunDetail(COMPLETED_RUN_ID)?.hasReport).toBe(false);
  });
});

describe("searchRuns", () => {
  let runsDir: string;

  beforeEach(() => {
    runsDir = makeTempRunsDir();
    for (const runId of ALL_RUN_IDS) {
      copyFixtureRun(runsDir, runId);
    }
  });

  afterEach(() => {
    cleanupTempRunsDir(runsDir);
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
