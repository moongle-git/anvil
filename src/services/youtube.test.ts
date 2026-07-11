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

/** fetch가 실제로 resolve하는 모양 — 수동 제어 promise가 이 값을 나중에 정착시킨다 */
interface FetchResult {
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
}

function okResponse(body: unknown): FetchResult {
  return { ok: true, status: 200, json: () => Promise.resolve(body) };
}

function deferred(): {
  promise: Promise<FetchResult>;
  resolve: (value: FetchResult) => void;
} {
  let resolve!: (value: FetchResult) => void;
  const promise = new Promise<FetchResult>((r) => {
    resolve = r;
  });
  return { promise, resolve };
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

function commentItem(
  text: string,
  authorName = "작성자",
  likeCount = 3,
  commentId = `Ugx-${text}`,
): unknown {
  return {
    snippet: {
      topLevelComment: {
        id: commentId,
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

  it("응답이 timeoutMs 내에 오지 않으면 시간 초과로 실패한다 (hang 방지)", async () => {
    // 영원히 완료되지 않는 fetch — 네트워크 hang을 재현한다
    const fetchFn = vi.fn().mockReturnValue(new Promise(() => undefined));

    await expect(
      service(fetchFn, { timeoutMs: 20 }).searchVideos("q"),
    ).rejects.toThrow(/시간 초과/);
  });

  it("fetch에 취소용 signal을 실어 요청한다", async () => {
    const fetchFn = fakeFetch(jsonResponse(searchBody("v1")));

    await service(fetchFn).searchVideos("q");

    expect(fetchFn.mock.calls[0][1]?.signal).toBeInstanceOf(AbortSignal);
  });
});

describe("YoutubeService.fetchComments", () => {
  it("commentThreads 응답을 YoutubeComment 배열로 매핑한다 — topLevelComment.id를 담는다", async () => {
    const fetchFn = fakeFetch(
      jsonResponse({
        items: [commentItem("너무 불편해요", "유저A", 12, "UgxComment1")],
      }),
    );

    const comments = await service(fetchFn).fetchComments("vid1");

    expect(comments).toEqual([
      {
        videoId: "vid1",
        commentId: "UgxComment1",
        text: "너무 불편해요",
        authorName: "유저A",
        likeCount: 12,
        url: "https://www.youtube.com/watch?v=vid1&lc=UgxComment1",
      },
    ]);
  });

  it("★ 댓글 url은 영상 페이지가 아니라 댓글 퍼머링크다 — &가 이스케이프되거나 lc가 인코딩되면 안 된다", async () => {
    const fetchFn = fakeFetch(
      jsonResponse({ items: [commentItem("댓글", "유저", 1, "UgxAbc123")] }),
    );

    const [comment] = await service(fetchFn).fetchComments("USGvvBKZme4");

    // 문자열 동등 비교로 못박는다: &amp; 이스케이프나 lc 값 URL 인코딩은 permalink를 깨뜨린다
    expect(comment.url).toBe(
      "https://www.youtube.com/watch?v=USGvvBKZme4&lc=UgxAbc123",
    );
  });

  it("id가 없는 댓글 항목은 건너뛴다 — 영상 URL로 폴백하지 않는다", async () => {
    const noId = {
      snippet: {
        topLevelComment: {
          snippet: { textOriginal: "id 없는 댓글", authorDisplayName: "유저", likeCount: 1 },
        },
      },
    };
    const fetchFn = fakeFetch(
      jsonResponse({ items: [noId, commentItem("정상 댓글", "유저", 2, "UgxOk")] }),
    );

    const comments = await service(fetchFn).fetchComments("vid1");

    expect(comments.map((c) => c.text)).toEqual(["정상 댓글"]);
    expect(comments.map((c) => c.url)).toEqual([
      "https://www.youtube.com/watch?v=vid1&lc=UgxOk",
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

  it("commentsDisabled와 quota 초과가 함께 나도 quota 에러를 던진다", async () => {
    // 병렬화의 가장 위험한 회귀: rejected를 전부 무시하면 quota 초과가 조용히 "댓글 0개"가 된다
    const fetchFn = fakeFetch(
      jsonResponse(searchBody("v1", "v2")),
      jsonResponse(errorBody("commentsDisabled", "Comments are disabled"), 403),
      jsonResponse(errorBody("quotaExceeded", "Quota exceeded"), 403),
    );

    await expect(service(fetchFn).collectVoices("q")).rejects.toThrow(/quota/);
  });

  it("댓글 요청을 병렬로 보낸다 — 첫 응답이 정착하기 전에 나머지 요청이 이미 나갔다", async () => {
    const pending = [deferred(), deferred(), deferred()];
    let commentCall = 0;
    const fetchFn = vi.fn((input: string | URL) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/search")) {
        return Promise.resolve(okResponse(searchBody("v1", "v2", "v3")));
      }
      return pending[commentCall++].promise;
    });

    // await하지 않는다 — 순차 구현이면 search + 첫 댓글 = 2회에서 멈춘다
    const collecting = service(fetchFn).collectVoices("q");

    await vi.waitFor(() => {
      expect(fetchFn).toHaveBeenCalledTimes(4);
    });

    for (const [index, d] of pending.entries()) {
      d.resolve(okResponse({ items: [commentItem(`댓글${index + 1}`)] }));
    }
    const voices = await collecting;

    expect(voices.map((v) => v.comments[0].text)).toEqual([
      "댓글1",
      "댓글2",
      "댓글3",
    ]);
  });

  it("댓글 응답이 늦게 도착한 순서와 무관하게 영상 순서를 보존한다", async () => {
    const pending = [deferred(), deferred(), deferred()];
    let commentCall = 0;
    const fetchFn = vi.fn((input: string | URL) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/search")) {
        return Promise.resolve(okResponse(searchBody("v1", "v2", "v3")));
      }
      return pending[commentCall++].promise;
    });

    const collecting = service(fetchFn).collectVoices("q");
    await vi.waitFor(() => {
      expect(fetchFn).toHaveBeenCalledTimes(4);
    });

    // 응답은 v3 → v1 → v2 순으로 정착한다
    pending[2].resolve(okResponse({ items: [commentItem("댓글3")] }));
    pending[0].resolve(okResponse({ items: [commentItem("댓글1")] }));
    pending[1].resolve(okResponse({ items: [commentItem("댓글2")] }));

    const voices = await collecting;

    expect(voices.map((v) => v.video.videoId)).toEqual(["v1", "v2", "v3"]);
    expect(voices.map((v) => v.comments[0].videoId)).toEqual(["v1", "v2", "v3"]);
  });
});
