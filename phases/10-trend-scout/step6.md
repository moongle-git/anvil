# Step 6: scout-report

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `/docs/PRD.md` — **"리포트 출력 규격"**. 5단계 서사와 "순서는 협상 불가다"
- `/docs/ADR.md` — **ADR-008**(결론 우선 배치 → 5단계 순차 논증), **ADR-013**(출처는 사실이다)
- `src/lib/report.ts` — 전체. 특히 `renderReport`, `citationSection`, `citationItem`, `rawEvidenceDetails`
- `src/lib/report.test.ts`
- `src/types/opportunity.ts` — step 0 산출물
- `src/pipeline/orchestrator.ts` — `renderReport` 호출부 (step 4·5에서 수정됨)

## 이전 step에서 만들어진 것

- step 0~3: 후보 스키마와 `trendScout` 에이전트
- step 4: orchestrator의 스카우트 분기. 선택된 후보가 `state.idea`로 확정된다
- step 5: 선택된 후보가 `context-hunter` 프롬프트에 주입된다

이전 step에서 만들어진 코드를 꼼꼼히 읽고, 설계 의도를 이해한 뒤 작업하라.

## 배경

스카우트 모드로 만들어진 리포트는 **주제를 사람이 고르지 않았다.** 리포트를 나중에 다시 읽는 사람에게 이 사실은 결정적이다 — "이 주제가 왜 여기 있는가"의 답이 리포트 안에 없으면, 자동 생성된 주제와 사용자가 직접 고민한 주제를 구분할 수 없다.

`report.md`는 다운로드되어 anvil 바깥에서 읽히는 산출물이다. DB에 남은 `opportunities` 아티팩트를 볼 수 없는 독자에게도 출처가 보여야 한다.

## 작업

### 1. `renderReport` 시그니처 확장

```ts
export function renderReport(
  idea: string,
  context: MarketContext,
  thesis: Thesis,
  criticism: Criticism,
  solution: Solution,
  verdict: Verdict,
  scoutOrigin?: ScoutOrigin,   // 신규 — 선택적
): string;
```

`ScoutOrigin`은 "선택된 후보 + 탐색 범위" 정도의 얇은 타입이면 된다. 형태는 네가 정하되 `src/types/opportunity.ts`에 두어라. 리포트 렌더러가 후보 스키마 전체를 알 필요는 없다.

**선택적 파라미터다.** 직접 입력 모드의 `report.md`는 지금과 바이트 단위로 동일해야 한다.

### 2. 배치 — 1절 앞의 머리말이지, 새 섹션이 아니다

`scoutOrigin`이 있으면 **`## 1. 시장 맥락` 앞**에, 제목 바로 아래에 놓아라.

- **`## 6.` 같은 새 번호 섹션을 만들지 마라.** PRD가 "순서는 협상 불가"라고 못박은 5단계 서사다. 번호 섹션이 늘면 그 계약이 깨진다.
- **부록으로 뒤에 붙이지 마라.** 독자는 1절을 읽기 전에 "이 주제가 어디서 왔는지"를 알아야 한다. 다 읽고 나서 알면 앞의 논증을 다시 읽어야 한다.
- 결론을 미리 노출하는 요약 배너가 되면 안 된다(ADR-008). 담을 것은 **출처이지 판정이 아니다.**

담을 내용:
- 이 주제가 자동 탐색으로 도출됐다는 사실과 탐색 범위(`scope`)
- 후보의 `whyNow` / `whoPays` / `horizon`
- `signals[]` — `signalType`, `statement`, `observedAt`(있으면 `effectiveAt`)
- **`counterSignal`** — 반드시 함께 렌더하라
- 각 신호의 출처

### 3. 출처 렌더링 규칙 (ADR-013)

기존 `citationItem`·`citationSection`의 규약을 그대로 따라라.

- 스카우트 인용은 **코드가 grounding에서 추출한 것**이므로 링크로 렌더할 수 있다.
- 링크와 함께 **`domain`을 노출하라.** 출처가 통신사인지 블로그인지는 사람이 판단할 문제고, 코드가 대신 걸러내면 조용히 편향이 박힌다.
- `kind: "redirect"` 인용은 만료되는 URI다. 기존 `citationItem`이 이를 어떻게 표시하는지 확인하고 동일하게 처리하라.
- **LLM이 타이핑한 URL은 이 산출물에 존재하지 않는다** — step 3이 ID 치환으로 제거했다. 새로 만들지 마라.

### 4. orchestrator 배선

스카우트 run이면 `renderReport`에 `scoutOrigin`을 넘긴다. 비-스카우트 run은 넘기지 않는다. 한 줄이어야 한다.

## Acceptance Criteria

```bash
npm run build   # 컴파일 에러 없음
npm test        # 테스트 통과
npm run lint
```

`src/lib/report.test.ts`에 테스트를 **먼저** 추가하라(TDD). 최소한 아래를 덮어라:

- `scoutOrigin` 없이 렌더 → 기존 출력과 동일하다 (회귀 없음)
- `scoutOrigin` 있음 → 출력에 신호의 `statement`·`observedAt`이 포함된다
- `scoutOrigin` 있음 → **`counterSignal`이 포함된다**
- `scoutOrigin` 있음 → 출처 `domain`이 표시된다
- **머리말이 `## 1. 시장 맥락`보다 앞에 나온다** (인덱스 비교로 단언하라)
- **`## 2.`~`## 5.` 섹션 제목과 그 순서가 그대로다** — 5단계 서사가 깨지지 않았다
- 새 `## N.` 번호 섹션이 추가되지 않았다

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크리스트를 확인한다:
   - ARCHITECTURE.md 디렉토리 구조를 따르는가?
   - ADR 기술 스택을 벗어나지 않았는가?
   - CLAUDE.md CRITICAL 규칙을 위반하지 않았는가?
   - **PRD "리포트 출력 규격"의 5단계 서사와 순서가 유지되는가?**
3. 결과에 따라 `phases/10-trend-scout/index.json`의 해당 step을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약"`
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - 사용자 개입 필요 → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

## 금지사항

- **`## 6.` 등 새 번호 섹션을 만들지 마라.** 이유: PRD가 5단계 서사의 순서를 "협상 불가"로 못박았다.
- **스카우트 출처를 리포트 끝의 부록으로 보내지 마라.** 이유: 독자는 논증을 읽기 전에 주제의 출처를 알아야 한다.
- **머리말에 판정·점수·결론을 넣지 마라.** 이유: ADR-008이 상단 요약 배너를 금지한다. 여기 담기는 것은 출처이지 결론이 아니다.
- **`counterSignal`을 생략하지 마라.** 이유: 유리한 신호만 남기면 리포트가 자기 홍보물이 된다.
- **출처 도메인을 화이트리스트로 거르지 마라.** 이유: 출처의 신뢰도 판단은 사람의 몫이고, 코드가 대신 정하면 조용히 편향이 박힌다.
- **`renderReport`의 기존 6개 인자 순서·의미를 바꾸지 마라.** 이유: 호출부와 테스트가 고정돼 있다. 새 인자는 뒤에 선택적으로 붙인다.
- 기존 테스트를 깨뜨리지 마라.
