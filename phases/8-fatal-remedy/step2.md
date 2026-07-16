# Step 2: solution-remedy-agent

## 읽어야 할 파일

- `/docs/ADR.md` — **ADR-017**(이 phase의 헌법), **ADR-010**(판정자 분리 — 재설계는 스스로 채점하지 않는다), ADR-016(thinking 상한)
- `/docs/PRD.md` — 合 섹션 규격. "合은 리포트에서 가장 중요한 섹션이다"
- `/docs/ARCHITECTURE.md`, `/CLAUDE.md`
- `src/types/solution.ts` — **이전 step이 만든 `RemedySchema`·`solutionSchemaFor`·`REMEDY_STRATEGIES`·`REMEDY_STRATEGY_LABELS`를 읽어라.** 프롬프트가 이 이름들을 글자 그대로 써야 한다.
- `src/types/criticism.ts` — `CriticismPoint`의 `id`·`axis`·`claim`·`severity`·`riskKeyword`
- `src/agents/solutionDesigner.ts` — 이번에 바꿀 파일. **`38~41행`의 "비판 수용 강제" 절을 눈으로 확인하라** — 이 부탁이 지켜지지 않았다는 것이 이 phase의 출발점이다.
- `src/agents/coldCritic.ts` — 프롬프트 서술 스타일의 선례 (특히 `rebuts` 계약을 어떻게 설명하는지)
- `src/agents/solutionDesigner.test.ts`

## 배경

재설계 프롬프트에는 요구가 **이미 적혀 있다** (`solutionDesigner.ts:38-41`):

> "criticism.points 중 severity가 fatal 또는 major인 항목 **각각**에 대해, 재설계안이 어떻게 대응하는지 revisedConcept에 반드시 드러나야 한다. … 대응할 수 없는 fatal 비판이 있다면 얼버무리지 말고 그 한계를 revisedConcept에 명시하라."

**부탁만 하고 검증을 안 한다.** 실측(`data/anvil.db`, 최신 run 5개):
- 비판 ID를 줄글에 태깅하는 run: **2개** (`6af78e`, `d32758`)
- 언급조차 안 하는 run: **3개** (`500424`, `13c0ac`, `472fc2`)

모델에게 능력은 있다. `6af78e`의 `revisedConcept`는 이미 원장 형태다 — `(c2: … 방어) (c3: … 방어) (c4: … 방어) (c5: … 우회)`. **없는 것은 칸이다.** 이 step은 새 능력을 요구하지 않는다. 이미 2/5에서 증명된 것을 5/5로 만든다.

`solutionSchemaFor(criticism)`이 fatal 전건 커버리지를 강제하므로, 빠뜨리면 ADR-004의 자가 교정 루프가 `"c5에 대한 해결책이 없다"`를 되먹여 다시 시킨다. **새 재시도 장치를 만들지 마라 — 이미 있다.**

### 이 step이 지켜야 할 두 가지 경계

1. **재설계는 점수를 모른다.** 판정 규칙·survivalScore·밴드를 이 프롬프트에 언급하면, 재설계는 점수를 위해 해결책을 지어낸다. 정보 차단벽은 ADR-017의 결정이다.
2. **재설계는 채점하지 않는다.** `strategy`는 "무엇을 했는가"(방어/우회)이지 "성공했는가"가 아니다. `resolved`·`fixed` 같은 성적 어휘를 쓰면 ADR-010이 막으려던 낙관 편향이 되살아난다 — 해소 여부는 판정의 말이다.

## 작업

`src/agents/solutionDesigner.ts` + 테스트.

### 1. "비판 수용 강제" 절(38~41행)을 원장 계약으로 교체

새 절이 담아야 할 것:
- 전달받은 비판의 `points[]`는 각각 `id`(`"c1"`, `"c2"`…)를 갖는다.
- **`severity`가 `fatal`인 항목 각각에 대해 `remedies`에 항목을 하나씩 만들어라.** 하나라도 빠지면 출력이 검증에 실패해 폐기된다.
- `respondsTo`에 그 비판의 id를, `strategy`에 `defend`(방어) 또는 `bypass`(우회)를, `remedy`에 **구체적인 해결책**을 쓴다.
- **방어** = 비판이 지적한 취약점을 구조적으로 제거한다. **우회** = 비판이 성립하는 전장을 떠나 같은 자산으로 다른 가치를 판다. (기존 23~27행의 정의와 일치시켜라 — 새 정의를 발명하지 마라.)
- major·minor 항목도 `remedies`에 넣을 수 있으나 강제하지 않는다.
- `remedies`는 `revisedConcept`을 대체하지 않는다. 재설계안 본문은 그대로 쓰고, `remedies`는 **결함별 대응을 짚어내는 원장**이다.

**필드명·enum 값(`remedies`, `respondsTo`, `strategy`, `remedy`, `defend`, `bypass`)이 프롬프트에 글자 그대로 등장해야 한다.** 이유: 스키마가 그 이름으로 검증하고, 재시도 프롬프트가 그 이름으로 에러를 되먹인다.

### 2. `41행`의 탈출구를 제거

> "대응할 수 없는 fatal 비판이 있다면 얼버무리지 말고 그 한계를 revisedConcept에 명시하라."

**이 문장을 지운다.** `PROMPT_TEMPLATE`의 지시사항 3번(`67행`)에도 같은 탈출구가 있다 — 함께 지운다. 이유: 요구사항은 해결책을 내는 것이다. 못 풀어도 되는 출구를 주면 그 출구가 기본값이 된다.

### 3. `solutionSchemaFor(criticism)` 배선

`runSolutionDesigner`가 `criticism`을 이미 인자로 받는다. `generateStructured`의 `schema`를 `SolutionSchema` → `solutionSchemaFor(criticism)`으로 바꾼다. 그 외 파라미터는 그대로다.

### 4. 테스트

- 프롬프트에 `remedies`·`respondsTo`·`defend`·`bypass`가 등장한다
- 프롬프트에 **점수·survivalScore·판정·밴드·abandon이 등장하지 않는다** ← 정보 차단벽의 안전벨트
- 프롬프트에 "대응할 수 없는", "한계를 명시" 류의 탈출구 문구가 **없다**
- `generateStructured`에 넘긴 schema가 fatal 누락을 거부한다 (mock gemini가 fatal 없는 solution을 반환 → throw)
- fatal 전건을 채운 solution은 통과한다
- `SOLUTION_DESIGNER_THINKING_BUDGET`이 그대로 넘어간다

## 불변식

- **`SOLUTION_DESIGNER_THINKING_BUDGET`은 2048 그대로 둔다.** 이유: ADR-016 실측(2,817 → 1,670 토큰, 상한에 물리지 않았다). 원장이 늘어난다고 선제적으로 올리지 마라 — 측정하지 않고 최적화하지 않는다. 출력 토큰 증가는 step 7이 관측한다.
- `revisedConcept`·`synthesis`·4대 설계 원칙 필드의 기존 지시를 지우지 마라. 원장은 **추가**이지 대체가 아니다.

## Acceptance Criteria

```bash
npm run build
npm test
npm run lint
env -u GEMINI_API_KEY -u YOUTUBE_API_KEY -u NAVER_CLIENT_ID -u NAVER_CLIENT_SECRET npm test
```

## 검증 절차

1. 위 AC 커맨드를 전부 실행한다.
2. 아키텍처 체크리스트:
   - `agents/`가 fetch·SDK를 직접 부르지 않는가? (`gemini` 주입만)
   - ADR-017의 필드명과 프롬프트의 필드명이 일치하는가?
   - CLAUDE.md CRITICAL 위반이 없는가?
3. `phases/8-fatal-remedy/index.json`의 step 2를 업데이트한다. summary에 프롬프트 변경 요지와 배선된 팩토리를 적어라.

## 금지사항

- **점수·survivalScore·recommendation·밴드·abandon을 이 프롬프트에 언급하지 마라.** 이유: 재설계가 결과를 알면 점수를 위해 해결책을 지어낸다 (ADR-017 정보 차단벽).
- **`strategy`에 `resolved`·`fixed`·`solved` 같은 성적 어휘를 쓰지 마라.** 이유: 해소 여부는 판정의 말이다. 재설계가 스스로 채점하면 ADR-010이 막으려던 낙관 편향이 되살아난다.
- **"대응할 수 없는 fatal이 있다면 한계를 명시하라" 탈출구를 남기지 마라.** 이유: 요구사항은 해결책을 내는 것이다. 출구가 있으면 그것이 기본값이 된다.
- **`thinkingBudget`을 올리지 마라.** 이유: 실측 근거가 없다 (ADR-016).
- **`CriticismSchema`를 건드리지 마라.** 이유: 상류는 하류를 모른다.
- **기존 테스트를 깨뜨리지 마라.**
