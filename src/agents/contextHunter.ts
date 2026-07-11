import { collectAll } from "../research/collect.js";
import { formatEvidenceSection } from "../research/format.js";
import type { ResearchSource } from "../research/types.js";
import type { GeminiService } from "../services/gemini.js";
import {
  MarketContextDraftSchema,
  RESEARCH_SOURCE_IDS,
  type MarketContext,
  type ResearchSourceId,
} from "../types/index.js";

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
   수집된 communityVoices가 빈 배열이면 목소리를 지어내지 말고, 수집된 유저 목소리가 없다는 사실과 그로 인해 수요 판단이 웹검색 근거에만 의존한다는 한계를 진술하라.
   일부 소스의 수집이 실패했거나 0건이면 그 사실과 그로 인한 근거 편향을 진술하라 — 예: 네이버가 실패하면 국내 커뮤니티 근거가 없고, Hacker News가 0건이면 영어권 빌더 담론이 빠져 있다.

## 원시 근거 보존
trends·competitors·communityVoices·painPointEvidence·sources는 리포트에서 접힌 영역에 들어갈 원시 근거다. 인사이트 필드와 별개로 채워라.
communityVoices의 text는 요약하지 말고 원문을 그대로 선별·인용하라. 수집 결과에 실제로 존재하는 문서·댓글만 사용하라.
근거 없는 추측 대신 검색·수집 결과에서 확인된 사실만 담아라.`;

export const CONTEXT_HUNTER_PROMPT_TEMPLATE = `## 아이디어 원문
{idea}

## 커뮤니티 수집 결과
{evidenceSection}

## 지시사항
1. 웹검색(Google Search)으로 이 아이디어와 관련된 최신 트렌드, 유사/경쟁 서비스(이름·설명·URL·가격 힌트), 시장 규모·성장률 지표를 조사하라.
2. 경쟁 서비스를 찾으면 그 공식 페이지를 직접 읽어 가격·기능을 확인하라. 단 가장 중요한 3곳 이하만 읽어라.
3. 위 커뮤니티 수집 결과에서 노이즈(광고, 인사말, 무관한 잡담)를 제거하고, 아이디어의 페인포인트와 관련된 유의미한 유저 목소리만 선별하라. text 필드에는 수집된 원문을 요약하지 말고 그대로 인용하라.
   네이버 항목("검색 스니펫"으로 표시된 항목)은 게시글 본문이 아니라 검색 스니펫이다. 잘린 문장을 완결된 원문인 양 인용하지 마라.
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
  "communityVoices": [{ "source": "youtube", "title": "출처 문서 제목(영상·글)", "url": "출처 퍼머링크", "text": "인용 원문 그대로", "authorName": "작성자 (선택)", "score": 인기도 (선택) }],
  "painPointEvidence": ["실제 페인포인트 근거 (string 배열)"],
  "sources": ["참고한 출처 URL 또는 설명 (string 배열)"]
}
communityVoices의 source는 youtube / hackernews / naver 중 하나여야 한다. 위 수집 결과에 실제로 존재하는 문서·댓글만 사용하고, 어느 소스에서 왔는지에 맞춰 source를 적어라.`;

export interface ContextHunterDeps {
  gemini: GeminiService;
  /** 등록된 소스가 곧 레지스트리다 (ADR-012). 키가 없는 소스는 애초에 배열에 없다 */
  sources: readonly ResearchSource[];
  log?: (message: string) => void;
}

export async function runContextHunter(
  deps: ContextHunterDeps,
  idea: string,
  clarifications?: string,
): Promise<MarketContext> {
  // 소스별 검색어 생성은 researchPlanner의 몫이다 — 지금은 모든 소스가 아이디어 원문을 받는다
  const queries = Object.fromEntries(
    RESEARCH_SOURCE_IDS.map((id) => [id, idea]),
  ) as Record<ResearchSourceId, string>;

  // collectAll은 절대 throw하지 않는다 — 소스가 전부 죽어도 웹검색만으로 진행한다 (fail-soft)
  const evidence = await collectAll(deps.sources, queries);

  let prompt = CONTEXT_HUNTER_PROMPT_TEMPLATE.replace("{idea}", idea).replace(
    "{evidenceSection}",
    formatEvidenceSection(evidence),
  );

  // 인터뷰 답변이 있으면 아이디어의 핵심 맥락으로 반영한다 (웹 인터뷰 흐름)
  if (clarifications !== undefined && clarifications.trim().length > 0) {
    prompt += `\n\n## 사용자 추가 설명 (인터뷰 답변)\n${clarifications}\n\n위 사용자 추가 설명을 아이디어의 핵심 맥락으로 반영해 조사하라.`;
  }

  // LLM은 draft(자기보고 sources 포함)만 채운다. citations는 코드가 grounding 응답에서
  // 추출해 주입한다 — LLM에게 인용을 적어내라고 하면 URL을 지어낸다 (ADR-012).
  const { data, citations, webSearchQueries } = await deps.gemini.generateGrounded({
    systemInstruction: CONTEXT_HUNTER_SYSTEM_PROMPT,
    prompt,
    schema: MarketContextDraftSchema,
  });

  if (webSearchQueries.length > 0) {
    // 관측용 — 모델이 실제로 무엇을 검색했는지. 산출물 스키마에는 넣지 않는다
    console.error(
      `[context-hunter] grounding 검색어: ${webSearchQueries.join(", ")}`,
    );
  }

  return { ...data, citations };
}
