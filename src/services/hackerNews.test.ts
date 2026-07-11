import { describe, expect, it, vi } from "vitest";
import {
  HackerNewsApiError,
  HackerNewsService,
  type HackerNewsServiceOptions,
} from "./hackerNews.js";

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
  options: Partial<HackerNewsServiceOptions> = {},
): HackerNewsService {
  return new HackerNewsService({
    fetchFn: fetchFn as unknown as typeof fetch,
    ...options,
  });
}

function storyHit(objectID: string, overrides: Record<string, unknown> = {}): unknown {
  return {
    objectID,
    title: `제목-${objectID}`,
    url: `https://example.com/${objectID}`,
    author: `작성자-${objectID}`,
    points: 42,
    num_comments: 7,
    ...overrides,
  };
}

function commentHit(
  objectID: string,
  overrides: Record<string, unknown> = {},
): unknown {
  return {
    objectID,
    comment_text: `코멘트-${objectID}`,
    author: `작성자-${objectID}`,
    story_id: 111,
    story_title: `스토리-${objectID}`,
    story_url: `https://example.com/story-${objectID}`,
    ...overrides,
  };
}

function hits(...items: unknown[]): unknown {
  return { hits: items, nbHits: items.length, page: 0 };
}

/** 테스트가 정착 시점을 직접 제어하는 promise — 병렬성 검증에 쓴다. */
function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe("HackerNewsService.searchStories", () => {
  it("스토리 검색 결과를 HackerNewsStory 배열로 매핑한다", async () => {
    const fetchFn = fakeFetch(jsonResponse(hits(storyHit("s1"))));

    const stories = await service(fetchFn).searchStories("ai meeting notes");

    expect(stories).toEqual([
      {
        objectId: "s1",
        title: "제목-s1",
        url: "https://example.com/s1",
        author: "작성자-s1",
        points: 42,
        numComments: 7,
      },
    ]);
  });

  it("search 엔드포인트에 tags=story, hitsPerPage, numericFilters(points 하한)를 담아 요청한다", async () => {
    const fetchFn = fakeFetch(jsonResponse(hits()));

    await service(fetchFn, { maxStories: 3, minPoints: 25 }).searchStories(
      "ai meeting notes",
    );

    expect(fetchFn).toHaveBeenCalledTimes(1);
    const url = new URL(fetchFn.mock.calls[0][0] as string);
    expect(url.pathname).toBe("/api/v1/search");
    expect(url.searchParams.get("tags")).toBe("story");
    expect(url.searchParams.get("query")).toBe("ai meeting notes");
    expect(url.searchParams.get("hitsPerPage")).toBe("3");
    expect(url.searchParams.get("numericFilters")).toBe("points>=25");
  });

  it("Ask HN처럼 url이 null인 스토리는 HN 아이템 퍼머링크로 폴백한다", async () => {
    const fetchFn = fakeFetch(jsonResponse(hits(storyHit("ask1", { url: null }))));

    const stories = await service(fetchFn).searchStories("q");

    expect(stories[0].url).toBe("https://news.ycombinator.com/item?id=ask1");
  });

  it("url이 빈 문자열인 스토리도 퍼머링크로 폴백한다", async () => {
    const fetchFn = fakeFetch(jsonResponse(hits(storyHit("s2", { url: "" }))));

    const stories = await service(fetchFn).searchStories("q");

    expect(stories[0].url).toBe("https://news.ycombinator.com/item?id=s2");
  });

  it("objectID가 없는 hit은 조용히 건너뛴다", async () => {
    const fetchFn = fakeFetch(
      jsonResponse(hits({ title: "objectID 없음" }, storyHit("ok1"))),
    );

    const stories = await service(fetchFn).searchStories("q");

    expect(stories.map((s) => s.objectId)).toEqual(["ok1"]);
  });

  it("빈 필드는 기본값으로 채운다", async () => {
    const fetchFn = fakeFetch(jsonResponse(hits({ objectID: "bare" })));

    const stories = await service(fetchFn).searchStories("q");

    expect(stories[0]).toEqual({
      objectId: "bare",
      title: "",
      url: "https://news.ycombinator.com/item?id=bare",
      author: "",
      points: 0,
      numComments: 0,
    });
  });

  it("API가 maxStories보다 많이 반환해도 maxStories개로 제한한다", async () => {
    const fetchFn = fakeFetch(
      jsonResponse(hits(storyHit("a"), storyHit("b"), storyHit("c"), storyHit("d"))),
    );

    const stories = await service(fetchFn, { maxStories: 2 }).searchStories("q");

    expect(stories.map((s) => s.objectId)).toEqual(["a", "b"]);
  });

  it("hits가 없는 응답에도 빈 배열을 반환한다", async () => {
    const fetchFn = fakeFetch(jsonResponse({}));

    await expect(service(fetchFn).searchStories("q")).resolves.toEqual([]);
  });

  it("fetch에 취소용 signal을 실어 요청한다", async () => {
    const fetchFn = fakeFetch(jsonResponse(hits()));

    await service(fetchFn).searchStories("q");

    expect(fetchFn.mock.calls[0][1]?.signal).toBeInstanceOf(AbortSignal);
  });

  it("응답이 timeoutMs 내에 오지 않으면 시간 초과로 실패한다 (hang 방지)", async () => {
    // 영원히 완료되지 않는 fetch — 네트워크 hang을 재현한다
    const fetchFn = vi.fn().mockReturnValue(new Promise(() => undefined));

    await expect(
      service(fetchFn, { timeoutMs: 10 }).searchStories("q"),
    ).rejects.toThrow(/시간 초과/);
  });
});

describe("HackerNewsService.searchComments", () => {
  it("코멘트 검색 결과를 HackerNewsComment 배열로 매핑한다", async () => {
    const fetchFn = fakeFetch(jsonResponse(hits(commentHit("c1"))));

    const comments = await service(fetchFn).searchComments("q");

    expect(comments).toEqual([
      {
        objectId: "c1",
        text: "코멘트-c1",
        author: "작성자-c1",
        storyTitle: "스토리-c1",
        url: "https://news.ycombinator.com/item?id=c1",
      },
    ]);
  });

  it("search 엔드포인트에 tags=comment, hitsPerPage를 담아 요청한다", async () => {
    const fetchFn = fakeFetch(jsonResponse(hits()));

    await service(fetchFn, { maxComments: 8 }).searchComments("ai meeting notes");

    const url = new URL(fetchFn.mock.calls[0][0] as string);
    expect(url.pathname).toBe("/api/v1/search");
    expect(url.searchParams.get("tags")).toBe("comment");
    expect(url.searchParams.get("query")).toBe("ai meeting notes");
    expect(url.searchParams.get("hitsPerPage")).toBe("8");
  });

  it("코멘트 url은 story_url이 아니라 코멘트 퍼머링크다", async () => {
    // story_url이 null이어도 인용 출처(코멘트 퍼머링크)는 항상 유효해야 한다
    const fetchFn = fakeFetch(
      jsonResponse(hits(commentHit("c9", { story_url: null }))),
    );

    const comments = await service(fetchFn).searchComments("q");

    expect(comments[0].url).toBe("https://news.ycombinator.com/item?id=c9");
  });

  it("comment_text의 HTML 태그·엔티티를 제거한다 (<p>는 개행이 된다)", async () => {
    const fetchFn = fakeFetch(
      jsonResponse(
        hits(
          commentHit("c1", {
            comment_text:
              "I don&#x27;t buy it.<p>Already solved by <a href=\"https://x.com\" rel=\"nofollow\">X</a> &amp; Y.",
          }),
        ),
      ),
    );

    const comments = await service(fetchFn).searchComments("q");

    expect(comments[0].text).toBe("I don't buy it.\nAlready solved by X & Y.");
  });

  it("1200자를 초과하는 코멘트는 자르지 않고 드롭한다", async () => {
    const essay = "a".repeat(1201);
    const fetchFn = fakeFetch(
      jsonResponse(
        hits(commentHit("long", { comment_text: essay }), commentHit("short")),
      ),
    );

    const comments = await service(fetchFn).searchComments("q");

    expect(comments.map((c) => c.objectId)).toEqual(["short"]);
    // 잘린 조각이 "원문 그대로 인용"으로 리포트에 실리면 인용 계약이 깨진다
    for (const comment of comments) {
      expect(comment.text.endsWith("…")).toBe(false);
      expect(comment.text.length).toBeLessThanOrEqual(1200);
    }
  });

  it("길이 판단은 stripHtml 적용 후 기준이다", async () => {
    // 태그를 포함하면 1200자를 넘지만, 평문으로는 넘지 않는다 → 남아야 한다
    const fetchFn = fakeFetch(
      jsonResponse(
        hits(
          commentHit("c1", {
            comment_text: `${"<b>a</b>".repeat(200)}`,
          }),
        ),
      ),
    );

    const comments = await service(fetchFn).searchComments("q");

    expect(comments).toHaveLength(1);
    expect(comments[0].text).toBe("a".repeat(200));
  });

  it("objectID 없는 hit과 comment_text 없는 hit은 조용히 건너뛴다", async () => {
    const fetchFn = fakeFetch(
      jsonResponse(
        hits(
          commentHit("c1", { objectID: undefined }),
          commentHit("c2", { comment_text: null }),
          commentHit("c3", { comment_text: undefined }),
          commentHit("ok1"),
        ),
      ),
    );

    const comments = await service(fetchFn).searchComments("q");

    expect(comments.map((c) => c.objectId)).toEqual(["ok1"]);
  });

  it("API가 maxComments보다 많이 반환해도 maxComments개로 제한한다", async () => {
    const fetchFn = fakeFetch(
      jsonResponse(
        hits(commentHit("a"), commentHit("b"), commentHit("c"), commentHit("d")),
      ),
    );

    const comments = await service(fetchFn, { maxComments: 2 }).searchComments("q");

    expect(comments.map((c) => c.objectId)).toEqual(["a", "b"]);
  });

  it("hits가 없는 응답에도 빈 배열을 반환한다", async () => {
    const fetchFn = fakeFetch(jsonResponse({}));

    await expect(service(fetchFn).searchComments("q")).resolves.toEqual([]);
  });
});

describe("HackerNewsService.collect", () => {
  it("스토리와 코멘트를 함께 반환한다", async () => {
    const fetchFn = fakeFetch(
      jsonResponse(hits(storyHit("s1"))),
      jsonResponse(hits(commentHit("c1"))),
    );

    const { stories, comments } = await service(fetchFn).collect("q");

    expect(stories.map((s) => s.objectId)).toEqual(["s1"]);
    expect(comments.map((c) => c.objectId)).toEqual(["c1"]);
  });

  it("fetchFn을 정확히 2회 호출한다 (스토리별 댓글 트리 순회 금지 — N+1 회귀 가드)", async () => {
    const fetchFn = fakeFetch(
      jsonResponse(hits(storyHit("s1"), storyHit("s2"), storyHit("s3"))),
      jsonResponse(hits(commentHit("c1"), commentHit("c2"))),
    );

    await service(fetchFn).collect("q");

    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it("두 요청을 병렬로 보낸다 — 첫 응답을 기다리지 않는다", async () => {
    const storyCall = deferred<unknown>();
    const commentCall = deferred<unknown>();
    const fetchFn = vi
      .fn()
      .mockReturnValueOnce(storyCall.promise)
      .mockReturnValueOnce(commentCall.promise);

    const collected = service(fetchFn).collect("q");

    // 첫 요청이 아직 정착하지 않았는데도 두 번째 요청이 이미 나가 있어야 한다
    await Promise.resolve();
    await Promise.resolve();
    expect(fetchFn).toHaveBeenCalledTimes(2);

    storyCall.resolve({
      ok: true,
      status: 200,
      json: () => Promise.resolve(hits(storyHit("s1"))),
    });
    commentCall.resolve({
      ok: true,
      status: 200,
      json: () => Promise.resolve(hits(commentHit("c1"))),
    });

    const { stories, comments } = await collected;
    expect(stories).toHaveLength(1);
    expect(comments).toHaveLength(1);
  });
});

describe("HackerNewsService 에러 처리", () => {
  it("429면 한도 초과 메시지를 담은 HackerNewsApiError를 던진다", async () => {
    const fetchFn = fakeFetch(
      jsonResponse({ message: "Rate limit exceeded" }, 429),
    );

    const error = await service(fetchFn)
      .searchStories("q")
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(HackerNewsApiError);
    expect((error as HackerNewsApiError).status).toBe(429);
    expect((error as HackerNewsApiError).message).toMatch(/한도/);
    expect((error as HackerNewsApiError).message).toMatch(/Rate limit exceeded/);
  });

  it("500이면 한국어 실패 메시지를 담은 HackerNewsApiError를 던진다", async () => {
    const fetchFn = fakeFetch(jsonResponse({ message: "Internal error" }, 500));

    const error = await service(fetchFn)
      .searchComments("q")
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(HackerNewsApiError);
    expect((error as HackerNewsApiError).status).toBe(500);
    expect((error as HackerNewsApiError).message).toMatch(
      /Hacker News API 요청이 실패했다 \(HTTP 500\)/,
    );
  });

  it("에러 본문이 JSON이 아니어도 throw하지 않고 HackerNewsApiError로 감싼다", async () => {
    const fetchFn = vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 503,
      statusText: "Service Unavailable",
      json: () => Promise.reject(new Error("not json")),
    });

    const error = await service(fetchFn)
      .searchStories("q")
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(HackerNewsApiError);
    expect((error as HackerNewsApiError).status).toBe(503);
  });
});

describe("HackerNewsService 기본값", () => {
  it("API 키 없이 옵션 없이도 생성된다", () => {
    expect(() => new HackerNewsService()).not.toThrow();
    expect(() => new HackerNewsService({})).not.toThrow();
  });

  it("기본 상한은 스토리 5건 / 코멘트 12건 / minPoints 10이다", async () => {
    const fetchFn = fakeFetch(jsonResponse(hits()), jsonResponse(hits()));

    await service(fetchFn).collect("q");

    const storyUrl = new URL(fetchFn.mock.calls[0][0] as string);
    const commentUrl = new URL(fetchFn.mock.calls[1][0] as string);
    expect(storyUrl.searchParams.get("hitsPerPage")).toBe("5");
    expect(storyUrl.searchParams.get("numericFilters")).toBe("points>=10");
    expect(commentUrl.searchParams.get("hitsPerPage")).toBe("12");
  });
});
