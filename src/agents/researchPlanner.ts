import type { GeminiService } from "../services/gemini.js";
import { SearchQueriesSchema, type SearchQueries } from "../types/index.js";

export const RESEARCH_PLANNER_SYSTEM_PROMPT = `당신은 아이디어를 읽고 소스별 검색어를 설계하는 리서치 플래너다. 당신은 검색을 수행하지 않는다 — 다음 단계의 리서치 애널리스트가 실제로 던질 검색어만 만든다.

## 검색어 설계 원칙
- 아이디어 원문을 그대로 검색어로 쓰지 마라. 긴 문장은 검색 결과를 0건으로 만든다. 검색 엔진이 실제로 매칭할 수 있는 짧은 키워드구를 만들어라.
- 찾으려는 것은 이 아이디어를 홍보하는 글이 아니라 그 문제로 고통받는 사람들의 목소리다. 제품명이 아니라 페인포인트의 언어로 검색하라.
- 인터뷰 답변(추가 설명)이 주어지면 반드시 검색어에 반영하라. 사용자가 명시한 타겟·플랫폼·제약 조건이 검색어에 들어가야 한다.

## 소스별 요구사항
- **youtube** — 한국어. 리뷰·후기·불만·브이로그가 잡히는 구어체 키워드.
- **hackernews** — 반드시 영어로 써라. 한국어 검색어를 넣으면 검색 결과가 0건이 된다. 영어권 빌더·얼리어답터의 토론을 겨냥한 제품·기술 키워드를 써라.
- **naver** — 한국어. 카페·지식iN에서 실제 사용자가 쓸 법한 구어체로 써라. "회의록 자동화 솔루션"이 아니라 "회의록 정리 너무 귀찮" 쪽에 가깝게.
- **web** — 웹검색(Google Search)에 줄 검색 힌트 1~3개. 시장 규모·경쟁사·트렌드를 겨냥한다.

## 출력 형식
{ "youtube": "한국어 키워드구", "hackernews": "english keyword phrase", "naver": "한국어 구어체 키워드구", "web": ["웹검색 힌트"] }`;

export const RESEARCH_PLANNER_PROMPT_TEMPLATE = `## 아이디어 원문
{idea}

## 사용자 추가 설명 (인터뷰 답변)
{clarifications}

## 지시사항
1. 이 아이디어가 겨냥하는 핵심 페인포인트를 파악하라.
2. 그 페인포인트를 겪는 사람들이 실제로 쓸 법한 검색어를 소스별로 하나씩 설계하라.
3. hackernews 검색어는 영어로 써라. 한국어면 검색 결과가 0건이 된다.
4. web에는 시장 규모·경쟁사·트렌드를 확인할 검색 힌트를 1~3개 담아라.

사용자 추가 설명이 있으면 그 타겟·플랫폼·제약 조건을 검색어에 반영하라.`;

export interface ResearchPlannerDeps {
  gemini: GeminiService;
  log?: (message: string) => void;
}

/**
 * 소스별 검색어를 생성한다 (ADR-012). 파이프라인 step이 아니라 context-hunter 내부 호출이다 —
 * non-grounding 구조화 출력이라 2~4초에 끝나고, 비싼 grounding 호출은 이미 context-hunter가
 * 체크포인트한다.
 */
export async function planResearchQueries(
  deps: ResearchPlannerDeps,
  idea: string,
  clarifications?: string,
): Promise<SearchQueries> {
  const prompt = RESEARCH_PLANNER_PROMPT_TEMPLATE.replace("{idea}", idea).replace(
    "{clarifications}",
    clarifications !== undefined && clarifications.trim().length > 0
      ? clarifications
      : "(추가 설명 없음)",
  );

  try {
    return await deps.gemini.generateStructured({
      systemInstruction: RESEARCH_PLANNER_SYSTEM_PROMPT,
      prompt,
      usageLabel: "researchPlanner",
      schema: SearchQueriesSchema,
    });
  } catch (error) {
    // 검색어 생성 실패는 자료조사를 멈출 이유가 아니다 — 아이디어 원문으로 폴백한다.
    // 단 이 폴백이 발동하면 Hacker News는 한국어 쿼리를 받아 에러 없이 0건이 된다.
    // 빈 배열은 눈치채기 어려우므로 로그가 유일한 관측 수단이다.
    const message = error instanceof Error ? error.message : String(error);
    deps.log?.(
      `[research-planner] 검색어 생성 실패 — 아이디어 원문으로 폴백한다: ${message}`,
    );
    return { youtube: idea, hackernews: idea, naver: idea, web: [idea] };
  }
}
