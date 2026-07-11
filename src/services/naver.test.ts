import { describe, expect, it, vi } from "vitest";
import {
  NaverApiError,
  NaverService,
  type NaverCorpus,
  type NaverServiceOptions,
} from "./naver.js";

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
  options: Partial<NaverServiceOptions> = {},
): NaverService {
  return new NaverService({
    clientId: "test-client-id",
    clientSecret: "test-client-secret",
    fetchFn: fetchFn as unknown as typeof fetch,
    ...options,
  });
}

function item(overrides: Record<string, unknown> = {}): unknown {
  return {
    title: "AI 회의록 후기",
    link: "https://cafe.naver.com/example/1",
    description: "직접 써봤는데 정리가 엉망이었다",
    ...overrides,
  };
}

function items(...list: unknown[]): unknown {
  return { lastBuildDate: "Sat, 11 Jul 2026 09:00:00 +0900", total: list.length, start: 1, display: list.length, items: list };
}

/** 요청 헤더를 타입 단언 없이 읽기 위한 헬퍼 — mock 인자는 unknown이다. */
function requestHeaders(
  fetchFn: ReturnType<typeof vi.fn>,
  callIndex: number,
): Record<string, string> {
  const init = fetchFn.mock.calls[callIndex][1] as {
    headers?: Record<string, string>;
  };
  return init.headers ?? {};
}

function requestedCorpora(fetchFn: ReturnType<typeof vi.fn>): string[] {
  return fetchFn.mock.calls.map((call) => {
    const url = new URL(call[0] as string);
    return url.pathname.replace("/v1/search/", "").replace(".json", "");
  });
}

/** 테스트가 정착 시점을 직접 제어하는 promise — 병렬성 검증에 쓴다. */
function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe("NaverService 인증", () => {
  // 네이버는 API 키를 URL 파라미터로 받지 않는다. YoutubeService.request()를 복붙하면
  // 헤더 없이 요청이 나가 401로 조용히 죽는다 — 이 서비스의 1순위 계약이다.
  it("X-Naver-Client-Id / X-Naver-Client-Secret 헤더로 인증한다", async () => {
    const fetchFn = fakeFetch(jsonResponse(items()));

    await service(fetchFn).search("cafearticle", "AI 회의록");

    expect(requestHeaders(fetchFn, 0)).toMatchObject({
      "X-Naver-Client-Id": "test-client-id",
      "X-Naver-Client-Secret": "test-client-secret",
    });
  });

  it("자격증명을 URL 쿼리 파라미터로 보내지 않는다", async () => {
    const fetchFn = fakeFetch(jsonResponse(items()));

    await service(fetchFn).search("cafearticle", "AI 회의록");

    const url = fetchFn.mock.calls[0][0] as string;
    expect(url).not.toContain("test-client-id");
    expect(url).not.toContain("test-client-secret");
  });

  it("collect의 모든 corpus 요청에 인증 헤더를 싣는다", async () => {
    const fetchFn = fakeFetch(
      jsonResponse(items()),
      jsonResponse(items()),
      jsonResponse(items()),
    );

    await service(fetchFn).collect("AI 회의록");

    for (let index = 0; index < 3; index += 1) {
      expect(requestHeaders(fetchFn, index)).toMatchObject({
        "X-Naver-Client-Id": "test-client-id",
        "X-Naver-Client-Secret": "test-client-secret",
      });
    }
  });
});

describe("NaverService.search", () => {
  it("검색 결과를 NaverPost 배열로 매핑한다", async () => {
    const fetchFn = fakeFetch(
      jsonResponse(
        items(
          item({
            title: "AI 회의록 후기",
            link: "https://cafe.naver.com/example/1",
            description: "정리가 엉망이었다",
            cafename: "직장인카페",
          }),
        ),
      ),
    );

    const posts = await service(fetchFn).search("cafearticle", "AI 회의록");

    expect(posts).toEqual([
      {
        corpus: "cafearticle",
        title: "AI 회의록 후기",
        link: "https://cafe.naver.com/example/1",
        description: "정리가 엉망이었다",
        authorName: "직장인카페",
      },
    ]);
  });

  it("corpus별 엔드포인트에 query·display·sort=sim을 담아 요청한다", async () => {
    const fetchFn = fakeFetch(jsonResponse(items()));

    await service(fetchFn).search("cafearticle", "AI 회의록");

    expect(fetchFn).toHaveBeenCalledTimes(1);
    const url = new URL(fetchFn.mock.calls[0][0] as string);
    expect(url.host).toBe("openapi.naver.com");
    expect(url.pathname).toBe("/v1/search/cafearticle.json");
    expect(url.searchParams.get("query")).toBe("AI 회의록");
    expect(url.searchParams.get("display")).toBe("5");
    expect(url.searchParams.get("sort")).toBe("sim");
  });

  it("blog는 bloggername·postdate를 매핑한다", async () => {
    const fetchFn = fakeFetch(
      jsonResponse(
        items(
          item({
            link: "https://blog.naver.com/example/2",
            bloggername: "기획자J",
            postdate: "20260701",
          }),
        ),
      ),
    );

    const posts = await service(fetchFn).search("blog", "AI 회의록");

    expect(posts[0]).toMatchObject({
      corpus: "blog",
      authorName: "기획자J",
      postedAt: "20260701",
    });
  });

  it("kin은 작성자가 없으므로 authorName을 채우지 않는다", async () => {
    const fetchFn = fakeFetch(
      jsonResponse(items(item({ link: "https://kin.naver.com/qna/3" }))),
    );

    const posts = await service(fetchFn).search("kin", "AI 회의록");

    expect(posts[0].authorName).toBeUndefined();
    expect(posts[0].postedAt).toBeUndefined();
  });

  it("title·description의 <b> 하이라이트 태그와 HTML 엔티티를 제거한다", async () => {
    const fetchFn = fakeFetch(
      jsonResponse(
        items(
          item({
            title: "<b>AI 회의록</b> 써본 후기 &amp; 단점",
            description:
              "요약이 &quot;그럴듯&quot;하기만 하고 <b>회의록</b>으로 못 쓴다&#39;는 느낌...",
          }),
        ),
      ),
    );

    const posts = await service(fetchFn).search("cafearticle", "AI 회의록");

    expect(posts[0].title).toBe("AI 회의록 써본 후기 & 단점");
    expect(posts[0].description).toBe(
      "요약이 \"그럴듯\"하기만 하고 회의록으로 못 쓴다'는 느낌...",
    );
  });

  it("link가 없는 item은 조용히 건너뛴다", async () => {
    // CommunityVoice.url이 z.url()이라 빈 link가 새어나가면 스키마 검증이 깨진다
    const fetchFn = fakeFetch(
      jsonResponse(
        items(
          item({ link: undefined }),
          item({ link: "" }),
          item({ link: "https://cafe.naver.com/example/ok" }),
        ),
      ),
    );

    const posts = await service(fetchFn).search("cafearticle", "q");

    expect(posts.map((post) => post.link)).toEqual([
      "https://cafe.naver.com/example/ok",
    ]);
  });

  it("빈 필드는 기본값으로 채운다", async () => {
    const fetchFn = fakeFetch(
      jsonResponse(items({ link: "https://cafe.naver.com/example/bare" })),
    );

    const posts = await service(fetchFn).search("cafearticle", "q");

    expect(posts[0]).toEqual({
      corpus: "cafearticle",
      title: "",
      link: "https://cafe.naver.com/example/bare",
      description: "",
    });
  });

  it("items가 없는 응답에도 빈 배열을 반환한다", async () => {
    const fetchFn = fakeFetch(jsonResponse({}));

    await expect(service(fetchFn).search("kin", "q")).resolves.toEqual([]);
  });

  it("API가 display보다 많이 반환해도 display개로 제한한다", async () => {
    const fetchFn = fakeFetch(
      jsonResponse(
        items(
          item({ link: "https://cafe.naver.com/example/1" }),
          item({ link: "https://cafe.naver.com/example/2" }),
          item({ link: "https://cafe.naver.com/example/3" }),
          item({ link: "https://cafe.naver.com/example/4" }),
        ),
      ),
    );

    const posts = await service(fetchFn, { display: 2 }).search("cafearticle", "q");

    expect(posts).toHaveLength(2);
    expect(new URL(fetchFn.mock.calls[0][0] as string).searchParams.get("display")).toBe(
      "2",
    );
  });

  it("fetch에 취소용 signal을 실어 요청한다", async () => {
    const fetchFn = fakeFetch(jsonResponse(items()));

    await service(fetchFn).search("cafearticle", "q");

    const init = fetchFn.mock.calls[0][1] as { signal?: unknown };
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("응답이 timeoutMs 내에 오지 않으면 시간 초과로 실패한다 (hang 방지)", async () => {
    // 영원히 완료되지 않는 fetch — 네트워크 hang을 재현한다
    const fetchFn = vi.fn().mockReturnValue(new Promise(() => undefined));

    await expect(
      service(fetchFn, { timeoutMs: 10 }).search("cafearticle", "q"),
    ).rejects.toThrow(/시간 초과/);
  });
});

describe("NaverService.collect", () => {
  it("기본 corpus 3종(cafearticle·kin·blog)을 신호 품질 순으로 호출한다", async () => {
    const fetchFn = fakeFetch(
      jsonResponse(items(item({ link: "https://cafe.naver.com/example/1" }))),
      jsonResponse(items(item({ link: "https://kin.naver.com/qna/2" }))),
      jsonResponse(items(item({ link: "https://blog.naver.com/example/3" }))),
    );

    const posts = await service(fetchFn).collect("AI 회의록");

    expect(fetchFn).toHaveBeenCalledTimes(3);
    expect(requestedCorpora(fetchFn)).toEqual(["cafearticle", "kin", "blog"]);
    expect(posts.map((post) => post.corpus)).toEqual([
      "cafearticle",
      "kin",
      "blog",
    ]);
  });

  it("corpus 3개 × display 5 = 최대 15건이다 (프롬프트 토큰 방어)", async () => {
    const many = (prefix: string): unknown =>
      items(
        ...Array.from({ length: 10 }, (_value, index) =>
          item({ link: `https://naver.com/${prefix}/${index}` }),
        ),
      );
    const fetchFn = fakeFetch(
      jsonResponse(many("cafe")),
      jsonResponse(many("kin")),
      jsonResponse(many("blog")),
    );

    const posts = await service(fetchFn).collect("q");

    expect(posts).toHaveLength(15);
  });

  it("corpus들을 병렬 호출한다 — 첫 응답을 기다리지 않는다", async () => {
    const calls = [deferred<unknown>(), deferred<unknown>(), deferred<unknown>()];
    const fetchFn = vi
      .fn()
      .mockReturnValueOnce(calls[0].promise)
      .mockReturnValueOnce(calls[1].promise)
      .mockReturnValueOnce(calls[2].promise);

    const collected = service(fetchFn).collect("q");

    // 첫 요청이 아직 정착하지 않았는데도 나머지 요청이 이미 나가 있어야 한다
    await Promise.resolve();
    await Promise.resolve();
    expect(fetchFn).toHaveBeenCalledTimes(3);

    for (const call of calls) {
      call.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve(items(item())),
      });
    }

    await expect(collected).resolves.toHaveLength(3);
  });

  it("일부 corpus가 실패해도 성공한 corpus의 결과를 반환한다 (fail-soft)", async () => {
    const fetchFn = fakeFetch(
      jsonResponse({ errorMessage: "서버 오류", errorCode: "500" }, 500),
      jsonResponse(items(item({ link: "https://kin.naver.com/qna/2" }))),
      jsonResponse(items(item({ link: "https://blog.naver.com/example/3" }))),
    );

    const posts = await service(fetchFn).collect("q");

    expect(posts.map((post) => post.corpus)).toEqual(["kin", "blog"]);
  });

  it("corpus 전부가 실패하면 첫 에러를 throw한다", async () => {
    // 조용히 빈 배열을 반환하면 "검색 결과 0건"과 "네이버가 죽었다"가 구별되지 않는다.
    // step 6의 collectAll이 소스 실패를 failures[]에 기록하려면 이 사실이 위로 전파돼야 한다.
    const fetchFn = fakeFetch(
      jsonResponse({ errorMessage: "인증 실패", errorCode: "024" }, 401),
      jsonResponse({ errorMessage: "서버 오류", errorCode: "500" }, 500),
      jsonResponse({ errorMessage: "서버 오류", errorCode: "500" }, 500),
    );

    const error = await service(fetchFn)
      .collect("q")
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(NaverApiError);
    expect((error as NaverApiError).status).toBe(401);
  });

  it("모든 corpus가 0건이어도 빈 배열을 반환한다 (실패가 아니다)", async () => {
    const fetchFn = fakeFetch(
      jsonResponse(items()),
      jsonResponse(items()),
      jsonResponse(items()),
    );

    await expect(service(fetchFn).collect("q")).resolves.toEqual([]);
  });

  it("corpora 옵션으로 대상 corpus를 좁힐 수 있다", async () => {
    const fetchFn = fakeFetch(jsonResponse(items()));
    const corpora: readonly NaverCorpus[] = ["kin"];

    await service(fetchFn, { corpora }).collect("q");

    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(requestedCorpora(fetchFn)).toEqual(["kin"]);
  });
});

describe("NaverService 에러 처리", () => {
  it("401이면 자격증명을 짚어주는 인증 실패 메시지를 던진다", async () => {
    const fetchFn = fakeFetch(
      jsonResponse({ errorMessage: "Not Exist Client ID", errorCode: "024" }, 401),
    );

    const error = await service(fetchFn)
      .search("cafearticle", "q")
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(NaverApiError);
    expect((error as NaverApiError).status).toBe(401);
    expect((error as NaverApiError).errorCode).toBe("024");
    expect((error as NaverApiError).message).toMatch(/네이버 API 인증에 실패했다/);
    expect((error as NaverApiError).message).toMatch(/NAVER_CLIENT_ID/);
    expect((error as NaverApiError).message).toMatch(/NAVER_CLIENT_SECRET/);
    expect((error as NaverApiError).message).toMatch(/Not Exist Client ID/);
  });

  it("errorCode가 024면 status가 401이 아니어도 인증 실패로 안내한다", async () => {
    const fetchFn = fakeFetch(
      jsonResponse({ errorMessage: "Not Exist Client ID", errorCode: "024" }, 400),
    );

    const error = await service(fetchFn)
      .search("cafearticle", "q")
      .catch((caught: unknown) => caught);

    expect((error as NaverApiError).message).toMatch(/네이버 API 인증에 실패했다/);
  });

  it("429면 일일 호출 한도 초과 메시지를 던진다", async () => {
    const fetchFn = fakeFetch(
      jsonResponse({ errorMessage: "Quota Exceeded", errorCode: "012" }, 429),
    );

    const error = await service(fetchFn)
      .search("blog", "q")
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(NaverApiError);
    expect((error as NaverApiError).status).toBe(429);
    expect((error as NaverApiError).message).toMatch(/일일 호출 한도\(25,000\)를 초과했다/);
    expect((error as NaverApiError).message).toMatch(/Quota Exceeded/);
  });

  it("errorCode가 012면 status가 429가 아니어도 한도 초과로 안내한다", async () => {
    const fetchFn = fakeFetch(
      jsonResponse({ errorMessage: "Quota Exceeded", errorCode: "012" }, 403),
    );

    const error = await service(fetchFn)
      .search("blog", "q")
      .catch((caught: unknown) => caught);

    expect((error as NaverApiError).message).toMatch(/일일 호출 한도/);
  });

  it("예상 못 한 errorCode여도 status 기반 폴백 메시지로 원인을 알린다", async () => {
    // 네이버 문서의 errorCode와 실제 응답이 다를 수 있다 — errorCode만 믿고 분기하면 침묵한다
    const fetchFn = fakeFetch(
      jsonResponse({ errorMessage: "Invalid search api", errorCode: "SE01" }, 400),
    );

    const error = await service(fetchFn)
      .search("kin", "q")
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(NaverApiError);
    expect((error as NaverApiError).status).toBe(400);
    expect((error as NaverApiError).errorCode).toBe("SE01");
    expect((error as NaverApiError).message).toMatch(
      /네이버 검색 API 요청이 실패했다 \(HTTP 400, SE01\)/,
    );
    expect((error as NaverApiError).message).toMatch(/Invalid search api/);
  });

  it("errorCode가 아예 없어도 status 기반 메시지를 만든다", async () => {
    const fetchFn = fakeFetch(jsonResponse({ errorMessage: "서버 오류" }, 500));

    const error = await service(fetchFn)
      .search("kin", "q")
      .catch((caught: unknown) => caught);

    expect((error as NaverApiError).errorCode).toBeUndefined();
    expect((error as NaverApiError).message).toMatch(
      /네이버 검색 API 요청이 실패했다 \(HTTP 500\)/,
    );
  });

  it("에러 본문이 JSON이 아니어도 throw하지 않고 NaverApiError로 감싼다", async () => {
    const fetchFn = vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 503,
      statusText: "Service Unavailable",
      json: () => Promise.reject(new Error("not json")),
    });

    const error = await service(fetchFn)
      .search("blog", "q")
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(NaverApiError);
    expect((error as NaverApiError).status).toBe(503);
    expect((error as NaverApiError).message).toMatch(/Service Unavailable/);
  });
});
