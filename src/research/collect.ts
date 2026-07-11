import type { CommunityVoice, ResearchSourceId } from "../types/index.js";
import type { CollectedEvidence, ResearchSource, SourceFailure } from "./types.js";

/**
 * 등록된 소스를 병렬 수집한다 (ADR-012).
 *
 * - `Promise.allSettled`이므로 지연은 sum(소스)이 아니라 max(소스)다.
 * - 절대 throw하지 않는다. 일부 소스가 죽어도, 전부 죽어도 파이프라인은 웹검색만으로 완주해야 한다 —
 *   실패는 failures[]에 남아 프롬프트에 근거 부재로 진술된다.
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

  settled.forEach((result, index) => {
    const source = sources[index];
    if (result.status === "fulfilled") {
      voices.push(...result.value);
      return;
    }
    const message =
      result.reason instanceof Error
        ? result.reason.message
        : String(result.reason);
    failures.push({ source: source.id, message });
    console.warn(
      `[research] ${source.label} 수집 실패 — 나머지 소스로 진행한다: ${message}`,
    );
  });

  return { voices, failures };
}
