import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GoogleGenAI } from "@google/genai";
import { openDb } from "../lib/db.js";
import { RunStore } from "../lib/runStore.js";
import { hackerNewsSource, naverSource, youtubeSource } from "../research/sources.js";
import type { ResearchSource } from "../research/types.js";
import { GeminiService } from "../services/gemini.js";
import { HackerNewsService } from "../services/hackerNews.js";
import { NaverService } from "../services/naver.js";
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
/** 본문(text)만 주거나, grounding metadata까지 실은 raw 응답을 준다 */
type FakeResponse = string | { text: string; candidates: unknown[] };

/** SDK는 응답마다 토큰 계측을 실어 보낸다. onUsage를 배선한 테스트만 이것을 읽는다 (ADR-016) */
const USAGE_META = {
  promptTokenCount: 1_000,
  cachedContentTokenCount: 0,
  candidatesTokenCount: 200,
  thoughtsTokenCount: 300,
  totalTokenCount: 1_500,
};

function fakeGenAI(...responses: FakeResponse[]): {
  client: GoogleGenAI;
  generateContent: ReturnType<typeof vi.fn>;
} {
  const generateContent = vi.fn();
  for (const response of responses) {
    generateContent.mockResolvedValueOnce({
      ...(typeof response === "string" ? { text: response } : response),
      usageMetadata: USAGE_META,
    });
  }
  return {
    client: { models: { generateContent } } as unknown as GoogleGenAI,
    generateContent,
  };
}

// ── 최외곽 경계 2: 자료조사 소스들의 HTTP ────────────────────────────
// ★ 세 API가 전부 경로에 "/search"를 포함한다(youtube/v3/search · hn api/v1/search ·
// naver v1/search/cafearticle.json). url.includes("/search")로 가르면 조용히 잘못된 body를
// 먹는다 — host로 먼저 가르고, 모르는 host는 던진다.
const COMMENT_TEXT = "물주기 타이밍을 늘 놓쳐서 결국 죽였어요";
const HN_COMMENT_TEXT = "Reminder apps fire after the plant is already dead.";
const NAVER_SNIPPET = "물주기를 놓쳐서 결국 시들었어요... 다들 어떻게";

const YT_SEARCH = {
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
};

const YT_COMMENT_ID = "UgxPlant1";
const YT_COMMENT_URL = `https://www.youtube.com/watch?v=vid1&lc=${YT_COMMENT_ID}`;

const YT_COMMENTS = {
  items: [
    {
      snippet: {
        topLevelComment: {
          id: YT_COMMENT_ID,
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

const HN_STORIES = {
  hits: [
    {
      objectID: "41",
      title: "Show HN: Plant care assistant",
      url: "https://example.com/plant-app",
      author: "founder",
      points: 120,
      num_comments: 37,
    },
  ],
};

const HN_COMMENTS = {
  hits: [
    {
      objectID: "42",
      comment_text: `<p>${HN_COMMENT_TEXT}`,
      author: "pg",
      story_title: "Show HN: Plant care assistant",
    },
  ],
};

function naverBody(pathname: string): unknown {
  const corpus = pathname.split("/").pop()?.replace(".json", "") ?? "";
  return {
    items: [
      {
        title: "식물 키우기 <b>실패</b> 후기",
        link: `https://cafe.naver.com/${corpus}/1`,
        description: NAVER_SNIPPET,
        cafename: "식물카페",
      },
    ],
  };
}

function jsonResponse(body: unknown): Promise<Response> {
  return Promise.resolve(
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
  );
}

/** host 우선 분기. 미지의 host는 던져서 조용한 오분기를 막는다 */
function researchFetch(): typeof fetch {
  return vi.fn((input: string | URL | Request) => {
    const url = new URL(String(input));
    if (url.host === "www.googleapis.com") {
      return jsonResponse(
        url.pathname.endsWith("/search") ? YT_SEARCH : YT_COMMENTS,
      );
    }
    if (url.host === "hn.algolia.com") {
      return jsonResponse(
        url.searchParams.get("tags")?.startsWith("comment")
          ? HN_COMMENTS
          : HN_STORIES,
      );
    }
    if (url.host === "openapi.naver.com") {
      return jsonResponse(naverBody(url.pathname));
    }
    throw new Error(`예상하지 못한 호스트: ${url.host}`);
  }) as unknown as typeof fetch;
}

/**
 * 지정한 host만 HTTP 에러로 응답하고 나머지 소스는 정상 응답한다.
 * 에러 본문은 세 서비스의 파서를 한 번에 만족시킨다 (YouTube는 error.errors[].reason,
 * 네이버는 errorCode/errorMessage, HN은 status만 본다).
 */
function brokenFetch(status: number, ...hosts: string[]): typeof fetch {
  const healthy = researchFetch();
  return vi.fn((input: string | URL | Request) => {
    if (!hosts.includes(new URL(String(input)).host)) {
      return healthy(input);
    }
    return Promise.resolve(
      new Response(
        JSON.stringify({
          error: { errors: [{ reason: "quotaExceeded" }], message: "quota" },
          errorCode: "012",
          errorMessage: "호출 한도 초과",
        }),
        { status, headers: { "content-type": "application/json" } },
      ),
    );
  }) as unknown as typeof fetch;
}

// ── LLM 응답 원문 ────────────────────────────────────────────────────
// researchPlanner는 pipeline step이 아니라 context-hunter 내부 호출이다 (ADR-012).
// non-grounding 구조화 출력이라 펜스 없는 순수 JSON으로 돌아온다.
const PLANNER_TEXT = JSON.stringify({
  youtube: "식물 키우기 실패담",
  hackernews: "plant care reminder app",
  naver: "화분 물주기 자꾸 까먹어요",
  web: ["홈가드닝 시장 규모", "식물 관리 앱 경쟁 서비스"],
});

// context-hunter는 grounding 모드라 자유 텍스트(펜스 두른 JSON)로 돌아온다.
// 값 없는 선택 필드를 키 생략이 아니라 명시적 null로 내보내는, 실측된 실패 형태 그대로다.
//
// 목소리는 ID로만 고른다 (ADR-013). 수집 순서(전역 연번)는
// V1 = YouTube 댓글 / V2 = HN 댓글 / V3 = HN 스토리 / V4~V6 = 네이버(cafearticle·kin·blog)다.
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
  "communityVoiceRefs": ["V1", "V2", "V4"],
  "painPointEvidence": ["물주기 실패로 식물을 죽인 경험"],
  "sources": ["https://example.com/trend"]
}
\`\`\``;

// SDK가 응답에 실어 보내는 grounding 인용. 코드(gemini.ts)가 이걸 읽어 citations로 주입한다 (ADR-012).
// uri 없는 chunk가 섞여 오는 것이 실측된 형태다 — 그건 인용으로 쓸 수 없어 드롭돼야 한다.
const CONTEXT_RESPONSE = {
  text: CONTEXT_TEXT,
  candidates: [
    {
      groundingMetadata: {
        groundingChunks: [
          {
            web: {
              uri: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/x",
              title: "홈가드닝 시장 리포트",
            },
          },
          { web: {} },
        ],
        webSearchQueries: ["홈가드닝 시장 규모"],
      },
    },
  ],
};

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

/** CLI의 buildResearchSources와 동일한 3소스 구성 (키가 전부 있는 경우) */
function researchSources(fetchFn: typeof fetch): ResearchSource[] {
  return [
    youtubeSource(new YoutubeService({ apiKey: "test-key", fetchFn })),
    hackerNewsSource(new HackerNewsService({ fetchFn })),
    naverSource(
      new NaverService({
        clientId: "test-id",
        clientSecret: "test-secret",
        fetchFn,
      }),
    ),
  ];
}

function deps(client: GoogleGenAI, fetchFn: typeof fetch): PipelineDeps {
  return {
    store,
    gemini: new GeminiService({ apiKey: "test-key" }, client),
    sources: researchSources(fetchFn),
    log: () => undefined,
  };
}

/** 저장된 바이트를 그대로 읽는다 — RunStore의 zod 검증을 우회해야 default([])와 실제 값을 구별한다 */
function rawArtifact(runId: string, kind: string): string {
  const db = openDb(path.join(tmpDir, "anvil.db"));
  try {
    const row = db
      .prepare("SELECT content FROM artifacts WHERE run_id = ? AND kind = ?")
      .get(runId, kind) as { content: string } | undefined;
    if (row === undefined) {
      throw new Error(`artifact 없음: ${runId}/${kind}`);
    }
    return row.content;
  } finally {
    db.close();
  }
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "anvil-e2e-"));
  store = new RunStore(path.join(tmpDir, "anvil.db"));
});

afterEach(() => {
  store.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe("E2E: 아이디어 → 리포트 (CLI 흐름)", () => {
  it("전 구간을 재시도 없이 완주하고 리포트를 남긴다", async () => {
    const { client, generateContent } = fakeGenAI(
      PLANNER_TEXT,
      CONTEXT_RESPONSE,
      THESIS_TEXT,
      CRITICISM_TEXT,
      SOLUTION_TEXT,
      VERDICT_TEXT,
    );

    const result = await runPipeline(deps(client, researchFetch()), { idea: IDEA });

    expect(result.status).toBe("completed");

    // step당 정확히 1회 + researchPlanner 1회 — 재시도가 끼면 초과한다.
    // planner는 pipeline step이 아니라 context-hunter 내부 호출이라 ALL_STEPS에 없다 (ADR-012).
    expect(generateContent).toHaveBeenCalledTimes(ALL_STEPS.length + 1);

    // 리포트가 저장소에 실제로 있고, 5개 섹션과 원문 댓글을 담고 있다
    const report = store.loadReport(result.runId);
    expect(report).not.toBeNull();
    expect(report).toContain("# [컨설팅 리포트] AI 반려식물 관리 서비스");
    expect(report).toContain("## 1. 시장 맥락 (Context)");
    expect(report).toContain("## 2. 낙관적 가설 (正 / Thesis)");
    expect(report).toContain("## 3. 냉정한 비판 (反 / Antithesis)");
    expect(report).toContain("## 4. 인사이트 및 재설계 (合 / Synthesis)");
    expect(report).toContain(COMMENT_TEXT);

    // runs·steps가 단일 진실 공급원 — 전 step이 completed고 run이 종료됐다 (ADR-014)
    const state = RunStateSchema.parse(store.loadRun(result.runId));
    expect(state.completedAt).toBeDefined();
    expect(
      ALL_STEPS.map((name) => state.steps.find((s) => s.name === name)?.status),
    ).toEqual(ALL_STEPS.map(() => "completed"));

    // 모든 step 산출물이 디스크에 남아 스키마 검증을 통과한다 (resume 가능 상태)
    expect(
      store.loadStepOutput(result.runId, "verdict", VerdictSchema),
    ).not.toBeNull();
  });

  it("세 소스의 수집 결과가 grounding 프롬프트에 실리고 context.json까지 살아남는다", async () => {
    const { client, generateContent } = fakeGenAI(
      PLANNER_TEXT,
      CONTEXT_RESPONSE,
      THESIS_TEXT,
      CRITICISM_TEXT,
      SOLUTION_TEXT,
      VERDICT_TEXT,
    );

    const result = await runPipeline(deps(client, researchFetch()), { idea: IDEA });

    // 수집 → 프롬프트: 세 소스의 원문이 context-hunter의 grounding 호출(planner 다음)에 들어간다
    const contextPrompt = (
      generateContent.mock.calls[1][0] as { contents: string }
    ).contents;
    expect(contextPrompt).toContain(COMMENT_TEXT);
    expect(contextPrompt).toContain(HN_COMMENT_TEXT);
    expect(contextPrompt).toContain(NAVER_SNIPPET);

    // 프롬프트 → 산출물: LLM이 고른 ID(V1·V2·V4)가 세 소스의 목소리로 복원돼 디스크까지 간다
    const context = store.loadStepOutput(
      result.runId,
      "context-hunter",
      MarketContextSchema,
    );
    expect(context?.communityVoices.map((voice) => voice.source)).toEqual([
      "youtube",
      "hackernews",
      "naver",
    ]);
    // 네이버 항목은 잘린 검색 스니펫이라는 표시를 달고 온다 (완결된 원문 인용이 아니다)
    expect(context?.communityVoices[2].extra).toBe("검색 스니펫");
  });

  // ADR-013 — 이 phase의 핵심. 모델은 코드가 준 URL조차 다시 타이핑하면 망가뜨린다
  // (실제 산출물에 cloud.google.google.com 오타가 남아 있다). 그래서 URL을 보여주지 않는다.
  it("★ 목소리의 URL은 프롬프트에 없고, 산출물에는 수집기가 만든 원본이 들어간다", async () => {
    const { client, generateContent } = fakeGenAI(
      PLANNER_TEXT,
      CONTEXT_RESPONSE,
      THESIS_TEXT,
      CRITICISM_TEXT,
      SOLUTION_TEXT,
      VERDICT_TEXT,
    );

    const result = await runPipeline(deps(client, researchFetch()), { idea: IDEA });

    // 프롬프트에는 원문·ID만 있고 URL이 없다 — 모델이 볼 수 없는 URL은 받아적을 수도 없다
    const contextPrompt = (
      generateContent.mock.calls[1][0] as { contents: string }
    ).contents;
    expect(contextPrompt).toContain("[V1]");
    expect(contextPrompt).not.toContain("https://www.youtube.com/watch?v=vid1");
    expect(contextPrompt).not.toContain("https://news.ycombinator.com");

    // LLM은 ID만 골랐는데, 디스크에는 수집기가 만든 URL·작성자·인기도가 통째로 들어 있다
    const context = store.loadStepOutput(
      result.runId,
      "context-hunter",
      MarketContextSchema,
    );
    // url은 영상이 아니라 댓글 퍼머링크다 — 독자가 인용된 그 댓글로 바로 갈 수 있다
    expect(context?.communityVoices[0]).toEqual({
      source: "youtube",
      title: "식물 키우기 실패담",
      url: YT_COMMENT_URL,
      text: COMMENT_TEXT,
      authorName: "초보집사",
      score: 42,
    });

    // context.json의 목소리는 research.json 수집물의 부분집합이다
    const evidence = store.loadResearchEvidence(result.runId);
    expect(evidence?.voices).toEqual(
      expect.arrayContaining(context?.communityVoices ?? []),
    );
  });

  it("grounding 응답의 인용이 코드 추출을 거쳐 저장된 context 산출물에 남는다", async () => {
    const { client } = fakeGenAI(
      PLANNER_TEXT,
      CONTEXT_RESPONSE,
      THESIS_TEXT,
      CRITICISM_TEXT,
      SOLUTION_TEXT,
      VERDICT_TEXT,
    );

    const result = await runPipeline(deps(client, researchFetch()), { idea: IDEA });

    // 저장소에 실제로 쓰인 원문(artifacts.content)을 본다 —
    // 스키마 default([])가 빈 배열을 채워 통과하는 것과 구별하기 위해 별도 커넥션으로 바이트를 읽는다
    const context = MarketContextSchema.parse(
      JSON.parse(rawArtifact(result.runId, "context")),
    );

    // uri 없는 chunk는 드롭되므로 2개 chunk 중 1건만 남는다.
    // 검색 chunk가 실어온 uri는 만료되는 리다이렉트다 — kind가 그 사실을 남긴다 (ADR-013)
    expect(context.citations).toEqual([
      {
        uri: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/x",
        title: "홈가드닝 시장 리포트",
        kind: "redirect",
      },
    ]);
    // LLM 자기보고 sources는 대체되지 않고 공존한다 (실패 모드가 상보적이다 — ADR-012)
    expect(context.sources).toEqual(["https://example.com/trend"]);
  });

  it("LLM이 선택 필드에 null을 넣어도 시장조사가 통과한다 (키 부재로 정규화)", async () => {
    const { client } = fakeGenAI(
      PLANNER_TEXT,
      CONTEXT_RESPONSE,
      THESIS_TEXT,
      CRITICISM_TEXT,
      SOLUTION_TEXT,
      VERDICT_TEXT,
    );

    const result = await runPipeline(deps(client, researchFetch()), { idea: IDEA });

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
  });

  it("YouTube가 quota로 실패해도 나머지 두 소스로 완주한다", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { client, generateContent } = fakeGenAI(
      PLANNER_TEXT,
      CONTEXT_RESPONSE,
      THESIS_TEXT,
      CRITICISM_TEXT,
      SOLUTION_TEXT,
      VERDICT_TEXT,
    );

    const result = await runPipeline(
      deps(client, brokenFetch(403, "www.googleapis.com")),
      { idea: IDEA },
    );

    expect(result.status).toBe("completed");
    // 죽은 소스만 빠진다 — 살아있는 HN·네이버 원문은 그대로 프롬프트에 실린다
    const contextPrompt = (
      generateContent.mock.calls[1][0] as { contents: string }
    ).contents;
    expect(contextPrompt).not.toContain(COMMENT_TEXT);
    expect(contextPrompt).toContain(HN_COMMENT_TEXT);
    expect(contextPrompt).toContain(NAVER_SNIPPET);
  });

  it("Hacker News와 네이버가 429로 실패해도 파이프라인이 완주한다", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { client } = fakeGenAI(
      PLANNER_TEXT,
      CONTEXT_RESPONSE,
      THESIS_TEXT,
      CRITICISM_TEXT,
      SOLUTION_TEXT,
      VERDICT_TEXT,
    );

    const result = await runPipeline(
      deps(client, brokenFetch(429, "hn.algolia.com", "openapi.naver.com")),
      { idea: IDEA },
    );

    expect(result.status).toBe("completed");
    expect(
      store.loadStepOutput(result.runId, "context-hunter", MarketContextSchema),
    ).not.toBeNull();
    expect(store.loadReport(result.runId)).not.toBeNull();
  });

  it("모든 소스가 실패해도 웹검색만으로 완주한다", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { client } = fakeGenAI(
      PLANNER_TEXT,
      CONTEXT_RESPONSE,
      THESIS_TEXT,
      CRITICISM_TEXT,
      SOLUTION_TEXT,
      VERDICT_TEXT,
    );

    const result = await runPipeline(
      deps(
        client,
        brokenFetch(
          503,
          "www.googleapis.com",
          "hn.algolia.com",
          "openapi.naver.com",
        ),
      ),
      { idea: IDEA },
    );

    expect(result.status).toBe("completed");
    expect(store.loadReport(result.runId)).not.toBeNull();
  });
});

describe("E2E: 비용 계측 (ADR-016)", () => {
  /**
   * usage를 적으려면 runId가 첫 Gemini 호출보다 먼저 확정돼야 한다 — CLI가 하는 것과
   * 같은 순서다(createRun 선생성 → resume). GeminiService는 여전히 runId도 DB도 모른다.
   */
  function depsWithUsage(
    client: GoogleGenAI,
    fetchFn: typeof fetch,
    runId: string,
  ): PipelineDeps {
    return {
      store,
      gemini: new GeminiService(
        {
          apiKey: "test-key",
          onUsage: (usage) => store.saveUsage(runId, usage),
        },
        client,
      ),
      sources: researchSources(fetchFn),
      log: () => undefined,
    };
  }

  it("완주한 run의 usage에 gemini를 부른 에이전트 수만큼 label이 남는다", async () => {
    const { client } = fakeGenAI(
      PLANNER_TEXT,
      CONTEXT_RESPONSE,
      THESIS_TEXT,
      CRITICISM_TEXT,
      SOLUTION_TEXT,
      VERDICT_TEXT,
    );
    const { runId } = store.createRun(IDEA);

    const result = await runPipeline(depsWithUsage(client, researchFetch(), runId), {
      idea: IDEA,
      resumeRunId: runId,
    });

    expect(result.status).toBe("completed");

    const usage = store.loadRunUsage(runId);
    // step 5개 + research-planner 1개. planner는 step이 아니지만 gemini를 부르므로 장부에 남는다
    expect(usage.byLabel.map((label) => label.label).sort()).toEqual([
      "cold-critic",
      "context-hunter",
      "research-planner",
      "solution-designer",
      "thesis",
      "verdict",
    ]);
    expect(usage.totalCalls).toBe(ALL_STEPS.length + 1);
    expect(usage.retryCalls).toBe(0);
    expect(usage.totalCostUsd).toBeGreaterThan(0);
  });

  it("★ step이 실패해도 그때까지의 usage가 남는다 — 실패한 run도 과금됐다", async () => {
    // thesis가 3회 모두 형식을 어긴다 → thesis step 실패
    const { client } = fakeGenAI(
      PLANNER_TEXT,
      CONTEXT_RESPONSE,
      "형식이 틀렸다",
      "형식이 틀렸다",
      "형식이 틀렸다",
    );
    const { runId } = store.createRun(IDEA);

    await expect(
      runPipeline(depsWithUsage(client, researchFetch(), runId), {
        idea: IDEA,
        resumeRunId: runId,
      }),
    ).rejects.toThrow(PipelineStepError);

    const usage = store.loadRunUsage(runId);
    // 검증에 실패한 3회의 thesis 시도도 전부 과금됐다 — 세지 않으면 재시도 비용이 장부에서 사라진다
    expect(usage.byLabel.find((label) => label.label === "thesis")?.calls).toBe(3);
    expect(usage.totalCalls).toBe(5);
    expect(usage.retryCalls).toBe(2);
  });
});

describe("E2E: 웹 인터뷰 흐름 (waiting → 답변 → resume)", () => {
  it("질문에서 멈췄다가 답변을 받아 리포트까지 완주한다", async () => {
    const questionsText = JSON.stringify({
      questions: [{ id: "q1", question: "타겟 유저는 누구인가?", why: null }],
    });
    const { client } = fakeGenAI(
      questionsText,
      PLANNER_TEXT,
      CONTEXT_RESPONSE,
      THESIS_TEXT,
      CRITICISM_TEXT,
      SOLUTION_TEXT,
      VERDICT_TEXT,
    );
    const d = deps(client, researchFetch());

    // 웹에서 생성된 run만 인터뷰를 켠다
    const { runId } = store.createRun(IDEA, { interview: true });

    const paused = await runPipeline(d, { idea: IDEA, resumeRunId: runId });
    expect(paused.status).toBe("waiting");
    expect(paused.report).toBeUndefined();
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
    expect(store.loadReport(runId)).not.toBeNull();
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
        {
          apiKey: "test-key",
          maxRetries: 1,
          timeoutMs: 20,
          groundedMaxRetries: 1,
          groundedTimeoutMs: 20,
        },
        client,
      ),
      sources: researchSources(researchFetch()),
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

    // steps에 error로 기록돼야 resume이 성립한다 (pending 고착 = 재개 불가)
    const state = store.loadRun(stepError.runId);
    const step = state.steps.find((s) => s.name === "context-hunter");
    expect(step?.status).toBe("error");
    expect(step?.failedAt).toBeDefined();
  });
});

describe("자료조사 fetch mock (host 분기 계약)", () => {
  // 세 API가 전부 "/search"를 경로에 갖는다. 경로로 가르면 HN·네이버 요청이 YouTube 응답을
  // 조용히 받아 먹는다 — step 9에서 소스를 켤 때 그 오분기가 테스트를 통과해 버린다.
  it("host로 분기해 소스별 응답을 준다", async () => {
    const fetchFn = researchFetch();

    const yt = await fetchFn(
      "https://www.googleapis.com/youtube/v3/search?q=x",
    ).then((r) => r.json() as Promise<typeof YT_SEARCH>);
    const hn = await fetchFn(
      "https://hn.algolia.com/api/v1/search?query=x&tags=comment",
    ).then((r) => r.json() as Promise<typeof HN_COMMENTS>);
    const naver = await fetchFn(
      "https://openapi.naver.com/v1/search/cafearticle.json?query=x",
    ).then((r) => r.json() as Promise<{ items: { link: string }[] }>);

    expect(yt.items[0].id.videoId).toBe("vid1");
    expect(hn.hits[0].comment_text).toContain(HN_COMMENT_TEXT);
    expect(naver.items[0].link).toContain("cafearticle");
  });

  it("모르는 host는 던진다 (조용한 오분기 방지)", () => {
    const fetchFn = researchFetch();

    expect(() => fetchFn("https://example.com/v1/search")).toThrow(
      /예상하지 못한 호스트/,
    );
  });
});
