import { describe, expect, it, vi } from "vitest";
import {
  YoutubeApiError,
  YoutubeService,
  type YoutubeServiceOptions,
} from "./youtube.js";

interface FakeResponse {
  ok: boolean;
  status: number;
  body: unknown;
}

function jsonResponse(body: unknown, status = 200): FakeResponse {
  return { ok: status >= 200 && status < 300, status, body };
}

function fakeFetch(...responses: FakeResponse[]) {
  const fetchFn = vi.fn();
  for (const response of responses) {
    fetchFn.mockResolvedValueOnce({
      ok: response.ok,
      status: response.status,
      json: () => Promise.resolve(response.body),
    });
  }
  return fetchFn;
}

function service(
  fetchFn: ReturnType<typeof vi.fn>,
  options: Partial<YoutubeServiceOptions> = {},
): YoutubeService {
  return new YoutubeService({
    apiKey: "test-key",
    fetchFn: fetchFn as unknown as typeof fetch,
    ...options,
  });
}

function searchItem(videoId: string, title = `제목-${videoId}`): unknown {
  return {
    id: { videoId },
    snippet: {
      title,
      channelTitle: `채널-${videoId}`,
      description: `설명-${videoId}`,
    },
  };
}

function searchBody(...videoIds: string[]): unknown {
  return { items: videoIds.map((id) => searchItem(id)) };
}

function commentItem(text: string, authorName = "작성자", likeCount = 3): unknown {
  return {
    snippet: {
      topLevelComment: {
        snippet: {
          textOriginal: text,
          authorDisplayName: authorName,
          likeCount,
        },
      },
    },
  };
}

function errorBody(reason: string, message: string): unknown {
  return { error: { code: 403, message, errors: [{ reason }] } };
}

describe("YoutubeService.searchVideos", () => {
  it("검색 결과를 YoutubeVideo 배열로 매핑한다", async () => {
    const fetchFn = fakeFetch(jsonResponse(searchBody("abc123")));

    const videos = await service(fetchFn).searchVideos("AI 기획");

    expect(videos).toEqual([
      {
        videoId: "abc123",
        title: "제목-abc123",
        channelTitle: "채널-abc123",
        url: "https://www.youtube.com/watch?v=abc123",
        description: "설명-abc123",
      },
    ]);
  });

  it("search 엔드포인트에 part=snippet, type=video, relevanceLanguage=ko, maxResults, key를 담아 요청한다", async () => {
    const fetchFn = fakeFetch(jsonResponse(searchBody("abc123")));

    await service(fetchFn, { maxVideos: 3 }).searchVideos("AI 기획");

    expect(fetchFn).toHaveBeenCalledTimes(1);
    const url = new URL(fetchFn.mock.calls[0][0] as string);
    expect(url.pathname).toBe("/youtube/v3/search");
    expect(url.searchParams.get("part")).toBe("snippet");
    expect(url.searchParams.get("type")).toBe("video");
    expect(url.searchParams.get("relevanceLanguage")).toBe("ko");
    expect(url.searchParams.get("maxResults")).toBe("3");
    expect(url.searchParams.get("q")).toBe("AI 기획");
    expect(url.searchParams.get("key")).toBe("test-key");
  });

  it("API가 maxVideos보다 많은 항목을 반환해도 maxVideos개로 제한한다", async () => {
    const fetchFn = fakeFetch(jsonResponse(searchBody("a", "b", "c", "d")));

    const videos = await service(fetchFn, { maxVideos: 2 }).searchVideos("q");

    expect(videos).toHaveLength(2);
    expect(videos.map((v) => v.videoId)).toEqual(["a", "b"]);
  });

  it("videoId가 없는 항목은 결과에서 제외한다", async () => {
    const body = { items: [{ id: {}, snippet: {} }, searchItem("ok1")] };
    const fetchFn = fakeFetch(jsonResponse(body));

    const videos = await service(fetchFn).searchVideos("q");

    expect(videos.map((v) => v.videoId)).toEqual(["ok1"]);
  });

  it("잘못된 API 키(401)면 키 오류 메시지로 예외를 던진다", async () => {
    const fetchFn = fakeFetch(
      jsonResponse(
        { error: { code: 401, message: "API key not valid", errors: [{ reason: "keyInvalid" }] } },
        401,
      ),
    );

    await expect(service(fetchFn).searchVideos("q")).rejects.toThrow(
      /API 키/,
    );
  });

  it("quota 초과(403 quotaExceeded)면 quota 메시지로 예외를 던진다", async () => {
    const fetchFn = fakeFetch(
      jsonResponse(errorBody("quotaExceeded", "Quota exceeded"), 403),
    );

    await expect(service(fetchFn).searchVideos("q")).rejects.toThrow(/quota/);
  });
});

describe("YoutubeService.fetchComments", () => {
  it("commentThreads 응답을 YoutubeComment 배열로 매핑한다", async () => {
    const fetchFn = fakeFetch(
      jsonResponse({ items: [commentItem("너무 불편해요", "유저A", 12)] }),
    );

    const comments = await service(fetchFn).fetchComments("vid1");

    expect(comments).toEqual([
      {
        videoId: "vid1",
        text: "너무 불편해요",
        authorName: "유저A",
        likeCount: 12,
      },
    ]);
  });

  it("commentThreads 엔드포인트에 part=snippet, order=relevance, maxResults, videoId, key를 담아 요청한다", async () => {
    const fetchFn = fakeFetch(jsonResponse({ items: [] }));

    await service(fetchFn, { maxCommentsPerVideo: 7 }).fetchComments("vid1");

    const url = new URL(fetchFn.mock.calls[0][0] as string);
    expect(url.pathname).toBe("/youtube/v3/commentThreads");
    expect(url.searchParams.get("part")).toBe("snippet");
    expect(url.searchParams.get("order")).toBe("relevance");
    expect(url.searchParams.get("maxResults")).toBe("7");
    expect(url.searchParams.get("videoId")).toBe("vid1");
    expect(url.searchParams.get("key")).toBe("test-key");
  });

  it("API가 제한보다 많은 댓글을 반환해도 maxCommentsPerVideo개로 제한한다", async () => {
    const items = [commentItem("1"), commentItem("2"), commentItem("3")];
    const fetchFn = fakeFetch(jsonResponse({ items }));

    const comments = await service(fetchFn, {
      maxCommentsPerVideo: 2,
    }).fetchComments("vid1");

    expect(comments).toHaveLength(2);
  });

  it("댓글 비활성화(403 commentsDisabled)면 reason을 담은 YoutubeApiError를 던진다", async () => {
    const fetchFn = fakeFetch(
      jsonResponse(errorBody("commentsDisabled", "Comments are disabled"), 403),
    );

    const error = await service(fetchFn)
      .fetchComments("vid1")
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(YoutubeApiError);
    expect((error as YoutubeApiError).reason).toBe("commentsDisabled");
  });
});

describe("YoutubeService.collectVoices", () => {
  it("검색된 각 영상의 댓글을 함께 수집한다", async () => {
    const fetchFn = fakeFetch(
      jsonResponse(searchBody("v1", "v2")),
      jsonResponse({ items: [commentItem("댓글1")] }),
      jsonResponse({ items: [commentItem("댓글2")] }),
    );

    const voices = await service(fetchFn).collectVoices("AI 기획");

    expect(voices).toHaveLength(2);
    expect(voices[0].video.videoId).toBe("v1");
    expect(voices[0].comments[0].text).toBe("댓글1");
    expect(voices[0].comments[0].videoId).toBe("v1");
    expect(voices[1].video.videoId).toBe("v2");
    expect(voices[1].comments[0].text).toBe("댓글2");
  });

  it("댓글 비활성화 영상은 건너뛰고 나머지를 반환한다", async () => {
    const fetchFn = fakeFetch(
      jsonResponse(searchBody("v1", "v2", "v3")),
      jsonResponse({ items: [commentItem("댓글1")] }),
      jsonResponse(errorBody("commentsDisabled", "Comments are disabled"), 403),
      jsonResponse({ items: [commentItem("댓글3")] }),
    );

    const voices = await service(fetchFn).collectVoices("q");

    expect(voices.map((v) => v.video.videoId)).toEqual(["v1", "v3"]);
  });

  it("댓글 수집 중 quota 초과는 건너뛰지 않고 예외를 던진다", async () => {
    const fetchFn = fakeFetch(
      jsonResponse(searchBody("v1")),
      jsonResponse(errorBody("quotaExceeded", "Quota exceeded"), 403),
    );

    await expect(service(fetchFn).collectVoices("q")).rejects.toThrow(/quota/);
  });
});
