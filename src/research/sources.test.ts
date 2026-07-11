import { describe, expect, it, vi } from "vitest";
import type {
  HackerNewsComment,
  HackerNewsService,
  HackerNewsStory,
} from "../services/hackerNews.js";
import type { NaverPost, NaverService } from "../services/naver.js";
import type {
  YoutubeComment,
  YoutubeService,
  YoutubeVideo,
} from "../services/youtube.js";
import { CommunityVoiceSchema, SOURCE_LABELS } from "../types/index.js";
import { hackerNewsSource, naverSource, youtubeSource } from "./sources.js";

function video(id: string, title: string): YoutubeVideo {
  return {
    videoId: id,
    title,
    channelTitle: "채널",
    url: `https://www.youtube.com/watch?v=${id}`,
    description: "설명",
  };
}

let commentSeq = 0;

/** commentId를 주지 않으면 유일한 값을 만든다 — 실제 API처럼 댓글마다 ID가 다르다 */
function comment(
  videoId: string,
  text: string,
  likeCount = 3,
  commentId = `Ugx${(commentSeq += 1)}`,
): YoutubeComment {
  return {
    videoId,
    commentId,
    text,
    authorName: "초보집사",
    likeCount,
    url: `https://www.youtube.com/watch?v=${videoId}&lc=${commentId}`,
  };
}

const HN_COMMENT: HackerNewsComment = {
  objectId: "42",
  text: "I killed three plants before giving up on reminder apps.",
  author: "pg",
  storyTitle: "Show HN: Plant care assistant",
  url: "https://news.ycombinator.com/item?id=42",
};

const HN_STORY: HackerNewsStory = {
  objectId: "41",
  title: "Show HN: Plant care assistant",
  url: "https://example.com/plant-app",
  author: "founder",
  points: 120,
  numComments: 37,
};

const NAVER_POST: NaverPost = {
  corpus: "cafearticle",
  title: "식물 키우기 실패 후기",
  link: "https://cafe.naver.com/plant/1",
  description: "물주기를 놓쳐서 결국 시들었어요... 다들 어떻게 관리하시나요?",
  authorName: "식물카페",
};

function fakeYoutube(
  voices: { video: YoutubeVideo; comments: YoutubeComment[] }[] | Error,
): YoutubeService {
  return {
    collectVoices:
      voices instanceof Error
        ? vi.fn().mockRejectedValue(voices)
        : vi.fn().mockResolvedValue(voices),
  } as unknown as YoutubeService;
}

function fakeHackerNews(
  result: { stories: HackerNewsStory[]; comments: HackerNewsComment[] } | Error,
): HackerNewsService {
  return {
    collect:
      result instanceof Error
        ? vi.fn().mockRejectedValue(result)
        : vi.fn().mockResolvedValue(result),
  } as unknown as HackerNewsService;
}

function fakeNaver(result: NaverPost[] | Error): NaverService {
  return {
    collect:
      result instanceof Error
        ? vi.fn().mockRejectedValue(result)
        : vi.fn().mockResolvedValue(result),
  } as unknown as NaverService;
}

describe("youtubeSource", () => {
  it("영상별 댓글 묶음을 댓글 단위 CommunityVoice로 평탄화한다", async () => {
    const service = fakeYoutube([
      {
        video: video("abc", "식물 키우기 실패담"),
        comments: [
          comment("abc", "물주기를 놓쳤어요", 42, "UgxA1"),
          comment("abc", "저도요", 7, "UgxA2"),
        ],
      },
      {
        video: video("def", "초보 식집사"),
        comments: [comment("def", "분갈이가 어려워요", 1, "UgxD1")],
      },
    ]);

    const voices = await youtubeSource(service).collect("반려식물");

    expect(voices).toEqual([
      {
        source: "youtube",
        title: "식물 키우기 실패담",
        url: "https://www.youtube.com/watch?v=abc&lc=UgxA1",
        text: "물주기를 놓쳤어요",
        authorName: "초보집사",
        score: 42,
      },
      {
        source: "youtube",
        title: "식물 키우기 실패담",
        url: "https://www.youtube.com/watch?v=abc&lc=UgxA2",
        text: "저도요",
        authorName: "초보집사",
        score: 7,
      },
      {
        source: "youtube",
        title: "초보 식집사",
        url: "https://www.youtube.com/watch?v=def&lc=UgxD1",
        text: "분갈이가 어려워요",
        authorName: "초보집사",
        score: 1,
      },
    ]);
  });

  it("★ 댓글 voice의 url은 영상 페이지가 아니라 댓글 퍼머링크다 — 서비스가 만든 url을 그대로 매핑한다", async () => {
    const service = fakeYoutube([
      {
        video: video("abc", "식물 키우기 실패담"),
        comments: [comment("abc", "물주기를 놓쳤어요", 42, "UgxOne")],
      },
    ]);

    const voices = await youtubeSource(service).collect("반려식물");

    expect(voices[0].url).toBe("https://www.youtube.com/watch?v=abc&lc=UgxOne");
    expect(voices[0].url).not.toBe("https://www.youtube.com/watch?v=abc");
  });

  it("★ 같은 영상의 서로 다른 두 댓글은 서로 다른 url을 갖는다 — 독자가 인용된 댓글을 찾을 수 있다", async () => {
    const service = fakeYoutube([
      {
        video: video("abc", "식물 키우기 실패담"),
        comments: [
          comment("abc", "물주기를 놓쳤어요", 42, "UgxOne"),
          comment("abc", "저도요", 7, "UgxTwo"),
        ],
      },
    ]);

    const voices = await youtubeSource(service).collect("반려식물");

    expect(voices[0].url).not.toBe(voices[1].url);
    expect(new Set(voices.map((v) => v.url)).size).toBe(2);
  });

  it("id·label과 매핑 결과가 스키마 계약을 지킨다", async () => {
    const source = youtubeSource(
      fakeYoutube([
        { video: video("abc", "식물 키우기 실패담"), comments: [comment("abc", "댓글")] },
      ]),
    );

    expect(source.id).toBe("youtube");
    expect(source.label).toBe(SOURCE_LABELS.youtube);
    const voices = await source.collect("반려식물");
    expect(voices.map((v) => CommunityVoiceSchema.parse(v))).toEqual(voices);
  });

  it("아이디어가 아니라 주어진 쿼리를 그대로 서비스에 넘긴다", async () => {
    const service = fakeYoutube([]);
    await youtubeSource(service).collect("물주기 실패");
    expect(service.collectVoices).toHaveBeenCalledWith("물주기 실패");
  });

  it("작성자가 비면 authorName 키를 넣지 않는다", async () => {
    const service = fakeYoutube([
      {
        video: video("abc", "식물 키우기 실패담"),
        comments: [comment("abc", "댓글", 0, "UgxNoAuthor")].map((c) => ({
          ...c,
          authorName: "",
        })),
      },
    ]);

    const voices = await youtubeSource(service).collect("반려식물");

    expect(voices[0]).not.toHaveProperty("authorName");
    expect(voices[0].score).toBe(0);
  });

  it("서비스가 실패하면 어댑터도 throw한다 — 흡수는 collectAll의 책임이다", async () => {
    const source = youtubeSource(fakeYoutube(new Error("quota 초과")));
    await expect(source.collect("반려식물")).rejects.toThrow("quota 초과");
  });
});

describe("hackerNewsSource", () => {
  it("코멘트와 스토리를 CommunityVoice로 매핑한다", async () => {
    const source = hackerNewsSource(
      fakeHackerNews({ stories: [HN_STORY], comments: [HN_COMMENT] }),
    );

    const voices = await source.collect("plant care app");

    expect(source.id).toBe("hackernews");
    expect(source.label).toBe(SOURCE_LABELS.hackernews);
    expect(voices).toEqual([
      {
        source: "hackernews",
        title: HN_COMMENT.storyTitle,
        url: HN_COMMENT.url,
        text: HN_COMMENT.text,
        authorName: "pg",
      },
      {
        source: "hackernews",
        title: HN_STORY.title,
        url: HN_STORY.url,
        text: HN_STORY.title,
        authorName: "founder",
        score: 120,
        extra: "HN 스토리 · 댓글 37개",
      },
    ]);
    expect(voices.map((v) => CommunityVoiceSchema.parse(v))).toEqual(voices);
  });

  it("코멘트 voice의 url은 원문 기사가 아니라 코멘트 퍼머링크다", async () => {
    const source = hackerNewsSource(
      fakeHackerNews({ stories: [], comments: [HN_COMMENT] }),
    );

    const voices = await source.collect("plant care app");

    expect(voices[0].url).toBe("https://news.ycombinator.com/item?id=42");
  });

  it("스토리 voice만 extra를 가져 코멘트와 구분된다 (경쟁사 발굴 단서)", async () => {
    const source = hackerNewsSource(
      fakeHackerNews({ stories: [HN_STORY], comments: [HN_COMMENT] }),
    );

    const voices = await source.collect("plant care app");

    const [commentVoice, storyVoice] = voices;
    expect(commentVoice).not.toHaveProperty("extra");
    expect(storyVoice.extra).toContain("HN 스토리");
  });

  it("서비스가 실패하면 어댑터도 throw한다", async () => {
    const source = hackerNewsSource(fakeHackerNews(new Error("HTTP 429")));
    await expect(source.collect("plant care app")).rejects.toThrow("HTTP 429");
  });
});

describe("naverSource", () => {
  it("게시글을 CommunityVoice로 매핑한다", async () => {
    const source = naverSource(fakeNaver([NAVER_POST]));

    const voices = await source.collect("식물 키우기 실패");

    expect(source.id).toBe("naver");
    expect(source.label).toBe(SOURCE_LABELS.naver);
    expect(voices).toEqual([
      {
        source: "naver",
        title: NAVER_POST.title,
        url: NAVER_POST.link,
        text: NAVER_POST.description,
        authorName: "식물카페",
        extra: "검색 스니펫",
      },
    ]);
    expect(voices.map((v) => CommunityVoiceSchema.parse(v))).toEqual(voices);
  });

  it("★ 모든 voice에 '검색 스니펫' 표시가 붙는다 — description은 말줄임이 든 200자 스니펫이다", async () => {
    const kinPost: NaverPost = {
      corpus: "kin",
      title: "식물이 자꾸 죽어요",
      link: "https://kin.naver.com/qna/1",
      description: "화분이 자꾸 시드는데 물을 얼마나 줘야...",
    };
    const source = naverSource(fakeNaver([NAVER_POST, kinPost]));

    const voices = await source.collect("식물 키우기 실패");

    expect(voices.map((v) => v.extra)).toEqual(["검색 스니펫", "검색 스니펫"]);
  });

  it("작성자가 없는 corpus(지식iN)는 authorName 키를 넣지 않는다", async () => {
    const source = naverSource(
      fakeNaver([
        {
          corpus: "kin",
          title: "식물이 자꾸 죽어요",
          link: "https://kin.naver.com/qna/1",
          description: "물을 얼마나 줘야 하나요",
        },
      ]),
    );

    const voices = await source.collect("식물 키우기 실패");

    expect(voices[0]).not.toHaveProperty("authorName");
  });

  it("서비스가 실패하면 어댑터도 throw한다", async () => {
    const source = naverSource(fakeNaver(new Error("일일 호출 한도")));
    await expect(source.collect("식물")).rejects.toThrow("일일 호출 한도");
  });
});
