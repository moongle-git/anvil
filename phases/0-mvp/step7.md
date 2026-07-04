# Step 7: agent-solution-designer

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `/docs/PRD.md` (핵심 기능 3: Solution Designer)
- `/docs/ARCHITECTURE.md`
- `/CLAUDE.md`
- `src/types/solution.ts`, `src/types/criticism.ts`, `src/types/marketContext.ts` (step 1 산출물)
- `src/agents/coldCritic.ts` (step 6 산출물 — 에이전트 구조/프롬프트 스타일 참고)

이전 step에서 만들어진 코드를 꼼꼼히 읽고, 설계 의도를 이해한 뒤 작업하라.

## 작업

`src/agents/solutionDesigner.ts`에 세 번째 에이전트를 TDD로 작성한다. 비판을 수용해 아이디어를 AI 네이티브 형태로 재설계한 Solution을 만든다.

```ts
export interface SolutionDesignerDeps {
  gemini: GeminiService;
}

export async function runSolutionDesigner(
  deps: SolutionDesignerDeps,
  idea: string,
  context: MarketContext,
  criticism: Criticism
): Promise<Solution>;
```

`gemini.generateStructured`를 `useGrounding: false`로 호출한다. 시스템 프롬프트에 다음 설계 원칙을 반드시 담아라 (Solution 스키마의 필드에 대응):

1. **Minimal Input / Zero UI**: 사용자가 수동 입력하거나 '시작' 버튼을 누르는 수고를 어떻게 제거할 것인가. 센싱·컨텍스트 기반 자동 트리거를 우선 검토하라.
2. **Agentic Workflow**: 화면 중심 기획을 탈피해, 백그라운드에서 자율 작동하는 에이전트 파이프라인으로 재설계하라.
3. **Data Flywheel**: 유저가 쓸수록 쌓이는 독점적 데이터(Local/Context)로 서비스가 고도화되는 구조 — 거대 LLM 기업이 복제할 수 없는 데이터 축적 방안을 설계하라.
4. **Monetization**: 단순 구독제를 넘어 유저에게 확실한 ROI를 제공하는 과금 구조를 제안하라.
5. **비판 수용 강제**: Criticism의 fatal/major 항목 각각에 대해 재설계안이 어떻게 대응하는지 revisedConcept에 반영하라. 비판을 무시한 낙관적 재설계는 금지한다고 명시하라.

핵심 규칙 (설계 의도 — 반드시 지켜라):

- 프롬프트는 한국어, 파일 상단 명명된 상수로 분리.
- 유저 프롬프트에 아이디어 원문 + MarketContext + Criticism 전체를 JSON 직렬화로 포함하라(요약 금지).

테스트: GeminiService fake를 주입해 (1) 시스템 프롬프트에 4대 설계 원칙과 비판 수용 강제 문구가 포함되는지, (2) 유저 프롬프트에 Criticism 데이터가 포함되는지, (3) 반환값이 Solution 타입인지 검증하라.

## Acceptance Criteria

```bash
npm run build   # 컴파일 에러 없음
npm test        # 테스트 통과 (실제 API 호출 없이)
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크리스트를 확인한다:
   - ARCHITECTURE.md 디렉토리 구조를 따르는가?
   - ADR 기술 스택을 벗어나지 않았는가?
   - CLAUDE.md CRITICAL 규칙(외부 API 직접 호출 금지, TDD)을 위반하지 않았는가?
3. 결과에 따라 `phases/0-mvp/index.json`의 해당 step을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약"`
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - 사용자 개입 필요 → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

## 금지사항

- grounding(웹검색)을 켜지 마라. 이유: 이 에이전트는 수집·비판 산출물만을 근거로 설계해야 재현성이 유지된다.
- 리포트 렌더링(Markdown 생성)을 여기서 하지 마라. 이유: step 8 lib/report의 scope다. 이 에이전트는 구조화된 Solution 데이터만 만든다.
- agents/에서 fetch나 @google/genai를 직접 import하지 마라. 이유: CLAUDE.md CRITICAL.
- 기존 테스트를 깨뜨리지 마라
