import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GoogleGenAI } from "@google/genai";
import { RunStore } from "../lib/runStore.js";
import { GeminiService } from "../services/gemini.js";
import { YoutubeService } from "../services/youtube.js";
import {
  MarketContextSchema,
  RunStateSchema,
  VerdictSchema,
  type PipelineStepName,
} from "../types/index.js";
import { PipelineStepError, runPipeline, type PipelineDeps } from "./orchestrator.js";

/**
 * End-to-end: 아이디어 한 줄 → 리포트 마크다운까지 파이프라인 전 구간을 실제로 태운다.
 *
 * 가짜는 최외곽 경계(HTTP fetch, GenAI SDK 클라이언트)에만 둔다. GeminiService·
 * YoutubeService·에이전트·오케스트레이터·RunStore는 모두 진짜다. GeminiService를
 * mock하는 단위 테스트는 "LLM 원문 → 파싱 → zod 검증" 구간을 통째로 건너뛰므로,
 * 시장조사를 깨뜨린 부류의 버그(선택 필드에 들어온 null)를 구조적으로 잡지 못한다.
 */

const IDEA = "AI 반려식물 관리 서비스";

// ── 최외곽 경계 1: Gemini SDK 클라이언트 ─────────────────────────────
function fakeGenAI(...texts: string[]): {
  client: GoogleGenAI;
  generateContent: ReturnType<typeof vi.fn>;
} {
  const generateContent = vi.fn();
  for (const text of texts) {
    generateContent.mockResolvedValueOnce({ text });
  }
  return {
    client: { models: { generateContent } } as unknown as GoogleGenAI,
    generateContent,
  };
}

// ── 최외곽 경계 2: YouTube HTTP ──────────────────────────────────────
const COMMENT_TEXT = "물주기 타이밍을 늘 놓쳐서 결국 죽였어요";

function youtubeFetch(): typeof fetch {
  return vi.fn((input: string | URL | Request) => {
    const url = String(input);
    const body = url.includes("/search")
      ? {
          items: [
            {
              id: { videoId: "vid1" },
              snippet: {
                title: "식물 키우기 실패담",
                channelTitle: "플랜트TV",
                description: "초보자가 식물을 죽이는 이유",
              },
            },
          ],
        }
      : {
          items: [
            {
              snippet: {
                topLevelComment: {
                  snippet: {
                    textOriginal: COMMENT_TEXT,
                    authorDisplayName: "초보집사",
                    likeCount: 42,
                  },
                },
              },
            },
          ],
        };
    return Promise.resolve(
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
  }) as unknown as typeof fetch;
}

// ── LLM 응답 원문 ────────────────────────────────────────────────────
// context-hunter는 grounding 모드라 자유 텍스트(펜스 두른 JSON)로 돌아온다.
// 값 없는 선택 필드를 키 생략이 아니라 명시적 null로 내보내는, 실측된 실패 형태 그대로다.
const CONTEXT_TEXT = `조사 결과를 정리했습니다.

\`\`\`json
{
  "ideaTitle": "AI 반려식물 관리 서비스",
  "briefing": "홈가드닝 시장은 성장 중이나 무료 리마인더 앱이 이미 진입로를 선점했다.",
  "marketSizeIndicators": ["국내 홈가드닝 시장 연 10% 성장"],
  "competitorInsight": "리마인더 기능은 평준화됐고 경쟁은 진단 정확도에서 벌어진다.",
  "voicesInsight": "유저는 늦은 감지를 가장 큰 고통으로 말한다.",
  "trends": ["홈가드닝 시장 성장"],
  "competitors": [
    { "name": "Planta", "description": "식물 관리 앱", "url": null, "pricingHint": null }
  ],
  "youtubeVoices": [
    {
      "videoTitle": "식물 키우기 실패담",
      "videoUrl": "https://www.youtube.com/watch?v=vid1",
      "comment": "${COMMENT_TEXT}",
      "authorName": null,
      "likeCount": null
    }
  ],
  "painPointEvidence": ["물주기 실패로 식물을 죽인 경험"],
  "sources": ["https://example.com/trend"]
}
\`\`\``;

const THESIS_TEXT = JSON.stringify({
  points: [
    {
      id: "t1",
      axis: "painPoint",
      claim: "식물을 죽인 경험은 반복되는 고통이다",
      rationale: "댓글에 물주기 실패담이 반복 등장한다",
    },
    {
      id: "t2",
      axis: "bm",
      claim: "실패 방지에는 지불 의사가 생긴다",
      rationale: "Planta가 유료 구독으로 시장을 검증했다",
    },
    {
      id: "t3",
      axis: "copycat",
      claim: "가정별 생육 데이터가 해자가 된다",
      rationale: "경쟁 앱은 개별 환경 데이터를 축적하지 않는다",
    },
  ],
  revenueModel: "무료 진단 후 케어 플랜 구독 전환",
  growthLevers: ["공유 바이럴 루프"],
  marketTailwinds: ["홈가드닝 시장 성장"],
  bestCaseScenario: "2년 내 구독 전환율 8% 달성",
  winningThesis: "실패 없는 케어 가치가 유료 전환을 이끈다",
});

// rebuts는 선택 필드다 — 여기서도 LLM은 null을 내보낸다
const CRITICISM_TEXT = JSON.stringify({
  points: [
    {
      id: "c1",
      axis: "painPoint",
      rebuts: "t1",
      claim: "고통의 빈도가 낮아 지불로 이어지지 않는다",
      evidence: "식물은 주에 한 번 관리하면 된다",
      severity: "major",
      riskScore: 55,
      riskKeyword: "저빈도 고통",
    },
    {
      id: "c2",
      axis: "bm",
      rebuts: null,
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
      claim: "대형 앱이 즉시 복제 가능하다",
      evidence: "진단 모델은 오픈소스로 대체된다",
      severity: "minor",
      riskScore: 20,
      riskKeyword: "복제 용이",
    },
  ],
  verdict: "저빈도 고통과 이탈률이 수익 모델의 급소다",
});

const SOLUTION_TEXT = JSON.stringify({
  minimalInput: "식물 사진 1장",
  agenticWorkflow: "사진 진단 → 케어 플랜 생성 → 이상 감지 알림",
  dataFlywheel: "가정별 생육 로그가 진단 정확도를 높인다",
  monetization: "진단은 무료, 케어 플랜 구독 월 4,900원",
  revisedConcept: "리마인더가 아니라 조기 진단으로 축을 옮긴다",
  synthesis: null,
});

const VERDICT_TEXT = JSON.stringify({
  survivalScore: 55,
  recommendation: "pivot",
  headline: "고통 빈도를 올리는 축으로 피벗하면 생존한다",
  rationale: "진단 정확도는 해자가 되지만 구독 이탈이 남는다",
  residualRisks: [
    { keyword: "이탈률", severity: "major", note: "식물 사망 시 구독 이유가 소멸한다" },
  ],
  conditions: ["재구매 유저의 케어 플랜 유지율 40% 이상"],
});

const ALL_STEPS: PipelineStepName[] = [
  "context-hunter",
  "thesis",
  "cold-critic",
  "solution-designer",
  "verdict",
];

// ── 하네스 ──────────────────────────────────────────────────────────
let tmpDir: string;
let store: RunStore;

function deps(client: GoogleGenAI, fetchFn: typeof fetch): PipelineDeps {
  return {
    store,
    gemini: new GeminiService({ apiKey: "test-key" }, client),
    youtube: new YoutubeService({ apiKey: "test-key", fetchFn }),
    log: () => undefined,
  };
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "anvil-e2e-"));
  store = new RunStore(tmpDir);
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe("E2E: 아이디어 → 리포트 (CLI 흐름)", () => {
  it("전 구간을 재시도 없이 완주하고 리포트를 남긴다", async () => {
    const { client, generateContent } = fakeGenAI(
      CONTEXT_TEXT,
      THESIS_TEXT,
      CRITICISM_TEXT,
      SOLUTION_TEXT,
      VERDICT_TEXT,
    );

    const result = await runPipeline(deps(client, youtubeFetch()), { idea: IDEA });

    expect(result.status).toBe("completed");

    // step당 정확히 1회 — 재시도가 끼면 초과한다. 검증이 첫 응답에서 통과했다는 뜻.
    expect(generateContent).toHaveBeenCalledTimes(ALL_STEPS.length);

    // 리포트가 디스크에 실제로 있고, 5개 섹션과 원문 댓글을 담고 있다
    expect(result.reportPath).toBeDefined();
    const report = fs.readFileSync(result.reportPath as string, "utf8");
    expect(report).toContain("# [컨설팅 리포트] AI 반려식물 관리 서비스");
    expect(report).toContain("## 1. 시장 맥락 (Context)");
    expect(report).toContain("## 2. 낙관적 가설 (正 / Thesis)");
    expect(report).toContain("## 3. 냉정한 비판 (反 / Antithesis)");
    expect(report).toContain("## 4. 인사이트 및 재설계 (合 / Synthesis)");
    expect(report).toContain(COMMENT_TEXT);

    // state.json이 단일 진실 공급원 — 전 step이 completed고 run이 종료됐다
    const state = RunStateSchema.parse(
      JSON.parse(
        fs.readFileSync(path.join(tmpDir, result.runId, "state.json"), "utf8"),
      ),
    );
    expect(state.completedAt).toBeDefined();
    expect(
      ALL_STEPS.map((name) => state.steps.find((s) => s.name === name)?.status),
    ).toEqual(ALL_STEPS.map(() => "completed"));

    // 모든 step 산출물이 디스크에 남아 스키마 검증을 통과한다 (resume 가능 상태)
    expect(
      store.loadStepOutput(result.runId, "verdict", VerdictSchema),
    ).not.toBeNull();
  });

  it("LLM이 선택 필드에 null을 넣어도 시장조사가 통과한다 (키 부재로 정규화)", async () => {
    const { client } = fakeGenAI(
      CONTEXT_TEXT,
      THESIS_TEXT,
      CRITICISM_TEXT,
      SOLUTION_TEXT,
      VERDICT_TEXT,
    );

    const result = await runPipeline(deps(client, youtubeFetch()), { idea: IDEA });

    const context = store.loadStepOutput(
      result.runId,
      "context-hunter",
      MarketContextSchema,
    );
    // null이 실린 선택 필드는 '값 없음'으로 살아남는다 — 에러가 아니라 부재여야 한다
    expect(context?.competitors[0]).toEqual({
      name: "Planta",
      description: "식물 관리 앱",
    });
    expect(context?.youtubeVoices[0].authorName).toBeUndefined();
    expect(context?.youtubeVoices[0].likeCount).toBeUndefined();
  });

  it("YouTube가 quota로 실패해도 웹검색만으로 완주한다", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const quotaFetch = vi.fn(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            error: { errors: [{ reason: "quotaExceeded" }], message: "quota" },
          }),
          { status: 403, headers: { "content-type": "application/json" } },
        ),
      ),
    ) as unknown as typeof fetch;
    const { client } = fakeGenAI(
      CONTEXT_TEXT,
      THESIS_TEXT,
      CRITICISM_TEXT,
      SOLUTION_TEXT,
      VERDICT_TEXT,
    );

    const result = await runPipeline(deps(client, quotaFetch), { idea: IDEA });

    expect(result.status).toBe("completed");
  });
});

describe("E2E: 웹 인터뷰 흐름 (waiting → 답변 → resume)", () => {
  it("질문에서 멈췄다가 답변을 받아 리포트까지 완주한다", async () => {
    const questionsText = JSON.stringify({
      questions: [{ id: "q1", question: "타겟 유저는 누구인가?", why: null }],
    });
    const { client } = fakeGenAI(
      questionsText,
      CONTEXT_TEXT,
      THESIS_TEXT,
      CRITICISM_TEXT,
      SOLUTION_TEXT,
      VERDICT_TEXT,
    );
    const d = deps(client, youtubeFetch());

    // 웹에서 생성된 run만 인터뷰를 켠다
    const { runId } = store.createRun(IDEA, { interview: true });

    const paused = await runPipeline(d, { idea: IDEA, resumeRunId: runId });
    expect(paused.status).toBe("waiting");
    expect(paused.reportPath).toBeUndefined();
    // 답변 대기는 에러가 아니다
    expect(
      paused.state.steps.find((s) => s.name === "interviewer")?.status,
    ).toBe("waiting");

    store.saveInterviewAnswers(runId, {
      answers: [{ questionId: "q1", answer: "식물을 자주 죽이는 3040 직장인" }],
    });

    const resumed = await runPipeline(d, { idea: IDEA, resumeRunId: runId });

    expect(resumed.status).toBe("completed");
    expect(resumed.runId).toBe(runId);
    expect(fs.existsSync(resumed.reportPath as string)).toBe(true);
  });
});

describe("E2E: 장애 내성", () => {
  it("Gemini가 응답 없이 hang하면 step이 pending에 고착되지 않고 에러로 끝난다", async () => {
    // 영원히 정착하지 않는 응답 — 실제 네트워크 hang
    const generateContent = vi.fn().mockReturnValue(new Promise(() => undefined));
    const client = { models: { generateContent } } as unknown as GoogleGenAI;
    const hangingDeps: PipelineDeps = {
      store,
      gemini: new GeminiService(
        { apiKey: "test-key", maxRetries: 1, timeoutMs: 20 },
        client,
      ),
      youtube: new YoutubeService({ apiKey: "test-key", fetchFn: youtubeFetch() }),
      log: () => undefined,
    };

    const error = await runPipeline(hangingDeps, { idea: IDEA }).catch(
      (e: unknown) => e,
    );

    // resume 안내를 할 수 있도록 runId를 실어 실패한다
    expect(error).toBeInstanceOf(PipelineStepError);
    const stepError = error as PipelineStepError;
    expect(stepError.step).toBe("context-hunter");
    expect(stepError.message).toMatch(/시간 초과/);

    // state.json에 error로 기록돼야 resume이 성립한다 (pending 고착 = 재개 불가)
    const state = store.loadRun(stepError.runId);
    const step = state.steps.find((s) => s.name === "context-hunter");
    expect(step?.status).toBe("error");
    expect(step?.failedAt).toBeDefined();
  });
});
