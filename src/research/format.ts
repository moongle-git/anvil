import {
  RESEARCH_SOURCE_IDS,
  SOURCE_LABELS,
  type CommunityVoice,
  type ResearchSourceId,
} from "../types/index.js";
import type { CollectedEvidence, SourceFailure } from "./types.js";

export const EVIDENCE_EMPTY_SECTION =
  "(커뮤니티 수집 결과가 없다. communityVoices는 빈 배열로 출력하고, 웹검색만으로 조사하라.)";

/** 목소리 하나. 원문은 자르지 않고 축자로 싣는다 — 요약본을 인용으로 실으면 리포트가 거짓말을 한다 */
function voiceBlock(voice: CommunityVoice): string {
  const meta = [
    voice.authorName,
    voice.score === undefined ? undefined : `인기도 ${voice.score}`,
    voice.extra,
  ].filter((item): item is string => item !== undefined && item !== "");
  const prefix = meta.length === 0 ? "" : `(${meta.join(", ")}) `;
  return [
    `- ${prefix}${voice.text}`,
    `  - 출처: ${voice.title} — ${voice.url}`,
  ].join("\n");
}

/**
 * 0건인 소스도 "0건"으로 적는다. HN이 한국어 쿼리를 받아 조용히 0건이 되는 실패는
 * 프롬프트에 숫자로 적혀 있어야만 LLM이 voicesInsight에서 근거 부재를 진술한다.
 */
function sourceBlock(id: ResearchSourceId, voices: CommunityVoice[]): string {
  const heading = `### ${SOURCE_LABELS[id]} — ${voices.length}건`;
  if (voices.length === 0) {
    return `${heading}\n- (수집된 항목 없음)`;
  }
  return [heading, ...voices.map(voiceBlock)].join("\n");
}

function failureLine(failure: SourceFailure): string {
  return `(수집 실패: ${SOURCE_LABELS[failure.source]} — ${failure.message})`;
}

export function formatEvidenceSection(evidence: CollectedEvidence): string {
  if (evidence.voices.length === 0 && evidence.failures.length === 0) {
    return EVIDENCE_EMPTY_SECTION;
  }

  const blocks = RESEARCH_SOURCE_IDS.map((id) =>
    sourceBlock(
      id,
      evidence.voices.filter((voice) => voice.source === id),
    ),
  );

  // 실패는 섹션 끝에 명기한다 — "국내 커뮤니티 근거가 없다"를 LLM이 스스로 말하게 하기 위해서다
  if (evidence.failures.length > 0) {
    blocks.push(evidence.failures.map(failureLine).join("\n"));
  }

  return blocks.join("\n\n");
}
