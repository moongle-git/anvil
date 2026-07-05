import { afterEach, describe, expect, it, vi } from "vitest";
import type { GeminiService } from "../services/gemini.js";
import type {
  YoutubeComment,
  YoutubeService,
  YoutubeVideo,
} from "../services/youtube.js";
import { MarketContextSchema, type MarketContext } from "../types/index.js";
import { runContextHunter, type ContextHunterDeps } from "./contextHunter.js";

const IDEA = "반려견 산책 대행 매칭 서비스";

const MARKET_CONTEXT: MarketContext = {
  ideaTitle: "반려견 산책 대행 매칭 서비스",
  trends: ["펫 시장 성장"],
  competitors: [{ name: "도그메이트", description: "펫시터 매칭" }],
  youtubeVoices: [
    {
      videoTitle: "강아지 산책 브이로그",
      videoUrl: "https://www.youtube.com/watch?v=abc123",
      comment: "산책 시킬 시간이 없어서 너무 미안해요...",
    },
  ],
  painPointEvidence: ["바쁜 직장인은 산책 시간 확보가 어렵다"],
  sources: ["https://example.com/pet-market"],
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

describe("runContextHunter (YouTube 실패 내성)", () => {
  it("YouTube 수집이 실패해도 웹검색만으로 진행하고 실패를 로깅한다", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { deps, generateStructured } = fakeDeps(
      new Error("YouTube API quota가 초과되었다"),
    );

    const result = await runContextHunter(deps, IDEA);

    expect(result).toEqual(MARKET_CONTEXT);
    expect(generateStructured).toHaveBeenCalledTimes(1);

    // 프롬프트는 YouTube 데이터 없음을 명시하고, youtubeVoices를 빈 배열로 지시한다
    const prompt = generateStructured.mock.calls[0][0].prompt as string;
    expect(prompt).toContain("youtubeVoices");
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
