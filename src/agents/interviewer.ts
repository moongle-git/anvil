import type { GeminiService } from "../services/gemini.js";
import {
  InterviewQuestionsSchema,
  type InterviewQuestions,
} from "../types/index.js";

/** usage 집계 라벨. 파이프라인 step 이름과 같아야 usage와 step 상태를 나란히 볼 수 있다 (ADR-016) */
export const INTERVIEWER_USAGE_LABEL = "interviewer";

/**
 * thinking 상한 (ADR-016). 0 — 아이디어의 모호점을 질문 목록으로 바꾸는 생성 작업이다.
 * 판단이 아니므로 추론이 필요 없다.
 */
export const INTERVIEWER_THINKING_BUDGET = 0;

export const INTERVIEWER_SYSTEM_PROMPT = `당신은 신규 서비스 아이디어를 검증하기 전에, 검증에 꼭 필요한 정보를 확보하는 날카로운 인터뷰어다.
사용자가 입력한 아이디어에서 모호하거나 자료조사·인사이트 도출에 결정적인 공백을 찾아 질문한다.

## 질문 원칙
- 정말 모호하거나 검증에 중요한 경우에만 질문하라. 아이디어가 이미 충분히 명확하면 questions를 **빈 배열**로 반환하라.
- 질문은 **최대 5개**, 보통 2~5개다. 사소하거나 굳이 답하지 않아도 되는 질문으로 개수를 억지로 채우지 마라.
- 각 질문은 다음 중 실제 공백을 겨냥한다: 핵심 타깃 사용자, 해결하려는 핵심 문제/페인포인트, 수익화·지불 의사, 서비스 범위·형태, 차별화·경쟁 우위.
- 한 질문에 하나의 논점만 담아라. 답하기 쉽게 구체적으로 물어라.
- why 필드에는 이 질문이 검증에 왜 필요한지 한 줄로 적어라.

## 출력 형식
{ "questions": [ { "id": "고유 식별자", "question": "질문 내용", "why": "이 질문이 검증에 필요한 이유" } ] }
모호하지 않으면 { "questions": [] } 를 출력하라.`;

export const INTERVIEWER_PROMPT_TEMPLATE = `## 아이디어 원문
{idea}

## 지시사항
이 아이디어를 검증(자료조사·수익성 분석)하기 전에 반드시 명확히 해야 할 부분이 있으면 2~5개의 질문을 생성하라.
이미 충분히 명확하다면 questions를 빈 배열로 반환하라.`;

export interface InterviewerDeps {
  gemini: GeminiService;
}

export async function runInterviewer(
  deps: InterviewerDeps,
  idea: string,
): Promise<InterviewQuestions> {
  const prompt = INTERVIEWER_PROMPT_TEMPLATE.replace("{idea}", idea);

  return deps.gemini.generateStructured({
    systemInstruction: INTERVIEWER_SYSTEM_PROMPT,
    prompt,
    usageLabel: INTERVIEWER_USAGE_LABEL,
    thinkingBudget: INTERVIEWER_THINKING_BUDGET,
    schema: InterviewQuestionsSchema,
  });
}
