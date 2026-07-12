import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GoogleGenAI } from "@google/genai";
import { RunStore, type RunUsageSummary } from "../lib/runStore.js";
import { GeminiService } from "../services/gemini.js";
import {
  buildResearchSources,
  consult,
  formatUsageSummary,
  type ConsultDeps,
  type ConsultOutput,
} from "./index.js";

/**
 * 키 부재는 "수집 실패"가 아니라 "소스 부재"다 (ADR-012).
 *
 * 키가 없을 때 항상 reject하는 fetchFn을 가진 서비스를 만들면 collectAll이 그것을
 * failures[]에 기록하고, LLM 프롬프트는 "네이버 수집이 실패했다"고 적는다 — 사실은
 * 애초에 키가 없었던 것이다. 두 상황은 다르다. 키가 없으면 배열에 넣지 않는다.
 */

const ALL_KEYS: NodeJS.ProcessEnv = {
  YOUTUBE_API_KEY: "yt-key",
  NAVER_CLIENT_ID: "naver-id",
  NAVER_CLIENT_SECRET: "naver-secret",
};

/** eslint의 no-unused-vars가 rest sibling을 봐주지 않아 구조분해 대신 delete를 쓴다 */
function envWithout(...omit: string[]): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...ALL_KEYS };
  for (const key of omit) {
    delete env[key];
  }
  return env;
}

function ids(env: NodeJS.ProcessEnv): string[] {
  return buildResearchSources(env).map((source) => source.id);
}

let warn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("buildResearchSources", () => {
  it("모든 키가 있으면 세 소스를 전부 등록한다", () => {
    expect(ids(ALL_KEYS)).toEqual(["youtube", "hackernews", "naver"]);
    expect(warn).not.toHaveBeenCalled();
  });

  it("Hacker News는 키가 필요 없어 키가 하나도 없어도 등록된다", () => {
    expect(ids({})).toEqual(["hackernews"]);
  });

  it("YOUTUBE_API_KEY가 없으면 youtube 소스를 등록하지 않고 경고한다", () => {
    expect(ids(envWithout("YOUTUBE_API_KEY"))).toEqual(["hackernews", "naver"]);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("YOUTUBE_API_KEY"));
  });

  it("네이버 키가 없으면 naver 소스를 등록하지 않고 경고한다", () => {
    const env = envWithout("NAVER_CLIENT_ID", "NAVER_CLIENT_SECRET");

    expect(ids(env)).toEqual(["youtube", "hackernews"]);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("NAVER_CLIENT_ID"));
  });

  it("네이버 키가 반쪽만 있으면(ID만) 부재로 취급한다 — 반쪽 서비스는 401로 죽는다", () => {
    expect(ids(envWithout("NAVER_CLIENT_SECRET"))).toEqual(["youtube", "hackernews"]);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("NAVER_CLIENT_SECRET"));
  });

  it("네이버 키가 반쪽만 있으면(SECRET만) 부재로 취급한다", () => {
    expect(ids(envWithout("NAVER_CLIENT_ID"))).toEqual(["youtube", "hackernews"]);
  });

  it("빈 문자열 키는 미설정과 같다", () => {
    expect(
      ids({ YOUTUBE_API_KEY: "", NAVER_CLIENT_ID: "", NAVER_CLIENT_SECRET: "" }),
    ).toEqual(["hackernews"]);
  });

  it("키가 없는 소스는 실패가 아니라 부재다 — 동작할 수 없는 서비스 객체를 만들지 않는다", async () => {
    // 서비스가 생성 시점에 globalThis.fetch를 캡처하므로 먼저 갈아끼운다.
    // HN collect()는 2 round-trip이라 호출마다 새 Response를 줘야 한다 (body는 1회만 읽힌다)
    const fetchFn = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(() =>
        Promise.resolve(new Response(JSON.stringify({ hits: [] }), { status: 200 })),
      );

    const sources = buildResearchSources({});

    // 배열에 없으므로 collect를 부를 대상 자체가 없다. "항상 reject하는 fetchFn"을 심었다면
    // youtube/naver가 배열에 남아 collectAll이 이를 수집 실패로 프롬프트에 적었을 것이다.
    expect(sources.map((s) => s.id)).not.toContain("youtube");
    expect(sources.map((s) => s.id)).not.toContain("naver");

    // 등록된 HN 소스는 진짜 동작하는 객체다 — 키 없이도 실제로 수집을 수행한다
    await expect(sources[0].collect("plant care app")).resolves.toEqual([]);
    expect(fetchFn).toHaveBeenCalled();
  });
});

// ── 비용 계측 배선 (ADR-016) ─────────────────────────────────────────
//
// GeminiService는 DB도 runId도 모른다. 그것을 아는 것은 cli/의 책임이고, 그 배선이
// 여기서 검증된다 — mock 응답의 usageMetadata가 DB의 usage 행까지 도착하는가,
// 그리고 그 요약이 **stdout을 오염시키지 않는가**(stdout은 리포트 마크다운 전용이다).

/** 모든 mock 응답에 실리는 토큰 계측. 캐시·thinking이 0이 아니라야 집계 버그가 드러난다 */
const USAGE_META = {
  promptTokenCount: 1_000,
  cachedContentTokenCount: 100,
  candidatesTokenCount: 200,
  thoughtsTokenCount: 300,
  totalTokenCount: 1_500,
};

function withUsage(response: string | object): object {
  const base = typeof response === "string" ? { text: response } : response;
  return { ...base, usageMetadata: USAGE_META };
}

/** responses를 순서대로 돌려주고, 소진되면 fallback을 무한히 돌려준다 (재시도 소진 테스트용) */
function fakeGenAI(
  responses: (string | object)[],
  fallback?: string,
): GoogleGenAI {
  const generateContent = vi.fn();
  for (const response of responses) {
    generateContent.mockResolvedValueOnce(withUsage(response));
  }
  if (fallback !== undefined) {
    generateContent.mockResolvedValue(withUsage(fallback));
  }
  return { models: { generateContent } } as unknown as GoogleGenAI;
}

const IDEA = "AI 반려식물 관리 서비스";

const PLANNER_TEXT = JSON.stringify({
  youtube: "식물 키우기 실패담",
  hackernews: "plant care reminder app",
  naver: "화분 물주기 자꾸 까먹어요",
  web: ["홈가드닝 시장 규모"],
});

// grounding 모드는 responseSchema를 못 써 자유 텍스트(펜스 두른 JSON)로 돌아온다.
// 소스가 0개라 고를 목소리가 없다 — communityVoiceRefs는 빈 배열이다 (합법이다, ADR-012).
const CONTEXT_TEXT = `조사 결과입니다.

\`\`\`json
{
  "ideaTitle": "AI 반려식물 관리 서비스",
  "briefing": "무료 리마인더 앱이 이미 진입로를 선점했다.",
  "marketSizeIndicators": ["국내 홈가드닝 시장 연 10% 성장"],
  "competitorInsight": "경쟁은 진단 정확도에서 벌어진다.",
  "voicesInsight": "수집된 목소리가 없다.",
  "trends": ["홈가드닝 시장 성장"],
  "competitors": [{ "name": "Planta", "description": "식물 관리 앱" }],
  "communityVoiceRefs": [],
  "painPointEvidence": ["물주기 실패로 식물을 죽인 경험"],
  "sources": ["https://example.com/trend"]
}
\`\`\``;

const THESIS_TEXT = JSON.stringify({
  points: [
    { id: "t1", axis: "painPoint", claim: "반복되는 고통이다", rationale: "실패담이 반복된다" },
    { id: "t2", axis: "bm", claim: "지불 의사가 생긴다", rationale: "Planta가 검증했다" },
    { id: "t3", axis: "copycat", claim: "생육 데이터가 해자다", rationale: "경쟁 앱은 축적하지 않는다" },
  ],
  revenueModel: "케어 플랜 구독",
  growthLevers: ["공유 바이럴 루프"],
  marketTailwinds: ["홈가드닝 시장 성장"],
  bestCaseScenario: "2년 내 구독 전환율 8%",
  winningThesis: "실패 없는 케어가 유료 전환을 이끈다",
});

const CRITICISM_TEXT = JSON.stringify({
  points: [
    {
      id: "c1",
      axis: "painPoint",
      rebuts: "t1",
      claim: "고통 빈도가 낮다",
      evidence: "식물은 주 1회 관리로 충분하다",
      severity: "major",
      riskScore: 55,
      riskKeyword: "저빈도 고통",
    },
    {
      id: "c2",
      axis: "bm",
      claim: "구독 이탈률이 높다",
      evidence: "식물이 죽으면 구독 이유가 사라진다",
      severity: "fatal",
      riskScore: 80,
      riskKeyword: "이탈률",
    },
    {
      id: "c3",
      axis: "copycat",
      rebuts: "t3",
      claim: "대형 앱이 복제 가능하다",
      evidence: "진단 모델은 오픈소스로 대체된다",
      severity: "minor",
      riskScore: 20,
      riskKeyword: "복제 용이",
    },
  ],
  verdict: "저빈도 고통과 이탈률이 급소다",
});

const SOLUTION_TEXT = JSON.stringify({
  minimalInput: "식물 사진 1장",
  agenticWorkflow: "사진 진단 → 케어 플랜 → 이상 감지 알림",
  dataFlywheel: "가정별 생육 로그가 진단 정확도를 높인다",
  monetization: "진단 무료, 케어 플랜 구독 월 4,900원",
  revisedConcept: "리마인더가 아니라 조기 진단으로 축을 옮긴다",
});

const VERDICT_TEXT = JSON.stringify({
  survivalScore: 55,
  recommendation: "pivot",
  headline: "고통 빈도를 올리는 축으로 피벗하면 생존한다",
  rationale: "진단 정확도는 해자가 되지만 구독 이탈이 남는다",
  residualRisks: [
    { keyword: "이탈률", severity: "major", note: "식물 사망 시 구독 이유가 소멸한다" },
  ],
  conditions: ["케어 플랜 유지율 40% 이상"],
});

/** 파이프라인 완주에 필요한 6개 응답 (interviewer는 CLI-direct run에서 돌지 않는다) */
const FULL_RUN = [
  PLANNER_TEXT,
  CONTEXT_TEXT,
  THESIS_TEXT,
  CRITICISM_TEXT,
  SOLUTION_TEXT,
  VERDICT_TEXT,
];

const RUN_LABELS = [
  "research-planner",
  "context-hunter",
  "thesis",
  "cold-critic",
  "solution-designer",
  "verdict",
];

let tmpDir: string;
let store: RunStore;
let stdout: string[];
let stderr: string[];

/** 리포트만 stdout으로, 나머지는 전부 stderr로 — 두 갈래를 갈라서 받는다 */
function output(): ConsultOutput {
  return {
    report: (text) => stdout.push(text),
    info: (text) => stderr.push(text),
  };
}

/** 자료조사 소스는 0개다 — HTTP를 흉내 낼 필요 없이 웹검색만으로 완주한다 (ADR-012) */
function consultDeps(client: GoogleGenAI): ConsultDeps {
  return {
    store,
    createGemini: (onUsage) =>
      new GeminiService({ apiKey: "test-key", onUsage }, client),
    sources: [],
  };
}

describe("consult — usage 배선", () => {
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "anvil-cli-"));
    store = new RunStore(path.join(tmpDir, "anvil.db"));
    stdout = [];
    stderr = [];
  });

  afterEach(() => {
    store.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("mock 응답의 usageMetadata가 에이전트별 usage 행으로 DB에 남는다", async () => {
    const ok = await consult(consultDeps(fakeGenAI(FULL_RUN)), { idea: IDEA }, output());

    expect(ok).toBe(true);

    const [run] = store.listRuns();
    const usage = store.loadRunUsage(run.runId);

    // 호출 6회 = 에이전트 6개 × 1회. 재시도가 없으므로 label 수와 호출 수가 같다
    expect(usage.totalCalls).toBe(6);
    expect(usage.retryCalls).toBe(0);
    expect(usage.byLabel.map((label) => label.label).sort()).toEqual(
      [...RUN_LABELS].sort(),
    );
    // grounded는 context-hunter 하나뿐이다 (토큰과 별개로 요청당 정액 과금된다)
    expect(usage.groundedCalls).toBe(1);
    expect(usage.thoughtsTokens).toBe(6 * USAGE_META.thoughtsTokenCount);
    expect(usage.totalCostUsd).toBeGreaterThan(0);
  });

  it("★ 비용 요약은 stderr로만 나간다 — stdout은 리포트 마크다운뿐이다", async () => {
    await consult(consultDeps(fakeGenAI(FULL_RUN)), { idea: IDEA }, output());

    // stdout: 리포트 원문만. `npm run consult -- "..." > report.md`가 깨지면 안 된다
    const report = stdout.join("\n");
    expect(stdout).toHaveLength(1);
    expect(report).toContain("# [컨설팅 리포트]");
    expect(report).not.toContain("비용 요약");
    expect(report).not.toContain("thinking 비중");
    expect(report).not.toContain("$");

    // stderr: 비용 요약 전체
    const info = stderr.join("\n");
    expect(info).toContain("비용 요약");
    expect(info).toContain("thinking 비중");
    expect(info).toContain("context-hunter");
    expect(info).toContain("추정치이며 실제 청구서가 아니다");
  });

  it("★ step이 실패해도 그 전까지의 usage가 남고 요약이 출력된다 — 실패한 run도 과금됐다", async () => {
    // thesis가 계속 형식을 어긴다 → 3회 재시도 후 step 실패
    const client = fakeGenAI([PLANNER_TEXT, CONTEXT_TEXT], "형식이 틀린 응답");

    const ok = await consult(consultDeps(client), { idea: IDEA }, output());

    expect(ok).toBe(false);

    const [run] = store.listRuns();
    const usage = store.loadRunUsage(run.runId);

    // planner 1 + context-hunter 1 + thesis 3(전부 검증 실패) = 5행.
    // 검증에 실패한 시도도 과금된다 — 세지 않으면 재시도 비용이 장부에서 사라진다
    expect(usage.totalCalls).toBe(5);
    expect(usage.retryCalls).toBe(2);
    expect(
      usage.byLabel.find((label) => label.label === "thesis")?.calls,
    ).toBe(3);

    // 실패한 run에서도 요약이 나온다 — 오히려 그때 비용을 아는 것이 더 중요하다
    const info = stderr.join("\n");
    expect(info).toContain("파이프라인 실행이 실패했다");
    expect(info).toContain("비용 요약");
    expect(info).toContain("재시도 호출    2회");
    expect(stdout).toHaveLength(0);
  });

  it("saveUsage가 throw해도 파이프라인은 완주한다 — 계측이 파이프라인을 죽이지 않는다", async () => {
    vi.spyOn(store, "saveUsage").mockImplementation(() => {
      throw new Error("DB가 죽었다");
    });

    const ok = await consult(consultDeps(fakeGenAI(FULL_RUN)), { idea: IDEA }, output());

    expect(ok).toBe(true);
    expect(stdout.join("\n")).toContain("# [컨설팅 리포트]");

    vi.restoreAllMocks();
  });
});

describe("formatUsageSummary", () => {
  const summary: RunUsageSummary = {
    runId: "run-1",
    totalCostUsd: 0.1234,
    totalTokens: 90_000,
    promptTokens: 60_000,
    cachedTokens: 0,
    outputTokens: 10_000,
    thoughtsTokens: 20_000,
    thoughtsRatio: 20_000 / 30_000,
    groundedCalls: 2,
    totalCalls: 8,
    retryCalls: 1,
    byLabel: [
      {
        label: "cold-critic",
        calls: 2,
        costUsd: 0.08,
        promptTokens: 40_000,
        outputTokens: 6_000,
        thoughtsTokens: 14_000,
      },
      {
        label: "thesis",
        calls: 1,
        costUsd: 0.0434,
        promptTokens: 20_000,
        outputTokens: 4_000,
        thoughtsTokens: 6_000,
      },
    ],
  };

  it("thinking 비중을 눈에 띄게 적는다 — 이 숫자가 thinkingBudget 결정의 근거다", () => {
    expect(formatUsageSummary(summary)).toContain("thinking 비중  66.7%");
  });

  it("label별 호출·토큰·비용과 총계를 적는다", () => {
    const text = formatUsageSummary(summary);

    expect(text).toContain("cold-critic");
    expect(text).toContain("14,000"); // cold-critic의 thinking 토큰
    expect(text).toContain("$0.0800");
    expect(text).toContain("$0.1234"); // 총계
  });

  it("grounded 호출의 정액 요금과 무료 한도를 함께 적는다 — cost_usd는 하한이다", () => {
    const text = formatUsageSummary(summary);

    expect(text).toContain("grounded 호출  2회");
    expect(text).toContain("$0.0700"); // 2 × $0.035
    expect(text).toContain("1,500건/일 무료 한도");
  });

  it("재시도가 있으면 낭비라고 적고, 없으면 조용히 0을 적는다", () => {
    expect(formatUsageSummary(summary)).toContain("재시도 호출    1회  ← 낭비다");
    expect(formatUsageSummary({ ...summary, retryCalls: 0 })).toContain(
      "재시도 호출    0회",
    );
  });

  it("추정치라는 사실을 반드시 적는다 — 진짜 청구서는 Google Cloud 콘솔에 있다", () => {
    expect(formatUsageSummary(summary)).toContain(
      "추정치이며 실제 청구서가 아니다",
    );
  });

  it("호출이 0건이면(구 run·전 step resume) 표 대신 한 줄로 끝낸다", () => {
    const empty: RunUsageSummary = {
      ...summary,
      totalCalls: 0,
      byLabel: [],
      totalCostUsd: 0,
    };

    expect(formatUsageSummary(empty)).toBe(
      "비용 요약: Gemini 호출이 없었다 (usage 기록 0건).",
    );
  });
});
