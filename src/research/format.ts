import {
  RESEARCH_SOURCE_IDS,
  SOURCE_LABELS,
  type CommunityVoice,
  type ResearchSourceId,
} from "../types/index.js";
import type { CollectedEvidence, SourceFailure } from "./types.js";

export const EVIDENCE_EMPTY_SECTION =
  "(커뮤니티 수집 결과가 없다. communityVoiceRefs는 빈 배열로 출력하고, 웹검색만으로 조사하라.)";

/** 수집된 목소리의 안정적 ID. evidence.voices의 인덱스 기준 1-origin 전역 연번이다 (ADR-013) */
export function voiceRefId(index: number): string {
  return `V${index + 1}`;
}

/** 선행 0("V01")·0번("V0")·잡문자열은 받지 않는다 — 모르는 참조는 추측하지 않고 드롭한다 */
const VOICE_REF_PATTERN = /^V([1-9]\d*)$/;

/** voiceRefId의 역함수. LLM이 지어낸 형식이면 null — 호출부가 드롭하고 로그를 남긴다 */
export function parseVoiceRef(ref: string): number | null {
  const match = VOICE_REF_PATTERN.exec(ref.trim());
  if (match === null) {
    return null;
  }
  return Number(match[1]) - 1;
}

/**
 * 목소리 하나. 원문은 자르지 않고 축자로 싣는다 — 요약본을 인용으로 실으면 리포트가 거짓말을 한다.
 *
 * URL은 싣지 않는다 (ADR-013). 모델이 볼 수 없는 URL은 받아적을 수도 없다 —
 * 실제로 모델은 코드가 준 URL을 옮겨적다가 도메인 오타(cloud.google.google.com)를 냈다.
 * 선별은 [V*] ID로만 하고, 원문·출처·작성자는 코드가 research 증거에서 복원한다.
 */
function voiceBlock(voice: CommunityVoice, index: number): string {
  const meta = [
    voice.authorName,
    voice.score === undefined ? undefined : `인기도 ${voice.score}`,
    voice.extra,
  ].filter((item): item is string => item !== undefined && item !== "");
  const prefix = meta.length === 0 ? "" : `(${meta.join(", ")}) `;
  return [
    `- [${voiceRefId(index)}] ${prefix}${voice.text}`,
    `  - 출처: ${voice.title}`,
  ].join("\n");
}

/** 목소리와 그 전역 ID 좌표. 소스별로 그룹핑해도 ID는 리셋되지 않는다 */
interface IndexedVoice {
  voice: CommunityVoice;
  index: number;
}

/**
 * 0건인 소스도 "0건"으로 적는다. HN이 한국어 쿼리를 받아 조용히 0건이 되는 실패는
 * 프롬프트에 숫자로 적혀 있어야만 LLM이 voicesInsight에서 근거 부재를 진술한다.
 */
function sourceBlock(id: ResearchSourceId, entries: IndexedVoice[]): string {
  const heading = `### ${SOURCE_LABELS[id]} — ${entries.length}건`;
  if (entries.length === 0) {
    return `${heading}\n- (수집된 항목 없음)`;
  }
  return [
    heading,
    ...entries.map(({ voice, index }) => voiceBlock(voice, index)),
  ].join("\n");
}

function failureLine(failure: SourceFailure): string {
  return `(수집 실패: ${SOURCE_LABELS[failure.source]} — ${failure.message})`;
}

export function formatEvidenceSection(evidence: CollectedEvidence): string {
  if (evidence.voices.length === 0 && evidence.failures.length === 0) {
    return EVIDENCE_EMPTY_SECTION;
  }

  // ID는 소스별로 리셋하지 않는다 — runContextHunter가 ID를 voices[] 인덱스로 되돌려야 하고,
  // 소스별 연번은 서로 충돌한다
  const indexed: IndexedVoice[] = evidence.voices.map((voice, index) => ({
    voice,
    index,
  }));

  const blocks = RESEARCH_SOURCE_IDS.map((id) =>
    sourceBlock(
      id,
      indexed.filter(({ voice }) => voice.source === id),
    ),
  );

  // 실패는 섹션 끝에 명기한다 — "국내 커뮤니티 근거가 없다"를 LLM이 스스로 말하게 하기 위해서다
  if (evidence.failures.length > 0) {
    blocks.push(evidence.failures.map(failureLine).join("\n"));
  }

  return blocks.join("\n\n");
}
