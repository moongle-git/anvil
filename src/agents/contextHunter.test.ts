import { afterEach, describe, expect, it, vi } from "vitest";
import type { ResearchSource } from "../research/types.js";
import type { GeminiService } from "../services/gemini.js";
import type {
  Citation,
  CommunityVoice,
  ResearchSourceId,
  SearchQueries,
} from "../types/index.js";
import {
  CODE_INJECTED_CONTEXT_KEYS,
  MarketContextDraftSchema,
  MarketContextObjectSchema,
  SearchQueriesSchema,
  SOURCE_LABELS,
  type MarketContextDraft,
} from "../types/index.js";
import {
  CONTEXT_HUNTER_PROMPT_TEMPLATE,
  CONTEXT_HUNTER_SYSTEM_PROMPT,
  runContextHunter,
  type ContextHunterDeps,
} from "./contextHunter.js";

const IDEA = "반려견 산책 대행 매칭 서비스";

/** LLM이 채우는 부분 — citations는 여기에 없다 (코드가 주입한다) */
const DRAFT: MarketContextDraft = {
  ideaTitle: "반려견 산책 대행 매칭 서비스",
  briefing:
    "1인 가구 반려동물 양육이 늘며 펫 시장이 성장 중이다. 도그메이트 등 매칭 플랫폼이 이미 자리잡았다.",
  marketSizeIndicators: ["1인 가구 반려동물 양육 가구 지속 증가"],
  competitorInsight:
    "매칭 기능 자체는 평준화됐고, 경쟁은 산책자 신뢰도 검증에서 벌어진다.",
  voicesInsight:
    "반려인은 산책 대행 자체보다 '내가 못 해준다'는 죄책감을 더 크게 말한다.",
  trends: ["펫 시장 성장"],
  competitors: [{ name: "도그메이트", description: "펫시터 매칭" }],
  communityVoices: [
    {
      source: "youtube",
      title: "강아지 산책 브이로그",
      url: "https://www.youtube.com/watch?v=abc123",
      text: "산책 시킬 시간이 없어서 너무 미안해요...",
    },
  ],
  painPointEvidence: ["바쁜 직장인은 산책 시간 확보가 어렵다"],
  sources: ["https://example.com/pet-market"],
};

/** 코드가 grounding 응답에서 추출한 인용 */
const CITATIONS: Citation[] = [
  {
    uri: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/abc",
    title: "펫 시장 리포트",
    domain: "example.com",
  },
];

const SEARCH_QUERIES = ["반려견 산책 대행 서비스"];

const YOUTUBE_VOICE: CommunityVoice = {
  source: "youtube",
  title: "강아지 산책 브이로그",
  url: "https://www.youtube.com/watch?v=abc123",
  text: "산책 시킬 시간이 없어서 너무 미안해요...",
  authorName: "집사",
  score: 12,
};

const NAVER_VOICE: CommunityVoice = {
  source: "naver",
  title: "산책 대행 후기",
  url: "https://cafe.naver.com/dog/1",
  text: "펫시터 구하기가 생각보다 어렵네요...",
  extra: "검색 스니펫",
};

/** collectAll이 실패를 흡수하므로, 어댑터는 그대로 throw한다 */
function fakeSource(
  id: ResearchSourceId,
  result: CommunityVoice[] | Error,
): ResearchSource {
  return {
    id,
    label: SOURCE_LABELS[id],
    collect:
      result instanceof Error
        ? vi.fn().mockRejectedValue(result)
        : vi.fn().mockResolvedValue(result),
  };
}

/** researchPlanner 산출물 — 소스마다 다른 검색어다. 아이디어 원문(IDEA)이 아니다 */
const PLANNED_QUERIES: SearchQueries = {
  youtube: "강아지 산책 대행 후기",
  hackernews: "dog walking marketplace",
  naver: "산책 대행 맡겨보신 분",
  web: ["반려동물 산책 대행 시장 규모", "펫시터 매칭 서비스 경쟁"],
};

interface FakeDeps {
  deps: ContextHunterDeps;
  /** researchPlanner(non-grounding)의 호출 경로 */
  generateStructured: ReturnType<typeof vi.fn>;
  generateGrounded: ReturnType<typeof vi.fn>;
  log: ReturnType<typeof vi.fn>;
}

function fakeDeps(
  sources: ResearchSource[],
  plannerError?: Error,
): FakeDeps {
  const generateStructured =
    plannerError === undefined
      ? vi.fn().mockResolvedValue(PLANNED_QUERIES)
      : vi.fn().mockRejectedValue(plannerError);
  const generateGrounded = vi.fn().mockResolvedValue({
    data: DRAFT,
    citations: CITATIONS,
    webSearchQueries: SEARCH_QUERIES,
  });
  const log = vi.fn();

  return {
    deps: {
      gemini: {
        generateStructured,
        generateGrounded,
      } as unknown as GeminiService,
      sources,
      log,
    },
    generateStructured,
    generateGrounded,
    log,
  };
}

function promptOf(generateGrounded: ReturnType<typeof vi.fn>): string {
  return generateGrounded.mock.calls[0][0].prompt as string;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("runContextHunter (정상 흐름)", () => {
  it("등록된 모든 소스를 수집해 프롬프트에 담고 grounding 모드로 Gemini를 호출한다", async () => {
    const youtube = fakeSource("youtube", [YOUTUBE_VOICE]);
    const naver = fakeSource("naver", [NAVER_VOICE]);
    const { deps, generateGrounded } = fakeDeps([youtube, naver]);

    const result = await runContextHunter(deps, IDEA);

    expect(result).toEqual({ ...DRAFT, citations: CITATIONS });

    // 각 소스는 planner가 그 소스에 맞춰 만든 검색어를 받는다 (아이디어 원문이 아니다)
    expect(youtube.collect).toHaveBeenCalledTimes(1);
    expect(youtube.collect).toHaveBeenCalledWith(PLANNED_QUERIES.youtube);
    expect(naver.collect).toHaveBeenCalledTimes(1);
    expect(naver.collect).toHaveBeenCalledWith(PLANNED_QUERIES.naver);

    // grounding 호출은 LLM이 채우는 draft 스키마로 한다 — citations는 LLM이 채우지 않는다
    expect(generateGrounded).toHaveBeenCalledTimes(1);
    const params = generateGrounded.mock.calls[0][0];
    expect(params.schema).toBe(MarketContextDraftSchema);

    // 프롬프트에 아이디어 원문과 수집된 목소리(원문·출처·소스 라벨)가 포함된다
    const prompt = params.prompt as string;
    expect(prompt).toContain(IDEA);
    expect(prompt).toContain(SOURCE_LABELS.youtube);
    expect(prompt).toContain(YOUTUBE_VOICE.text);
    expect(prompt).toContain(YOUTUBE_VOICE.url);
    expect(prompt).toContain(NAVER_VOICE.text);
  });

  it("치환되지 않은 placeholder가 프롬프트에 남지 않는다", async () => {
    const { deps, generateGrounded } = fakeDeps([
      fakeSource("youtube", [YOUTUBE_VOICE]),
    ]);

    await runContextHunter(deps, IDEA);

    expect(promptOf(generateGrounded)).not.toMatch(/\{[a-zA-Z]+\}/);
  });

  it("citations는 LLM 산출물이 아니라 코드가 grounding 응답에서 주입한다", async () => {
    const { deps } = fakeDeps([fakeSource("youtube", [])]);

    const result = await runContextHunter(deps, IDEA);

    // LLM이 돌려준 draft에는 citations 키가 없다 — 코드가 붙인 것이다
    expect("citations" in DRAFT).toBe(false);
    expect(result.citations).toEqual(CITATIONS);
    // 검증된 인용과 LLM 자기보고 출처는 공존한다 (실패 모드가 상보적이다 — ADR-012)
    expect(result.sources).toEqual(DRAFT.sources);
  });

  it("webSearchQueries는 로그로만 노출하고 산출물에 넣지 않는다", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { deps } = fakeDeps([fakeSource("youtube", [])]);

    const result = await runContextHunter(deps, IDEA);

    expect(Object.keys(result)).not.toContain("webSearchQueries");
    expect(String(error.mock.calls[0][0])).toContain(SEARCH_QUERIES[0]);
  });

  it("프롬프트에 댓글 원문 보존(요약 금지) 지시가 포함된다", async () => {
    const { deps, generateGrounded } = fakeDeps([
      fakeSource("youtube", [YOUTUBE_VOICE]),
    ]);

    await runContextHunter(deps, IDEA);

    const params = generateGrounded.mock.calls[0][0];
    const combined = `${params.systemInstruction as string}\n${params.prompt as string}`;
    expect(combined).toContain("요약하지 말");
    expect(combined).toContain("원문");
  });
});

describe("runContextHunter (researchPlanner 연동)", () => {
  it("★ 각 소스가 아이디어 원문이 아니라 planner가 만든 자기 검색어로 호출된다", async () => {
    const youtube = fakeSource("youtube", []);
    const hackernews = fakeSource("hackernews", []);
    const naver = fakeSource("naver", []);
    const { deps, generateStructured } = fakeDeps([youtube, hackernews, naver]);

    await runContextHunter(deps, IDEA);

    // planner는 non-grounding 구조화 출력이다 — 검색어를 짓는 단계지 검색하는 단계가 아니다
    expect(generateStructured).toHaveBeenCalledTimes(1);
    expect(generateStructured.mock.calls[0][0].schema).toBe(SearchQueriesSchema);

    expect(youtube.collect).toHaveBeenCalledWith(PLANNED_QUERIES.youtube);
    // HN은 영어권이라 한국어 쿼리를 받으면 에러 없이 조용히 0건이 된다
    expect(hackernews.collect).toHaveBeenCalledWith(PLANNED_QUERIES.hackernews);
    expect(naver.collect).toHaveBeenCalledWith(PLANNED_QUERIES.naver);

    for (const source of [youtube, hackernews, naver]) {
      expect(source.collect).not.toHaveBeenCalledWith(IDEA);
    }
  });

  it("★ clarifications를 planner에 넘겨 검색어에 반영되게 한다", async () => {
    // 이전에는 인터뷰 답변이 프롬프트 끝에만 붙고 검색어에는 전혀 반영되지 않았다
    const { deps, generateStructured } = fakeDeps([fakeSource("youtube", [])]);
    const clarifications = "Q: 핵심 타깃은?\nA: 바쁜 1인 가구 직장인";

    await runContextHunter(deps, IDEA, clarifications);

    const plannerPrompt = generateStructured.mock.calls[0][0].prompt as string;
    expect(plannerPrompt).toContain("바쁜 1인 가구 직장인");
  });

  it("생성된 검색어를 로그로 남긴다 (0건 실패의 유일한 관측 수단)", async () => {
    const { deps, log } = fakeDeps([fakeSource("youtube", [])]);

    await runContextHunter(deps, IDEA);

    const logged = log.mock.calls.map((call) => String(call[0])).join("\n");
    expect(logged).toContain(PLANNED_QUERIES.youtube);
    expect(logged).toContain(PLANNED_QUERIES.hackernews);
    expect(logged).toContain(PLANNED_QUERIES.naver);
  });

  it("queries.web을 grounding 프롬프트의 검색 힌트로 넣는다", async () => {
    const { deps, generateGrounded } = fakeDeps([fakeSource("youtube", [])]);

    await runContextHunter(deps, IDEA);

    const prompt = promptOf(generateGrounded);
    for (const hint of PLANNED_QUERIES.web) {
      expect(prompt).toContain(hint);
    }
  });

  it("planner가 실패해도 아이디어 원문으로 폴백해 완주한다", async () => {
    const youtube = fakeSource("youtube", [YOUTUBE_VOICE]);
    const { deps, generateGrounded } = fakeDeps(
      [youtube],
      new Error("Gemini 호출 실패"),
    );

    const result = await runContextHunter(deps, IDEA);

    // 검색어 생성 실패는 자료조사를 멈출 이유가 아니다 (ADR-012 fail-soft)
    expect(result).toEqual({ ...DRAFT, citations: CITATIONS });
    expect(youtube.collect).toHaveBeenCalledWith(IDEA);
    expect(generateGrounded).toHaveBeenCalledTimes(1);
    expect(promptOf(generateGrounded)).toContain(IDEA);
  });
});

describe("runContextHunter (인터뷰 답변 반영)", () => {
  it("clarifications가 있으면 프롬프트에 인터뷰 답변 섹션을 추가한다", async () => {
    const { deps, generateGrounded } = fakeDeps([fakeSource("youtube", [])]);
    const clarifications = "Q: 핵심 타깃은?\nA: 바쁜 1인 가구 직장인";

    await runContextHunter(deps, IDEA, clarifications);

    const prompt = promptOf(generateGrounded);
    expect(prompt).toContain("사용자 추가 설명");
    expect(prompt).toContain("바쁜 1인 가구 직장인");
  });

  it("clarifications가 없으면 인터뷰 답변 섹션을 넣지 않는다 (기존 동작 유지)", async () => {
    const { deps, generateGrounded } = fakeDeps([fakeSource("youtube", [])]);

    await runContextHunter(deps, IDEA);

    expect(promptOf(generateGrounded)).not.toContain("사용자 추가 설명");
  });

  it("clarifications가 공백뿐이면 섹션을 넣지 않는다", async () => {
    const { deps, generateGrounded } = fakeDeps([fakeSource("youtube", [])]);

    await runContextHunter(deps, IDEA, "   ");

    expect(promptOf(generateGrounded)).not.toContain("사용자 추가 설명");
  });
});

describe("runContextHunter (소스 실패 내성)", () => {
  it("한 소스가 실패해도 나머지 소스의 목소리로 진행하고 실패를 프롬프트에 명기한다", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { deps, generateGrounded } = fakeDeps([
      fakeSource("youtube", [YOUTUBE_VOICE]),
      fakeSource("naver", new Error("네이버 API 일일 호출 한도(25,000)를 초과했다")),
    ]);

    const result = await runContextHunter(deps, IDEA);

    expect(result).toEqual({ ...DRAFT, citations: CITATIONS });
    const prompt = promptOf(generateGrounded);
    expect(prompt).toContain(YOUTUBE_VOICE.text);
    // 실패한 소스가 프롬프트에 남아야 LLM이 근거 편향을 스스로 진술한다
    expect(prompt).toContain("수집 실패");
    expect(prompt).toContain("일일 호출 한도");
    expect(warn).toHaveBeenCalled();
  });

  it("모든 소스가 실패해도 웹검색만으로 진행한다 (throw하지 않는다)", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { deps, generateGrounded } = fakeDeps([
      fakeSource("youtube", new Error("YouTube API quota가 초과되었다")),
      fakeSource("hackernews", new Error("Hacker News API 요청이 실패했다")),
      fakeSource("naver", new Error("네이버 API 인증에 실패했다")),
    ]);

    const result = await runContextHunter(deps, IDEA);

    expect(result).toEqual({ ...DRAFT, citations: CITATIONS });
    expect(generateGrounded).toHaveBeenCalledTimes(1);
    expect(promptOf(generateGrounded)).toContain("quota");
  });

  it("등록된 소스가 없으면 빈 수집 안내로 진행한다", async () => {
    const { deps, generateGrounded } = fakeDeps([]);

    const result = await runContextHunter(deps, IDEA);

    expect(result).toEqual({ ...DRAFT, citations: CITATIONS });
    const prompt = promptOf(generateGrounded);
    expect(prompt).toContain("communityVoices는 빈 배열로");
  });

  it("모든 소스가 0건이면 빈 수집 안내로 진행한다", async () => {
    const { deps, generateGrounded } = fakeDeps([
      fakeSource("youtube", []),
      fakeSource("hackernews", []),
    ]);

    const result = await runContextHunter(deps, IDEA);

    expect(result).toEqual({ ...DRAFT, citations: CITATIONS });
    expect(promptOf(generateGrounded)).toContain("communityVoices는 빈 배열로");
  });

  it("일부 소스만 0건이면 그 0건이 프롬프트에 숫자로 드러난다", async () => {
    const { deps, generateGrounded } = fakeDeps([
      fakeSource("youtube", [YOUTUBE_VOICE]),
      fakeSource("hackernews", []),
    ]);

    await runContextHunter(deps, IDEA);

    // HN이 한국어 쿼리를 받아 조용히 0건이 되는 실패는 숫자로 적혀야 LLM이 근거 부재를 진술한다
    expect(promptOf(generateGrounded)).toContain(
      `${SOURCE_LABELS.hackernews} — 0건`,
    );
  });
});

describe("CONTEXT_HUNTER_PROMPT_TEMPLATE (출력 형식 계약)", () => {
  // 이 에이전트만 grounding 모드라 responseJsonSchema를 못 쓴다.
  // 프롬프트의 JSON 예시가 유일한 형식 지시이므로 키 하나만 빠져도 검증이 실패한다.
  it("JSON 예시가 LLM이 채우는 모든 최상위 키를 담는다", () => {
    for (const key of Object.keys(MarketContextDraftSchema.shape)) {
      expect(CONTEXT_HUNTER_PROMPT_TEMPLATE).toContain(`"${key}"`);
    }
  });

  // citations는 코드가 groundingMetadata에서 추출해 주입하는 사실이다.
  // LLM에게 채우라고 하면 URL을 지어낸다 — 이 phase가 고치려는 바로 그 버그다 (ADR-012).
  it("코드 주입 키는 JSON 예시에 없다", () => {
    for (const key of CODE_INJECTED_CONTEXT_KEYS) {
      expect(CONTEXT_HUNTER_PROMPT_TEMPLATE).not.toContain(`"${key}"`);
    }
  });

  // MarketContext에 필드를 추가하면서 프롬프트에도 안 넣고 코드 주입으로도 선언하지 않는 것을 막는다
  it("LLM이 채우는 키 + 코드 주입 키 = MarketContext의 키 전체", () => {
    const union = new Set([
      ...Object.keys(MarketContextDraftSchema.shape),
      ...CODE_INJECTED_CONTEXT_KEYS,
    ]);
    expect(union).toEqual(new Set(Object.keys(MarketContextObjectSchema.shape)));
  });

  it("communityVoices의 source가 취할 수 있는 값을 명시한다 (스키마가 enum이다)", () => {
    expect(CONTEXT_HUNTER_PROMPT_TEMPLATE).toContain("hackernews");
    expect(CONTEXT_HUNTER_PROMPT_TEMPLATE).toContain("naver");
  });

  it("수집 결과 placeholder는 소스별로 쪼개지 않고 하나다", () => {
    expect(CONTEXT_HUNTER_PROMPT_TEMPLATE).toContain("{evidenceSection}");
    expect(CONTEXT_HUNTER_PROMPT_TEMPLATE).not.toContain("{youtubeSection}");
  });

  it("★ 네이버 항목이 검색 스니펫임을 경고한다 (잘린 문장을 원문 인용으로 싣지 못하게)", () => {
    expect(CONTEXT_HUNTER_PROMPT_TEMPLATE).toContain("스니펫");
    expect(CONTEXT_HUNTER_PROMPT_TEMPLATE).toContain("잘린 문장");
  });

  it("★ urlContext로 읽을 경쟁사 페이지 수의 상한을 명시한다 (입력 토큰 폭발 방지)", () => {
    expect(CONTEXT_HUNTER_PROMPT_TEMPLATE).toContain("3곳");
  });

  it.each(["briefing", "marketSizeIndicators", "competitorInsight", "voicesInsight"])(
    "JSON 예시에 인사이트 필드 %s가 있다",
    (field) => {
      expect(CONTEXT_HUNTER_PROMPT_TEMPLATE).toContain(`"${field}"`);
    },
  );
});

describe("CONTEXT_HUNTER_SYSTEM_PROMPT (인사이트 변환 지시)", () => {
  it.each(["briefing", "marketSizeIndicators", "competitorInsight", "voicesInsight"])(
    "인사이트 필드 %s의 작성 지시를 담는다",
    (field) => {
      expect(CONTEXT_HUNTER_SYSTEM_PROMPT).toContain(field);
    },
  );

  it("건조한 팩트 톤을 지시하고 낙관·비관을 다음 단계로 미룬다", () => {
    expect(CONTEXT_HUNTER_SYSTEM_PROMPT).toContain("건조");
    expect(CONTEXT_HUNTER_SYSTEM_PROMPT).toContain("낙관");
    expect(CONTEXT_HUNTER_SYSTEM_PROMPT).toContain("비관");
  });

  it("marketSizeIndicators는 확인되지 않으면 빈 배열로 두라고 지시한다", () => {
    expect(CONTEXT_HUNTER_SYSTEM_PROMPT).toContain("빈 배열");
    expect(CONTEXT_HUNTER_SYSTEM_PROMPT).toContain("추측");
  });

  it("communityVoices가 비었을 때 voicesInsight에 그 한계를 진술하라고 지시한다", () => {
    expect(CONTEXT_HUNTER_SYSTEM_PROMPT).toContain("communityVoices");
    expect(CONTEXT_HUNTER_SYSTEM_PROMPT).toContain("지어내지");
  });

  it("★ 일부 소스만 실패했을 때의 근거 편향도 진술하라고 지시한다", () => {
    expect(CONTEXT_HUNTER_SYSTEM_PROMPT).toContain("수집이 실패");
    expect(CONTEXT_HUNTER_SYSTEM_PROMPT).toContain("편향");
  });

  it("댓글 원문 보존 규칙을 유지한다", () => {
    expect(CONTEXT_HUNTER_SYSTEM_PROMPT).toContain("요약하지 말");
    expect(CONTEXT_HUNTER_SYSTEM_PROMPT).toContain("원문");
  });
});
