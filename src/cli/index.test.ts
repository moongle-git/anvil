import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildResearchSources } from "./index.js";

/**
 * 키 부재는 "수집 실패"가 아니라 "소스 부재"다 (ADR-012).
 *
 * 키가 없을 때 항상 reject하는 fetchFn을 가진 서비스를 만들면 collectAll이 그것을
 * failures[]에 기록하고, LLM 프롬프트는 "네이버 수집이 실패했다"고 적는다 — 사실은
 * 애초에 키가 없었던 것이다. 두 상황은 다르다. 키가 없으면 배열에 넣지 않는다.
 */

const ALL_KEYS: NodeJS.ProcessEnv = {
  YOUTUBE_API_KEY: "yt-key",
  NAVER_CLIENT_ID: "naver-id",
  NAVER_CLIENT_SECRET: "naver-secret",
};

/** eslint의 no-unused-vars가 rest sibling을 봐주지 않아 구조분해 대신 delete를 쓴다 */
function envWithout(...omit: string[]): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...ALL_KEYS };
  for (const key of omit) {
    delete env[key];
  }
  return env;
}

function ids(env: NodeJS.ProcessEnv): string[] {
  return buildResearchSources(env).map((source) => source.id);
}

let warn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("buildResearchSources", () => {
  it("모든 키가 있으면 세 소스를 전부 등록한다", () => {
    expect(ids(ALL_KEYS)).toEqual(["youtube", "hackernews", "naver"]);
    expect(warn).not.toHaveBeenCalled();
  });

  it("Hacker News는 키가 필요 없어 키가 하나도 없어도 등록된다", () => {
    expect(ids({})).toEqual(["hackernews"]);
  });

  it("YOUTUBE_API_KEY가 없으면 youtube 소스를 등록하지 않고 경고한다", () => {
    expect(ids(envWithout("YOUTUBE_API_KEY"))).toEqual(["hackernews", "naver"]);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("YOUTUBE_API_KEY"));
  });

  it("네이버 키가 없으면 naver 소스를 등록하지 않고 경고한다", () => {
    const env = envWithout("NAVER_CLIENT_ID", "NAVER_CLIENT_SECRET");

    expect(ids(env)).toEqual(["youtube", "hackernews"]);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("NAVER_CLIENT_ID"));
  });

  it("네이버 키가 반쪽만 있으면(ID만) 부재로 취급한다 — 반쪽 서비스는 401로 죽는다", () => {
    expect(ids(envWithout("NAVER_CLIENT_SECRET"))).toEqual(["youtube", "hackernews"]);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("NAVER_CLIENT_SECRET"));
  });

  it("네이버 키가 반쪽만 있으면(SECRET만) 부재로 취급한다", () => {
    expect(ids(envWithout("NAVER_CLIENT_ID"))).toEqual(["youtube", "hackernews"]);
  });

  it("빈 문자열 키는 미설정과 같다", () => {
    expect(
      ids({ YOUTUBE_API_KEY: "", NAVER_CLIENT_ID: "", NAVER_CLIENT_SECRET: "" }),
    ).toEqual(["hackernews"]);
  });

  it("키가 없는 소스는 실패가 아니라 부재다 — 동작할 수 없는 서비스 객체를 만들지 않는다", async () => {
    // 서비스가 생성 시점에 globalThis.fetch를 캡처하므로 먼저 갈아끼운다.
    // HN collect()는 2 round-trip이라 호출마다 새 Response를 줘야 한다 (body는 1회만 읽힌다)
    const fetchFn = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(() =>
        Promise.resolve(new Response(JSON.stringify({ hits: [] }), { status: 200 })),
      );

    const sources = buildResearchSources({});

    // 배열에 없으므로 collect를 부를 대상 자체가 없다. "항상 reject하는 fetchFn"을 심었다면
    // youtube/naver가 배열에 남아 collectAll이 이를 수집 실패로 프롬프트에 적었을 것이다.
    expect(sources.map((s) => s.id)).not.toContain("youtube");
    expect(sources.map((s) => s.id)).not.toContain("naver");

    // 등록된 HN 소스는 진짜 동작하는 객체다 — 키 없이도 실제로 수집을 수행한다
    await expect(sources[0].collect("plant care app")).resolves.toEqual([]);
    expect(fetchFn).toHaveBeenCalled();
  });
});
