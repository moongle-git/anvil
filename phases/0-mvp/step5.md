# Step 5: agent-context-hunter

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `/docs/ARCHITECTURE.md`
- `/docs/PRD.md` (핵심 기능 1: Context Hunter)
- `/CLAUDE.md`
- `src/types/marketContext.ts` (step 1 산출물 — MarketContext 스키마)
- `src/services/gemini.ts` (step 3 산출물 — GeminiService.generateStructured 시그니처)
- `src/services/youtube.ts` (step 4 산출물 — YoutubeService.collectVoices 시그니처)

이전 step에서 만들어진 코드를 꼼꼼히 읽고, 설계 의도를 이해한 뒤 작업하라.

## 작업

`src/agents/contextHunter.ts`에 첫 번째 에이전트를 TDD로 작성한다. 시장 맥락(트렌드, 경쟁 서비스, 유저 목소리)을 수집·정제해 MarketContext를 만든다.

```ts
export interface ContextHunterDeps {
  gemini: GeminiService;
  youtube: YoutubeService;
}

export async function runContextHunter(deps: ContextHunterDeps, idea: string): Promise<MarketContext>;
```

동작 흐름:

1. `youtube.collectVoices(idea에서 뽑은 검색어)`로 관련 영상 + 댓글 원문을 수집한다. 검색어는 아이디어 텍스트를 그대로 쓰거나 핵심 키워드를 추출한다(재량).
2. `gemini.generateStructured`를 `useGrounding: true`로 호출한다. 프롬프트에는 다음을 포함하라:
   - 아이디어 원문
   - YouTube 수집 결과(영상 제목/URL/댓글 원문) — Gemini가 노이즈를 제거하고 유의미한 유저 목소리만 선별하도록 지시
   - 웹검색(grounding)으로 최신 트렌드·유사/경쟁 서비스를 조사하라는 지시
   - MarketContext 스키마 구조에 맞는 JSON만 출력하라는 지시
3. 반환된 MarketContext를 그대로 리턴한다 (스키마 검증은 GeminiService가 이미 수행).

핵심 규칙 (설계 의도 — 반드시 지켜라):

1. **댓글 원문 보존**: youtubeVoices의 comment 필드는 수집된 댓글 원문을 그대로 인용해야 한다. Gemini에게 "요약하지 말고 원문을 선별·인용하라"고 프롬프트에 명시하라. 리포트의 "실제 유저 목소리" 품질이 여기서 결정된다.
2. **YouTube 수집 실패 내성**: youtube 호출이 예외를 던지면 (quota 초과 등) youtubeVoices를 빈 배열로 두고 웹검색만으로 진행한다. 파이프라인 전체가 죽으면 안 된다. 단, 실패 사실은 로깅하라.
3. **프롬프트는 상수로 분리**: 시스템 프롬프트/유저 프롬프트 템플릿은 파일 상단에 명명된 상수로 두어 이후 튜닝이 쉽게 하라. 프롬프트는 한국어로 작성한다.

테스트: GeminiService/YoutubeService를 fake/mock으로 주입해 (1) 정상 흐름에서 두 서비스가 올바른 인자로 호출되는지, (2) YouTube 실패 시 빈 youtubeVoices로 진행되는지 검증하라.

## Acceptance Criteria

```bash
npm run build   # 컴파일 에러 없음
npm test        # 테스트 통과 (실제 API 호출 없이)
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크리스트를 확인한다:
   - ARCHITECTURE.md 디렉토리 구조를 따르는가? (agents/는 services/를 통해서만 외부 통신)
   - ADR 기술 스택을 벗어나지 않았는가?
   - CLAUDE.md CRITICAL 규칙(외부 API 직접 호출 금지, TDD)을 위반하지 않았는가?
3. 결과에 따라 `phases/0-mvp/index.json`의 해당 step을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약"`
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - 사용자 개입 필요 → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

## 금지사항

- agents/에서 fetch나 @google/genai를 직접 import하지 마라. 이유: CLAUDE.md CRITICAL — 외부 API 호출은 services/에서만.
- Cold Critic/Solution Designer 로직을 만들지 마라. 이유: step 6, 7의 scope다.
- 파이프라인 오케스트레이션(상태 저장, resume)을 여기에 넣지 마라. 이유: step 8의 scope다. 이 함수는 순수하게 "입력 → MarketContext"만 담당한다.
- 기존 테스트를 깨뜨리지 마라
