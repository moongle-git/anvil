import { afterEach, describe, expect, it, vi } from "vitest";
import {
  RESEARCH_SOURCE_IDS,
  SOURCE_LABELS,
  type CommunityVoice,
  type ResearchSourceId,
} from "../types/index.js";
import { collectAll } from "./collect.js";
import type { ResearchSource } from "./types.js";

function voice(source: ResearchSourceId, text: string): CommunityVoice {
  return {
    source,
    title: `${SOURCE_LABELS[source]} 문서`,
    url: `https://example.com/${source}`,
    text,
  };
}

/** collect의 정착 시점을 테스트가 직접 통제한다 — 병렬성을 관찰하기 위해 */
function deferredSource(id: ResearchSourceId): {
  source: ResearchSource;
  collect: ReturnType<typeof vi.fn>;
  resolve: (voices: CommunityVoice[]) => void;
} {
  let resolve!: (voices: CommunityVoice[]) => void;
  const pending = new Promise<CommunityVoice[]>((r) => {
    resolve = r;
  });
  const collect = vi.fn().mockReturnValue(pending);
  return {
    source: { id, label: SOURCE_LABELS[id], collect },
    collect,
    resolve,
  };
}

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

const ALL_QUERIES: Record<ResearchSourceId, string> = {
  youtube: "반려식물 물주기 실패",
  hackernews: "plant care app",
  naver: "식물 키우기 실패 후기",
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("collectAll (병렬 수집)", () => {
  it("모든 소스를 동시에 시작한다 — 첫 소스가 정착하기 전에 나머지도 이미 호출됐다", async () => {
    const yt = deferredSource("youtube");
    const hn = deferredSource("hackernews");
    const nv = deferredSource("naver");

    // await하지 않는다 — 순차 구현이면 첫 소스만 호출된 채 여기서 멈춘다
    const pending = collectAll([yt.source, hn.source, nv.source], ALL_QUERIES);

    await Promise.resolve();

    expect(yt.collect).toHaveBeenCalledTimes(1);
    expect(hn.collect).toHaveBeenCalledTimes(1);
    expect(nv.collect).toHaveBeenCalledTimes(1);

    yt.resolve([voice("youtube", "물주기를 놓쳤다")]);
    hn.resolve([]);
    nv.resolve([]);

    const evidence = await pending;
    expect(evidence.voices).toHaveLength(1);
  });

  it("각 소스는 자기 쿼리를 받는다", async () => {
    const sources = RESEARCH_SOURCE_IDS.map((id) => fakeSource(id, []));

    await collectAll(sources, ALL_QUERIES);

    for (const source of sources) {
      expect(source.collect).toHaveBeenCalledWith(ALL_QUERIES[source.id]);
    }
  });

  it("성공한 소스의 목소리를 모아 반환한다", async () => {
    const evidence = await collectAll(
      [
        fakeSource("youtube", [voice("youtube", "댓글")]),
        fakeSource("hackernews", [
          voice("hackernews", "comment"),
          voice("hackernews", "story"),
        ]),
      ],
      ALL_QUERIES,
    );

    expect(evidence.voices.map((v) => v.text)).toEqual([
      "댓글",
      "comment",
      "story",
    ]);
    expect(evidence.failures).toEqual([]);
  });
});

describe("collectAll (fail-soft)", () => {
  it("한 소스가 실패해도 나머지 소스의 목소리를 돌려주고 실패를 기록한다", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const evidence = await collectAll(
      [
        fakeSource("youtube", [voice("youtube", "댓글")]),
        fakeSource(
          "hackernews",
          new Error("Hacker News API 요청 한도를 초과했다 (HTTP 429)"),
        ),
        fakeSource("naver", [voice("naver", "카페글")]),
      ],
      ALL_QUERIES,
    );

    expect(evidence.voices.map((v) => v.source)).toEqual(["youtube", "naver"]);
    expect(evidence.failures).toEqual([
      {
        source: "hackernews",
        message: "Hacker News API 요청 한도를 초과했다 (HTTP 429)",
      },
    ]);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain("429");
  });

  it("전부 실패해도 throw하지 않는다 — 웹검색만으로 파이프라인이 계속되어야 한다", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const evidence = await collectAll(
      RESEARCH_SOURCE_IDS.map((id) => fakeSource(id, new Error(`${id} 실패`))),
      ALL_QUERIES,
    );

    expect(evidence.voices).toEqual([]);
    expect(evidence.failures.map((f) => f.source)).toEqual([
      ...RESEARCH_SOURCE_IDS,
    ]);
  });

  it("Error가 아닌 값으로 reject해도 문자열 메시지로 기록한다", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const source: ResearchSource = {
      id: "naver",
      label: SOURCE_LABELS.naver,
      collect: vi.fn().mockRejectedValue("문자열 실패"),
    };

    const evidence = await collectAll([source], ALL_QUERIES);

    expect(evidence.failures).toEqual([
      { source: "naver", message: "문자열 실패" },
    ]);
  });

  it("소스 배열이 비면 호출 없이 빈 결과를 반환한다", async () => {
    const unused = fakeSource("youtube", [voice("youtube", "댓글")]);

    const evidence = await collectAll([], ALL_QUERIES);

    expect(evidence).toEqual({ voices: [], failures: [] });
    expect(unused.collect).not.toHaveBeenCalled();
  });
});
