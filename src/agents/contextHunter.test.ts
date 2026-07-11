import { afterEach, describe, expect, it, vi } from "vitest";
import type { GeminiService } from "../services/gemini.js";
import type {
  YoutubeComment,
  YoutubeService,
  YoutubeVideo,
} from "../services/youtube.js";
import {
  CODE_INJECTED_CONTEXT_KEYS,
  MarketContextDraftSchema,
  MarketContextObjectSchema,
  MarketContextSchema,
  type MarketContext,
} from "../types/index.js";
import {
  CONTEXT_HUNTER_PROMPT_TEMPLATE,
  CONTEXT_HUNTER_SYSTEM_PROMPT,
  runContextHunter,
  type ContextHunterDeps,
} from "./contextHunter.js";

const IDEA = "반려견 산책 대행 매칭 서비스";

const MARKET_CONTEXT: MarketContext = {
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
  citations: [],
};

function video(id: string, title: string): YoutubeVideo {
  return {
    videoId: id,
    title,
    channelTitle: "채널",
    url: `https://www.youtube.com/watch?v=${id}`,
    description: "설명",
  };
}

function comment(videoId: string, text: string): YoutubeComment {
  return { videoId, text, authorName: "user1", likeCount: 3 };
}

interface FakeDeps {
  deps: ContextHunterDeps;
  generateStructured: ReturnType<typeof vi.fn>;
  collectVoices: ReturnType<typeof vi.fn>;
}

function fakeDeps(
  voices: { video: YoutubeVideo; comments: YoutubeComment[] }[] | Error,
): FakeDeps {
  const generateStructured = vi.fn().mockResolvedValue(MARKET_CONTEXT);
  const collectVoices =
    voices instanceof Error
      ? vi.fn().mockRejectedValue(voices)
      : vi.fn().mockResolvedValue(voices);

  return {
    deps: {
      gemini: { generateStructured } as unknown as GeminiService,
      youtube: { collectVoices } as unknown as YoutubeService,
    },
    generateStructured,
    collectVoices,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("runContextHunter (정상 흐름)", () => {
  it("YouTube 수집 결과와 아이디어를 담아 grounding 모드로 Gemini를 호출하고 결과를 반환한다", async () => {
    const { deps, generateStructured, collectVoices } = fakeDeps([
      {
        video: video("abc123", "강아지 산책 브이로그"),
        comments: [comment("abc123", "산책 시킬 시간이 없어서 너무 미안해요...")],
      },
    ]);

    const result = await runContextHunter(deps, IDEA);

    expect(result).toEqual(MARKET_CONTEXT);

    // YouTube는 아이디어 기반 검색어로 호출된다
    expect(collectVoices).toHaveBeenCalledTimes(1);
    expect(collectVoices).toHaveBeenCalledWith(IDEA);

    // Gemini는 grounding + MarketContext 스키마로 호출된다
    expect(generateStructured).toHaveBeenCalledTimes(1);
    const params = generateStructured.mock.calls[0][0];
    expect(params.useGrounding).toBe(true);
    expect(params.schema).toBe(MarketContextSchema);

    // 프롬프트에 아이디어 원문과 YouTube 수집 결과(제목/URL/댓글 원문)가 포함된다
    const prompt = params.prompt as string;
    expect(prompt).toContain(IDEA);
    expect(prompt).toContain("강아지 산책 브이로그");
    expect(prompt).toContain("https://www.youtube.com/watch?v=abc123");
    expect(prompt).toContain("산책 시킬 시간이 없어서 너무 미안해요...");
  });

  it("프롬프트에 댓글 원문 보존(요약 금지) 지시가 포함된다", async () => {
    const { deps, generateStructured } = fakeDeps([
      {
        video: video("abc123", "강아지 산책 브이로그"),
        comments: [comment("abc123", "댓글 원문")],
      },
    ]);

    await runContextHunter(deps, IDEA);

    const params = generateStructured.mock.calls[0][0];
    const combined = `${params.systemInstruction as string}\n${params.prompt as string}`;
    expect(combined).toContain("요약하지 말");
    expect(combined).toContain("원문");
  });
});

describe("runContextHunter (인터뷰 답변 반영)", () => {
  it("clarifications가 있으면 프롬프트에 인터뷰 답변 섹션을 추가한다", async () => {
    const { deps, generateStructured } = fakeDeps([]);
    const clarifications = "Q: 핵심 타깃은?\nA: 바쁜 1인 가구 직장인";

    await runContextHunter(deps, IDEA, clarifications);

    const prompt = generateStructured.mock.calls[0][0].prompt as string;
    expect(prompt).toContain("사용자 추가 설명");
    expect(prompt).toContain("바쁜 1인 가구 직장인");
  });

  it("clarifications가 없으면 인터뷰 답변 섹션을 넣지 않는다 (기존 동작 유지)", async () => {
    const { deps, generateStructured } = fakeDeps([]);

    await runContextHunter(deps, IDEA);

    const prompt = generateStructured.mock.calls[0][0].prompt as string;
    expect(prompt).not.toContain("사용자 추가 설명");
  });

  it("clarifications가 공백뿐이면 섹션을 넣지 않는다", async () => {
    const { deps, generateStructured } = fakeDeps([]);

    await runContextHunter(deps, IDEA, "   ");

    const prompt = generateStructured.mock.calls[0][0].prompt as string;
    expect(prompt).not.toContain("사용자 추가 설명");
  });
});

describe("runContextHunter (YouTube 실패 내성)", () => {
  it("YouTube 수집이 실패해도 웹검색만으로 진행하고 실패를 로깅한다", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { deps, generateStructured } = fakeDeps(
      new Error("YouTube API quota가 초과되었다"),
    );

    const result = await runContextHunter(deps, IDEA);

    expect(result).toEqual(MARKET_CONTEXT);
    expect(generateStructured).toHaveBeenCalledTimes(1);

    // 프롬프트는 YouTube 데이터 없음을 명시하고, communityVoices를 빈 배열로 지시한다
    const prompt = generateStructured.mock.calls[0][0].prompt as string;
    expect(prompt).toContain("communityVoices");
    expect(prompt).toContain("빈 배열");

    // 실패 사실 로깅
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain("quota");
  });

  it("YouTube 결과가 빈 배열이어도 정상 진행한다", async () => {
    const { deps, generateStructured } = fakeDeps([]);

    const result = await runContextHunter(deps, IDEA);

    expect(result).toEqual(MARKET_CONTEXT);
    expect(generateStructured).toHaveBeenCalledTimes(1);
  });
});

describe("CONTEXT_HUNTER_PROMPT_TEMPLATE (출력 형식 계약)", () => {
  // 이 에이전트만 useGrounding: true라 responseJsonSchema를 못 쓴다.
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

  it("댓글 원문 보존 규칙을 유지한다", () => {
    expect(CONTEXT_HUNTER_SYSTEM_PROMPT).toContain("요약하지 말");
    expect(CONTEXT_HUNTER_SYSTEM_PROMPT).toContain("원문");
  });
});
