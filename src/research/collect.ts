import {
  RESEARCH_SOURCE_IDS,
  type CommunityVoice,
  type ResearchSourceId,
  type SourceCoverage,
} from "../types/index.js";
import type { CollectedEvidence, ResearchSource, SourceFailure } from "./types.js";

/**
 * 등록된 소스를 병렬 수집한다 (ADR-012).
 *
 * - `Promise.allSettled`이므로 지연은 sum(소스)이 아니라 max(소스)다.
 * - 절대 throw하지 않는다. 일부 소스가 죽어도, 전부 죽어도 파이프라인은 웹검색만으로 완주해야 한다 —
 *   실패는 failures[]에 남아 프롬프트에 근거 부재로 진술된다.
 * - coverage[]는 등록되지 않은 소스까지 포함한 소스 3종 전체의 결과다 (ADR-013). 키가 없어
 *   배열에 들어오지 못한 소스는 failures[]에 잡히지 않는다 — 실패가 아니라 부재이기 때문이다.
 *   그 부재가 어디에도 기록되지 않으면 리포트는 "네이버 조사를 했다"고 거짓말한다.
 */
export async function collectAll(
  sources: readonly ResearchSource[],
  queries: Record<ResearchSourceId, string>,
): Promise<CollectedEvidence> {
  const settled = await Promise.allSettled(
    sources.map((source) => source.collect(queries[source.id])),
  );

  const voices: CommunityVoice[] = [];
  const failures: SourceFailure[] = [];
  const attempted = new Map<ResearchSourceId, SourceCoverage>();

  settled.forEach((result, index) => {
    const source = sources[index];
    if (result.status === "fulfilled") {
      voices.push(...result.value);
      // count 0도 collected다 — 소스는 켜져 있었고 검색은 됐는데 0건인 것이다. unconfigured와 다르다
      attempted.set(source.id, {
        source: source.id,
        status: "collected",
        count: result.value.length,
      });
      return;
    }
    const message =
      result.reason instanceof Error
        ? result.reason.message
        : String(result.reason);
    failures.push({ source: source.id, message });
    attempted.set(source.id, {
      source: source.id,
      status: "failed",
      count: 0,
      error: message,
    });
    console.warn(
      `[research] ${source.label} 수집 실패 — 나머지 소스로 진행한다: ${message}`,
    );
  });

  const coverage = RESEARCH_SOURCE_IDS.map(
    (id): SourceCoverage =>
      attempted.get(id) ?? { source: id, status: "unconfigured", count: 0 },
  );

  return { voices, failures, coverage };
}
