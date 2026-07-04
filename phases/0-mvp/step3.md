# Step 3: gemini-service

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `/docs/ARCHITECTURE.md`
- `/docs/ADR.md` (ADR-001, ADR-003)
- `/CLAUDE.md`
- `src/types/` 전체 (step 1 산출물)

이전 step에서 만들어진 코드를 꼼꼼히 읽고, 설계 의도를 이해한 뒤 작업하라.

## 작업

`src/services/gemini.ts`에 `@google/genai` SDK 래퍼를 TDD로 작성한다. 이 프로젝트에서 Gemini API를 호출하는 유일한 지점이다.

```ts
export interface GeminiServiceOptions {
  apiKey: string;
  model?: string;      // 기본값: "gemini-2.5-flash" 수준의 최신 안정 모델. 상수로 정의
  maxRetries?: number; // 기본값 3
}

export class GeminiService {
  constructor(options: GeminiServiceOptions, client?: GoogleGenAI)
  // client 파라미터는 테스트 주입용. 미제공 시 apiKey로 SDK 인스턴스 생성

  // 구조화 출력: 프롬프트를 보내고 응답 JSON을 zod 스키마로 검증해 반환.
  // 검증 실패 시 실패 사유(zod 에러 메시지)를 프롬프트에 덧붙여 재요청. maxRetries 소진 시 예외.
  generateStructured<T>(params: {
    systemInstruction: string;
    prompt: string;
    schema: ZodType<T>;
    useGrounding?: boolean;  // true면 Google Search grounding tool 활성화
  }): Promise<T>;
}
```

핵심 규칙 (설계 의도 — 반드시 지켜라):

1. **자가 교정 재시도**: 응답이 JSON 파싱 또는 zod 검증에 실패하면, 에러 내용을 포함한 교정 프롬프트로 재요청한다(execute.py의 prev_error 피드백 패턴과 동일). 최대 `maxRetries`회.
2. **grounding 제약**: Gemini API는 Google Search grounding과 `responseSchema`(구조화 출력)를 동시에 사용할 수 없는 제약이 있다. `useGrounding: true`인 경우 자유 텍스트로 응답을 받되 "JSON만 출력하라"는 지시를 프롬프트에 포함하고, 응답 텍스트에서 JSON 블록을 추출(```json 펜스 또는 중괄호 매칭)한 뒤 zod로 검증하는 방식으로 구현하라. `useGrounding: false`면 SDK의 구조화 출력(responseMimeType: "application/json")을 사용하라.
3. **테스트는 전부 mock**: SDK 클라이언트를 생성자 주입으로 받아 fake 구현으로 대체하라. 테스트 시나리오에 최소한 다음을 포함하라: 정상 응답, 1회 실패 후 교정 성공, maxRetries 소진 후 예외, grounding 모드에서 ```json 펜스 응답 파싱.

`.env` 로딩은 이 step에서 하지 마라 — apiKey는 호출자가 주입한다(CLI가 step 8에서 dotenv로 로드).

## Acceptance Criteria

```bash
npm run build   # 컴파일 에러 없음
npm test        # 테스트 통과 (실제 API 호출 없이)
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크리스트를 확인한다:
   - ARCHITECTURE.md 디렉토리 구조를 따르는가? (SDK 호출은 src/services/에만)
   - ADR 기술 스택을 벗어나지 않았는가?
   - CLAUDE.md CRITICAL 규칙(테스트에서 실제 API 호출 금지)을 위반하지 않았는가?
3. 결과에 따라 `phases/0-mvp/index.json`의 해당 step을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약"`
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - 사용자 개입 필요 → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

## 금지사항

- 테스트에서 실제 GEMINI_API_KEY로 API를 호출하지 마라. 이유: CLAUDE.md CRITICAL 규칙. 키가 없어도 npm test가 통과해야 한다.
- 에이전트 프롬프트(페르소나 등)를 이 파일에 작성하지 마라. 이유: 프롬프트는 agents/ 레이어의 scope다 (step 5~7).
- LangChain 등 오케스트레이션 라이브러리를 추가하지 마라. 이유: ADR-004에서 자체 하네스 패턴으로 확정했다.
- 기존 테스트를 깨뜨리지 마라
