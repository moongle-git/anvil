import { collectAll } from "../research/collect.js";
import { formatEvidenceSection, parseVoiceRef } from "../research/format.js";
import type { ResearchSource } from "../research/types.js";
import type { GeminiService } from "../services/gemini.js";
import {
  MarketContextDraftSchema,
  type CommunityVoice,
  type MarketContext,
  type ResearchEvidence,
} from "../types/index.js";
import { planResearchQueries } from "./researchPlanner.js";

/** usage 집계 라벨 = 파이프라인 step 이름 (ADR-016) */
export const CONTEXT_HUNTER_USAGE_LABEL = "context-hunter";

export const CONTEXT_HUNTER_SYSTEM_PROMPT = `당신은 신규 서비스 아이디어의 시장 맥락을 수집·정제하는 리서치 애널리스트다.
웹검색으로 최신 트렌드와 유사/경쟁 서비스를 조사하고, 제공된 커뮤니티 수집 결과(YouTube 댓글·Hacker News 토론·네이버 블로그/카페/지식iN)에서 타겟 유저의 실제 목소리를 선별한다.

## 톤: 건조한 팩트
당신의 산출물은 리포트 1단계 "시장 맥락"이며, 건조하고 팩트 위주로 작성한다.
낙관도 비관도 이 단계의 일이 아니다 — 낙관은 다음 단계의 낙관론자(正)가, 비관은 그다음 비판가(反)가 맡는다.
형용사를 줄이고 수치를 늘려라. "폭발적 성장", "매력적인 시장", "치명적 한계" 같은 평가어를 쓰지 마라.

## 원시 데이터가 아니라 인사이트
수집한 데이터를 그대로 나열하지 말고, 애널리스트의 시각으로 분석해 아래 네 필드에 정제된 인사이트를 담아라.
1. **briefing** — 원시 데이터의 요약이 아니라 애널리스트의 브리핑이다. 3~5문장으로 이 시장이 지금 어떤 상태인지 진술하라.
2. **marketSizeIndicators** — 시장 규모·성장률·사용자 수·거래액 같은 정량 지표만 담는다. 검색으로 확인되지 않으면 추측하지 말고 빈 배열로 두어라.
3. **competitorInsight** — 경쟁사 목록의 나열이 아니라 경쟁 구도에서 읽어낸 판단이다. 어느 가격대가 비어 있는가, 어떤 축에서 차별화가 소진됐는가, 무엇을 아무도 하지 않는가를 한 단락으로 쓴다.
4. **voicesInsight** — 댓글의 요약이 아니라 유저가 실제로 말하지 않은 것까지 읽어낸 해석이다. 무엇을 불평하면서 무엇은 요구하지 않는지, 표면의 불만 아래에 깔린 진짜 동기가 무엇인지 한 단락으로 쓴다.
   수집 결과에 목소리가 하나도 없으면 목소리를 지어내지 말고, 수집된 유저 목소리가 없다는 사실과 그로 인해 수요 판단이 웹검색 근거에만 의존한다는 한계를 진술하라.
   일부 소스의 수집이 실패했거나 0건이면 그 사실과 그로 인한 근거 편향을 진술하라 — 예: 네이버가 실패하면 국내 커뮤니티 근거가 없고, Hacker News가 0건이면 영어권 빌더 담론이 빠져 있다.

## 원시 근거 보존
trends·competitors·communityVoiceRefs·painPointEvidence·sources는 리포트에서 접힌 영역에 들어갈 원시 근거다. 인사이트 필드와 별개로 채워라.
유저 목소리는 네가 다시 받아적지 않는다. 수집 결과의 [V1]·[V2] 같은 ID 중 유의미한 것만 골라 communityVoiceRefs에 담아라 —
인용 원문·출처·작성자는 코드가 그 ID로 복원한다. 존재하지 않는 ID는 드롭되므로 지어내도 소용이 없다.
근거 없는 추측 대신 검색·수집 결과에서 확인된 사실만 담아라.`;

export const CONTEXT_HUNTER_PROMPT_TEMPLATE = `## 아이디어 원문
{idea}

## 커뮤니티 수집 결과
{evidenceSection}

## 지시사항
1. 아래 관점으로 웹검색(Google Search)하라:
{webQueryHints}
   이 아이디어와 관련된 최신 트렌드, 유사/경쟁 서비스(이름·설명·URL·가격 힌트), 시장 규모·성장률 지표를 조사하라.
2. 경쟁 서비스를 찾으면 그 공식 페이지를 직접 읽어 가격·기능을 확인하라. 단 가장 중요한 3곳 이하만 읽어라.
3. 위 커뮤니티 수집 결과에서 노이즈(광고, 인사말, 무관한 잡담)를 제거하고, 아이디어의 페인포인트와 관련된 유의미한 유저 목소리만 골라 그 [V*] ID를 communityVoiceRefs에 담아라.
   - 수집 결과 섹션에 실제로 있는 ID만 쓰고, 새 ID를 만들어내지 마라. 없는 ID는 코드가 드롭한다.
   - 인용 원문·출처·작성자를 다시 적지 마라. ID만 적으면 코드가 원문을 붙인다.
   - 유의미한 목소리가 하나도 없으면 빈 배열로 두어라.
   - 네이버 항목("검색 스니펫"으로 표시된 항목)은 게시글 본문이 아니라 검색 스니펫이다. 잘린 문장을 완결된 주장으로 해석하지 마라.
4. 트렌드·경쟁 서비스·유저 목소리에서 드러나는 실제 페인포인트 근거를 정리하라.
5. 수집한 원시 데이터를 분석해 briefing·marketSizeIndicators·competitorInsight·voicesInsight를 작성하라. 원시 데이터의 재나열이 아니라 애널리스트의 판단이어야 한다.

## 출력 형식
아래 구조의 JSON만 출력하라. 키를 하나라도 빠뜨리면 검증에 실패한다:
{
  "ideaTitle": "아이디어를 요약한 제목 (string)",
  "briefing": "이 시장이 지금 어떤 상태인지 3~5문장으로 진술한 건조한 브리핑 (string)",
  "marketSizeIndicators": ["시장 규모·성장률 등 정량 지표 (string 배열, 검색으로 확인 못 하면 빈 배열)"],
  "competitorInsight": "경쟁 구도에서 읽어낸 판단 한 단락 (string)",
  "voicesInsight": "유저 목소리에서 읽어낸 해석 한 단락 (string)",
  "trends": ["최신 시장 트렌드 (string 배열)"],
  "competitors": [{ "name": "서비스명", "description": "설명", "url": "URL (선택)", "pricingHint": "가격 힌트 (선택)" }],
  "communityVoiceRefs": ["V3", "V7"],
  "painPointEvidence": ["실제 페인포인트 근거 (string 배열)"],
  "sources": ["참고한 출처 URL 또는 설명 (string 배열)"]
}
communityVoiceRefs에는 위 수집 결과 섹션에 실제로 존재하는 [V*] ID만 담아라. 목소리 객체를 출력하지 마라 — 원문·출처·작성자는 코드가 ID로 붙인다.`;

export interface ContextHunterDeps {
  gemini: GeminiService;
  /** 등록된 소스가 곧 레지스트리다 (ADR-012). 키가 없는 소스는 애초에 배열에 없다 */
  sources: readonly ResearchSource[];
  log?: (message: string) => void;
}

export interface ContextHunterResult {
  /** artifacts(kind='context')로 저장되는 step 산출물 */
  context: MarketContext;
  /** artifacts(kind='research')로 저장되는 수집 원본 — LLM 이전의 사실이다 (ADR-013) */
  evidence: ResearchEvidence;
}

/**
 * LLM이 고른 ID를 수집 증거의 실제 목소리로 치환한다 (ADR-013).
 *
 * 모르는 ID는 "가장 비슷한 목소리"로 매칭하지 않고 드롭한다 — 퍼지 매칭은 환각을 그럴듯한
 * 인용으로 세탁한다. 드롭 로그가 환각을 관측하는 유일한 계기다.
 * 전부 드롭되어 빈 배열이 되어도 합법이다 (전 소스 실패 시의 정상 상태와 같은 모양이다).
 */
function resolveVoiceRefs(
  refs: readonly string[],
  voices: readonly CommunityVoice[],
  log?: (message: string) => void,
): CommunityVoice[] {
  const resolved: CommunityVoice[] = [];
  const seen = new Set<number>();
  const dropped: string[] = [];

  // 순서는 LLM이 고른 순서를 따른다 — 선별 순서에 우선순위 판단이 들어 있다
  for (const ref of refs) {
    const index = parseVoiceRef(ref);
    if (index === null || index >= voices.length) {
      dropped.push(ref);
      continue;
    }
    // 같은 목소리를 두 번 인용하지 않는다
    if (seen.has(index)) {
      continue;
    }
    seen.add(index);
    resolved.push(voices[index]);
  }

  if (dropped.length > 0) {
    log?.(
      `[context-hunter] 알 수 없는 목소리 참조 ${dropped.length}건을 드롭했다: ${dropped.join(", ")}`,
    );
  }
  return resolved;
}

export async function runContextHunter(
  deps: ContextHunterDeps,
  idea: string,
  clarifications?: string,
): Promise<ContextHunterResult> {
  // 아이디어 원문을 그대로 검색하면 긴 문장이 되어 검색 품질의 하한을 만든다. 인터뷰 답변도
  // 검색어에 반영한다. planner는 실패해도 throw하지 않고 아이디어 원문으로 폴백한다 (ADR-012).
  const queries = await planResearchQueries(
    { gemini: deps.gemini, log: deps.log },
    idea,
    clarifications,
  );

  // Hacker News가 한국어 쿼리를 받으면 에러 없이 조용히 0건이 된다 — 로그가 유일한 관측 수단이다
  deps.log?.(
    `[context-hunter] 검색어 — youtube: "${queries.youtube}" / hackernews: "${queries.hackernews}" / naver: "${queries.naver}"`,
  );

  // collectAll은 절대 throw하지 않는다 — 소스가 전부 죽어도 웹검색만으로 진행한다 (fail-soft)
  const collected = await collectAll(deps.sources, queries);

  let prompt = CONTEXT_HUNTER_PROMPT_TEMPLATE.replace("{idea}", idea)
    .replace(
      "{webQueryHints}",
      queries.web.map((query) => `   - ${query}`).join("\n"),
    )
    .replace("{evidenceSection}", formatEvidenceSection(collected));

  // 인터뷰 답변이 있으면 아이디어의 핵심 맥락으로 반영한다 (웹 인터뷰 흐름)
  if (clarifications !== undefined && clarifications.trim().length > 0) {
    prompt += `\n\n## 사용자 추가 설명 (인터뷰 답변)\n${clarifications}\n\n위 사용자 추가 설명을 아이디어의 핵심 맥락으로 반영해 조사하라.`;
  }

  // LLM은 draft(자기보고 sources + 목소리 ID 참조)만 채운다. citations는 코드가 grounding 응답에서
  // 추출해 주입한다 — LLM에게 인용을 적어내라고 하면 URL을 지어낸다 (ADR-012).
  const { data, citations, webSearchQueries } = await deps.gemini.generateGrounded({
    systemInstruction: CONTEXT_HUNTER_SYSTEM_PROMPT,
    prompt,
    usageLabel: CONTEXT_HUNTER_USAGE_LABEL,
    schema: MarketContextDraftSchema,
  });

  if (webSearchQueries.length > 0) {
    // 관측용 — 모델이 실제로 무엇을 검색했는지. 산출물 스키마에는 넣지 않는다
    console.error(
      `[context-hunter] grounding 검색어: ${webSearchQueries.join(", ")}`,
    );
  }

  // citations와 나란히 researchCoverage도 코드가 주입한다. "네이버는 키가 없어 조사하지
  // 않았다"는 LLM이 알 수 없는 사실이고, 물어보면 지어낸다 (ADR-013).
  const evidence: ResearchEvidence = {
    voices: collected.voices,
    coverage: collected.coverage,
  };

  // 판단(어느 목소리가 유의미한가)은 LLM이, 사실(그 목소리의 원문·출처·작성자)은 코드가 소유한다.
  // ref는 research 증거의 내부 좌표라 산출물에 남기지 않는다 (ADR-013).
  const { communityVoiceRefs, ...draft } = data;
  const communityVoices = resolveVoiceRefs(
    communityVoiceRefs,
    evidence.voices,
    deps.log,
  );

  return {
    context: {
      ...draft,
      communityVoices,
      citations,
      researchCoverage: evidence.coverage,
    },
    evidence,
  };
}
