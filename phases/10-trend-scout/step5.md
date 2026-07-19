# Step 5: scout-context-injection

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `/docs/ARCHITECTURE.md` — "데이터 흐름"
- `/docs/ADR.md` — **ADR-012**, **ADR-013**(출처는 판단이 아니라 사실이다)
- `/docs/PRD.md` — 5단계 서사(시장 맥락 → 正 → 反 → 合 → 최종 판정)
- `src/agents/contextHunter.ts` — 전체
- `src/agents/contextHunter.test.ts`
- `src/agents/researchPlanner.ts` — `clarifications` 파라미터가 검색어에 반영되는 방식
- `src/pipeline/orchestrator.ts` — step 4에서 스카우트 분기가 추가됨
- `src/types/opportunity.ts` — step 0 산출물

## 이전 step에서 만들어진 것

step 4가 orchestrator에 스카우트 분기를 넣었다. 사용자가 고른 후보(`Opportunity`)가 `state.idea` 확정 후에도 변수로 남아 있으며, **`runContextHunter`에 넘길 준비만 되어 있고 실제 전달은 배선되지 않았다.** 이 step이 그 한 줄을 잇는다.

이전 step에서 만들어진 코드를 꼼꼼히 읽고, 설계 의도를 이해한 뒤 작업하라.

## 배경: 왜 스카우트 근거를 버리면 안 되는가

스카우트가 고른 주제는 `state.idea` 문자열로 압축돼 하류로 흐른다. 그 과정에서 **왜 이 주제가 선택됐는지**(자본 신호·날짜·반대 증거)가 통째로 사라진다.

이것이 문제인 이유는 `cold-critic`(反) 때문이다. 反은 "이 아이디어가 왜 안 되는가"를 공격하는데, 스카우트 모드에서는 공격해야 할 대상이 **"이 주제가 기회라는 판단"** 이다. 그 판단의 근거가 프롬프트에 없으면 反은 일반론밖에 쓸 수 없고, 변증법 전체가 헐거워진다.

`context-hunter`가 1단계 "시장 맥락"을 만들고 그것이 正·反·合 전부에 주입되므로, **여기에 스카우트 근거를 넣는 것이 한 번에 전 하류로 전달하는 가장 짧은 경로다.**

## 작업

### 1. `runContextHunter` 시그니처 확장

```ts
export async function runContextHunter(
  deps: ContextHunterDeps,
  idea: string,
  clarifications?: string,
  scoutContext?: Opportunity,
): Promise<ContextHunterResult>;
```

- **선택적 파라미터로 추가하라.** 직접 입력 모드는 이 값 없이 지금과 완전히 동일하게 동작해야 한다.
- 기존 호출부(비-스카우트)의 동작이 한 톨도 바뀌면 안 된다.

### 2. 프롬프트 주입

`clarifications`가 프롬프트 뒤에 섹션으로 붙는 방식(`contextHunter.ts` 하단)을 그대로 따라, `scoutContext`가 있으면 전용 섹션을 붙여라.

섹션에 담을 것:
- 후보의 `title` / `whatItIs` / `whyNow` / `whoPays` / `horizon`
- `signals[]` — `signalType`, `statement`, `observedAt`(그리고 있으면 `effectiveAt`), 출처의 `title`·`domain`
- **`counterSignal`** — 반드시 포함하라. 불리한 증거를 빼고 넘기면 하류 전체가 낙관 쪽으로 기운다

지시 문장에 담을 것:
- 이 주제는 사용자가 입력한 것이 아니라 **자본 흐름 근거로 도출된 것**이라는 사실
- 위 신호를 **이미 검증된 사실로 취급하지 말고, 웹검색으로 교차 확인하라**는 지시. 확인되지 않으면 `briefing`에 그 사실을 적게 하라
- 반대 증거를 무시하지 말고 시장 맥락에 반영하라는 지시

### 3. 검색어에도 반영

`planResearchQueries`는 이미 `clarifications`를 받아 검색어에 반영한다(`researchPlanner.ts`의 "사용자 추가 설명" 처리). 스카우트 모드에서는 `clarifications`가 비어 있으므로, 후보의 `whyNow`·`whoPays`를 그 자리에 넘겨 소스별 검색어가 확정 주제에 맞게 좁혀지도록 하라.

`clarifications`와 `scoutContext`는 상호배타적이다(스카우트 모드는 인터뷰를 건너뛴다 — step 1). 둘이 동시에 오는 경우를 위한 병합 로직을 만들지 마라. 쓰이지 않는 경로다.

### 4. 인용을 섞지 마라

스카우트의 citations를 `context.citations[]`에 병합하지 마라.

- `context.citations`는 **이 `context-hunter` 호출의 grounding이 실제로 검색해 코드가 추출한 것**이다(ADR-013). 여기에 다른 호출의 인용을 섞으면 그 필드의 의미가 무너지고, "이 시장 맥락은 무엇을 근거로 하는가"에 두 개의 답이 생긴다.
- 스카우트 인용은 `opportunities` 아티팩트에 이미 온전히 남아 있다. 리포트에서의 표시는 step 6·8이 별도 섹션으로 처리한다.

### 5. orchestrator 배선

step 4가 준비해둔 후보를 `runContextHunter` 호출에 넘겨라. **한 줄이어야 한다.** orchestrator에 다른 변경을 얹지 마라.

## Acceptance Criteria

```bash
npm run build   # 컴파일 에러 없음
npm test        # 테스트 통과 (GEMINI_API_KEY 없이)
npm run lint
```

`src/agents/contextHunter.test.ts`에 테스트를 **먼저** 추가하라(TDD). Gemini는 mock한다. 최소한 아래를 덮어라:

- `scoutContext` 없이 호출 → 프롬프트가 기존과 동일하다 (회귀 없음)
- `scoutContext` 있음 → 프롬프트에 `signals`의 `statement`와 `observedAt`이 들어간다
- `scoutContext` 있음 → 프롬프트에 **`counterSignal`이 들어간다**
- `scoutContext` 있음 → `planResearchQueries`에 후보 맥락이 전달된다
- 스카우트 citations가 결과의 `context.citations`에 **섞이지 않는다**
- `orchestrator.test.ts` — 스카우트 run에서 `runContextHunter`가 선택된 후보와 함께 호출된다

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크리스트를 확인한다:
   - ARCHITECTURE.md 디렉토리 구조를 따르는가?
   - ADR 기술 스택을 벗어나지 않았는가?
   - CLAUDE.md CRITICAL 규칙을 위반하지 않았는가?
3. 결과에 따라 `phases/10-trend-scout/index.json`의 해당 step을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약"`
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - 사용자 개입 필요 → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

## 금지사항

- **스카우트 citations를 `context.citations[]`에 병합하지 마라.** 이유: 그 필드는 "이 grounding 호출이 실제로 검색해 코드가 추출한 인용"이라는 단일 의미를 갖는다(ADR-013). 출처가 다른 인용을 섞으면 그 계약이 깨진다.
- **`counterSignal`을 프롬프트에서 빼지 마라.** 이유: 불리한 증거를 지우고 넘기면 시장 맥락부터 낙관으로 기울고, 그것이 正·反·合 전부에 주입된다.
- **`scoutContext`를 필수 파라미터로 만들지 마라.** 이유: 직접 입력 모드는 이 값 없이 지금과 동일하게 동작해야 한다.
- **스카우트 신호를 "확인된 사실"로 프롬프트에 제시하지 마라.** 이유: 다른 호출에서 나온 판단이다. 교차 확인을 지시해야 `context-hunter`가 독립적인 근거를 만든다.
- **`clarifications`와 `scoutContext`의 병합 로직을 만들지 마라.** 이유: 두 모드가 상호배타적이라 실행되지 않는 경로다.
- 기존 테스트를 깨뜨리지 마라.
