# Step 4: report-renderer

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `/CLAUDE.md`
- `/docs/PRD.md` — "리포트 출력 규격"의 5단계 서사표와 컴포넌트 매핑(Summary/Details)
- `/docs/ADR.md` — ADR-008(순차 논증), ADR-010, ADR-011
- `/src/types/dialectic.ts`, `verdict.ts`, `thesis.ts`, `criticism.ts`, `marketContext.ts`, `solution.ts`
- `/src/lib/report.ts` — 현재 렌더러 (step 3에서 `verdict` 인자가 추가된 상태)
- `/src/lib/report.test.ts`
- `/src/pipeline/orchestrator.ts` — `renderReport` 호출부

## 배경

`report.md`는 폐기되지 않는다. 웹 리포트 뷰의 다운로드 산출물로 계속 쓰인다.
하지만 **평면적 나열을 버리고 5단계 서사와 Summary/Details 구분을 갖춘다.**

현재 렌더러의 문제:
- 섹션 순서가 5단계 서사와 어긋난다(최종 판정이 없고, 비즈니스 모델이 별도 5번 섹션으로 떠 있다).
- `context.competitors`·`context.youtubeVoices`·`context.sources`를 본문에 그대로 투척한다.
- 리스크 점수(`riskScore`)와 키워드(`riskKeyword`)가 렌더링되지 않는다.

## 작업

### `src/lib/report.ts`

`renderReport`를 5단계 서사로 전면 재작성한다. **순수 함수를 유지하라** — 파일 I/O도, 외부 호출도 없다.

```ts
export function renderReport(
  idea: string,
  context: MarketContext,
  thesis: Thesis,
  criticism: Criticism,
  solution: Solution,
  verdict: Verdict,
): string;
```

출력 구조(순서 협상 불가):

```
# [컨설팅 리포트] {context.ideaTitle}
> 입력 아이디어: {idea}

## 1. 시장 맥락 (Context)
{context.briefing}                     ← 본문 (Summary)
### 시장 규모 지표                       ← marketSizeIndicators (없으면 섹션 자체를 생략)
### 경쟁 구도
{context.competitorInsight}            ← 본문 (Summary)
### 타겟 유저의 목소리
{context.voicesInsight}                ← 본문 (Summary)
<details><summary>원시 근거 — 경쟁 서비스 N개 · 유저 목소리 N건 · 트렌드 N건 · 출처 N개</summary>
  ... competitors 표 / youtubeVoices 인용 / trends / painPointEvidence / sources ...
</details>

## 2. 낙관적 가설 (正 / Thesis)
{thesis.winningThesis}
### 수익 모델 / ### 성장 지렛대 / ### 시장 순풍 / ### 최상 시나리오
### 축별 낙관 주장                       ← thesis.points, axis 순서대로

## 3. 냉정한 비판 (反 / Antithesis)
> [경고] ...
### {축 라벨}                            ← DIALECTIC_AXES 순서로 반복
  각 point: **[SEVERITY · score/100 · riskKeyword]** claim
            (rebuts가 있으면) ↳ 반박 대상: 正 {claim 요약}
            <details><summary>근거</summary>evidence</details>
**反의 소결론:** {criticism.verdict}

## 4. 인사이트 및 재설계 (合 / Synthesis)
{solution.synthesis}                   ← 있을 때만
**재설계된 컨셉:** {solution.revisedConcept}
### ① Minimal Input / ### ② Agentic Workflow / ### ③ Data Flywheel
### ④ 지속 가능한 비즈니스 모델           ← solution.monetization. 별도 최상위 섹션으로 두지 마라

## 5. 최종 판정 (Verdict)
**{verdict.headline}**
생존 점수 {survivalScore}/100 · 판정: {RECOMMENDATION_LABELS[recommendation]}
{verdict.rationale}
### 잔존 리스크                          ← residualRisks: [severity] keyword — note
### 생존 조건                            ← conditions, 번호 목록
```

지켜야 할 규칙:

- **`solution.monetization`을 최상위 5번 섹션으로 두지 마라.** 이제 5번은 최종 판정이다.
  수익화는 合의 하위 절(④)로 들어간다. 이유: 5단계 서사에서 결론은 마지막에 단 하나만 온다.
- **`criticism.points`는 `DIALECTIC_AXES` 순서로 그룹핑한다.** 축 라벨은 `DIALECTIC_AXIS_LABELS`에서
  가져온다 — 렌더러에 한국어 문자열을 새로 하드코딩하지 마라.
- **원시 데이터는 `<details>` 안에 넣는다.** GitHub 마크다운은 `<details>/<summary>`를 지원한다.
  `summary`에는 건수를 표기한다. 본문에는 `briefing`·`competitorInsight`·`voicesInsight`만 놓는다.
- `youtubeVoices`가 빈 배열이면 `<details>` 안에 "수집된 YouTube 목소리 없음"을 적는다.
  `marketSizeIndicators`가 비면 "시장 규모 지표" 소제목 자체를 출력하지 않는다.
- `thesis.points`의 `id`와 `criticism.points`의 `rebuts`를 조인해 "반박 대상"을 표기한다.
  **`rebuts`가 존재하지 않는 `id`를 가리키면 조용히 무시한다** — throw하지 마라. 이유: 스키마가
  교차 참조를 검증하지 않으므로 LLM이 끊어진 참조를 만들 수 있고, 리포트 렌더링이 그것 때문에
  실패해선 안 된다.
- `solution.synthesis`는 optional이다. `undefined`면 해당 블록을 생략한다.
- 댓글 원문의 줄바꿈이 인용 블록을 깨뜨리지 않게 처리한다(기존 `voiceBlock`의 `replace(/\n/g, "\n> ")` 패턴).

`src/pipeline/orchestrator.ts`의 `renderReport(...)` 호출은 step 3에서 이미 `verdict`를 넘기도록
바뀌어 있다. 인자 순서만 맞춰라.

## 테스트 (TDD — 먼저 작성한다)

`src/lib/report.test.ts`를 새 서사에 맞게 재작성한다. 렌더러는 순수 함수이므로 **전체 출력 문자열을
스냅샷으로 박지 마라**(브리틀하다). 아래 **계약**을 검증하라:

- 섹션 제목 5개가 **이 순서로** 등장한다: 시장 맥락 → 正 → 反 → 合 → 최종 판정.
  `indexOf`로 위치를 비교해 순서를 단언하라.
- `verdict.headline`이 `criticism.verdict`보다 **뒤에** 나온다 (결론 후치 — ADR-008).
- `context.competitors[0].name`은 출력에 존재하되, **`<details>` 블록 안**에 있다.
  (`<details>` 시작 인덱스 < 경쟁사명 인덱스 < `</details>` 인덱스)
- `context.briefing`은 `<details>` **밖**에 있다.
- 각 `criticism.points`의 `riskScore`와 `riskKeyword`가 출력에 등장한다.
- `rebuts`가 유효한 `id`를 가리키면 대응하는 `thesis.points[].claim`이 근처에 렌더링된다.
- `rebuts`가 존재하지 않는 `id`("t999")를 가리켜도 **throw하지 않고** 리포트를 생성한다.
- `solution.synthesis`가 `undefined`여도 throw하지 않는다.
- `marketSizeIndicators: []`, `youtubeVoices: []`일 때 "시장 규모 지표" 소제목이 출력되지 않고
  "수집된 YouTube 목소리 없음"이 `<details>` 안에 있다.
- `solution.monetization`이 최상위 `## ` 섹션 제목으로 등장하지 **않는다**(`### ` 하위 절이어야 한다).

## Acceptance Criteria

```bash
npx tsc --noEmit
npx vitest run
```

`npm run build` / `npm test`는 여전히 web 때문에 실패한다(`web/src/lib/severity.ts`,
`web/src/components/report/CriticismSection.tsx`가 삭제된 필드를 참조). **다음 step 5에서 복구된다.**

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 렌더러가 순수 함수인지 확인한다: `report.ts`에 `fs`/`path`/네트워크 import가 없어야 한다.
3. 아키텍처 체크리스트를 확인한다:
   - ARCHITECTURE.md의 `lib/report (Markdown 렌더러)` 역할을 벗어나지 않았는가?
   - 외부 API 호출이 없는가?
   - 한국어 라벨이 `DIALECTIC_AXIS_LABELS`·`RECOMMENDATION_LABELS` 상수에서만 오는가?
   - 결론(최종 판정)이 리포트 마지막에 있는가? (ADR-008)
4. 결과에 따라 `phases/2-dialectic-report/index.json`의 step 4를 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약"`
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - 사용자 개입 필요 → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

## 금지사항

- `web/` 아래 어떤 파일도 수정하지 마라. 이유: step 5가 web을 일괄 복구한다. 지금 손대면 두 step이
  같은 파일을 두고 충돌한다.
- `renderReport`에서 파일을 쓰지 마라. 이유: 저장은 `RunStore.saveReport`의 책임이다.
  렌더러는 순수 함수여야 테스트가 파일 I/O 없이 돌아간다.
- `report.md`를 폐기하지 마라. 이유: 웹 리포트 뷰의 다운로드 산출물이자, 구버전 run의 유일한 열람 경로다.
- 리포트 전체 출력을 스냅샷 테스트로 고정하지 마라. 이유: 문구 한 글자만 바뀌어도 깨지는 브리틀한
  테스트가 된다. 순서·포함 관계·`<details>` 경계 같은 계약을 검증하라.
- `rebuts`의 끊어진 참조에 대해 throw하지 마라. 이유: 스키마가 교차 참조를 검증하지 않는다.
  리포트 생성이 LLM의 사소한 실수로 실패하면 파이프라인 전체가 무의미해진다.
- `src/types/` 스키마를 수정하지 마라. 이유: step 1이 확정했다.
- 기존 테스트를 깨뜨리지 마라. 단, 옛 섹션 순서를 단언하는 테스트는 새 서사에 맞게 갱신하라.
