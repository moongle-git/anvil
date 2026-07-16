# Step 5: report-ledger

## 읽어야 할 파일

- `/docs/ADR.md` — **ADR-008**(리포트 서사는 5단계 순차 논증 — 결론을 최하단에 둔다). **이 ADR이 이 step의 설계 제약이다.** 그리고 ADR-017, ADR-011, ADR-013(링크 박탈·미검증 표기)
- `/docs/PRD.md` — 리포트 규격. "순서는 협상 불가다"
- `/docs/ARCHITECTURE.md`, `/CLAUDE.md`
- `src/lib/report.ts` — 이번에 바꿀 파일. 전체를 읽어라. 특히:
  - **`270행` 부근** — dangling `rebuts`를 조용히 무시하는 처리와 "스키마가 교차 참조를 검증하지 않는다"는 주석. **이 주석은 이제 절반만 참이다** (solution·verdict는 검증하지만 rebuts는 여전히 검증하지 않는다). 정정하라.
  - `coverageSection` — 빈 데이터일 때 블록 자체를 생략하는 방식. 원장이 이 선례를 따른다.
  - `181~186행` 부근 — "미검증 출처 N개" vs "검색 인용 N개"를 분리 표기하는 방식. 원장의 "미검증" 프레이밍이 이 선례를 따른다.
- `src/types/ledger.ts` — `buildLedger`
- `src/types/solution.ts`·`src/types/verdict.ts` — `REMEDY_STRATEGY_LABELS`, `REMEDY_VERDICT_LABELS`
- `src/lib/report.test.ts`

## 배경

결함↔해결책 쌍이 이 리포트의 핵심 산출물인데 **지금은 `revisedConcept` 줄글에 묻혀 보이지 않는다.** 이 step이 그것을 드러낸다.

### ADR-008이 이 step의 설계를 지배한다

> "정반합은 전개 과정 자체가 산출물이다. **결론을 먼저 노출하면 正/反 대립이 장식으로 전락한다** — 답을 이미 아는 독자에게 대립 구조는 읽을 이유가 없다."

따라서 원장을 **어디에 무엇을 렌더하는지**가 핵심이다:

| 절 | 렌더할 것 | 렌더하면 안 되는 것 |
|---|---|---|
| **4절 (合 — 인사이트 및 재설계)** | 재설계의 **해결책만** — 전략 라벨(방어/우회) + 해결책 본문 | **감사 결과 절대 금지.** 4절에 "재주장" 칩이 뜨면 독자는 5절을 읽기 전에 결론을 안다 = ADR-008 위반 |
| **5절 (최종 판정)** | 원장 전체 — 요약 줄 + 3열 표. 잔존 리스크 **앞에** | — |

## 작업

`src/lib/report.ts` + 테스트.

### 1. 4절에 해결책 블록 추가

`buildLedger(criticism, solution)`로 fatal 항목을 추려, 각 항목에 대해:
- 비판의 `riskKeyword`(또는 `claim`)
- 전략 라벨 (`REMEDY_STRATEGY_LABELS`)
- 해결책 본문 (`remedy`)

**"미검증" 프레이밍을 쓰라.** 이것은 재설계의 자기보고이지 검증된 사실이 아니다 — `report.ts:181-186`이 `sources`에 대해 하는 것과 같은 태도다. 소제목이나 안내 문구로 그 점이 드러나게 하라.

침묵한 fatal(해결책 없음)은 4절에 어떻게 표시할지 판단하라 — **다만 그것을 실패로 낙인찍지 마라.** 실패 판정은 5절의 일이다.

### 2. 5절에 원장 렌더

잔존 리스크 **앞에** 배치한다:

```
비판이 제기한 치명적 결함 2건 → 해결책 2건 (유효 1 · 재주장 1)
```

그 아래 3열 표: **비판** | **재설계의 해결책** | **판정의 감사**

- 감사 라벨은 `REMEDY_VERDICT_LABELS` 사용
- 침묵한 항목은 "해결책 없음"으로 표시
- 요약 줄의 숫자는 **`buildLedger` 결과에서 파생**하라. 별도 카운팅 로직을 만들지 마라.

### 3. `270행` 주석 정정

"스키마가 교차 참조를 검증하지 않는다"는 이제 부정확하다. 정확히 쓰라: `solution.remedies`·`verdict.remedyAudits`는 팩토리가 검증하지만, **`rebuts`는 여전히 검증하지 않는다**(ADR-017이 근거 부족을 이유로 사양했다). dangling `rebuts`를 무시하는 기존 처리는 그대로 둔다.

### 4. 빈 원장 처리

구 run(원장 없음)은 **블록 자체를 생략**한다 — `coverageSection`과 동일한 방식. 빈 표나 "0건" 표시를 렌더하지 마라.

### 5. 테스트

- 4절에 해결책이 렌더되고 **감사 결과가 렌더되지 않는다** ← ADR-008의 안전벨트
- 5절에 원장 표와 요약 줄이 렌더된다
- 5절 원장이 잔존 리스크보다 **앞에** 나온다
- 침묵한 fatal이 "해결책 없음"으로 표시된다
- 원장 없는 구 solution·verdict는 블록이 **생략**된다 (빈 표 아님)
- unknown id가 섞여도 throw하지 않는다
- 요약 줄의 숫자가 실제 원장과 일치한다

## 불변식

- **4절에 감사 결과를 렌더하지 마라** (ADR-008).
- 5절의 기존 순서(headline → rationale → 잔존 리스크 → conditions)를 흐트러뜨리지 마라. 원장은 잔존 리스크 앞에 **삽입**된다.
- `report.md`의 5단계 순서와 절 제목은 PRD 규격 그대로다. 바꾸지 마라.

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
   - `lib/report.ts`가 `buildLedger`(types/)를 쓰는가? 자체 대조 로직을 다시 구현하지 않았는가?
   - ADR-008을 위반하지 않는가? (4절에 결론 누설 없음)
   - CLAUDE.md CRITICAL 위반이 없는가?
3. `phases/8-fatal-remedy/index.json`의 step 5를 업데이트한다.

## 금지사항

- **4절에 감사 결과(`assessment`)를 렌더하지 마라.** 이유: ADR-008. 4절에 "재주장" 칩이 뜨면 독자가 5절 전에 결론을 알게 되어 정반합 전개가 장식으로 전락한다.
- **재설계의 해결책을 검증된 사실처럼 렌더하지 마라.** 이유: 자기보고다 (ADR-013의 "미검증 출처" 표기와 같은 태도).
- **웹(`web/`)을 건드리지 마라.** 이유: step 6의 scope다.
- **빈 원장에 "0건" 표시를 렌더하지 마라.** 이유: 구 run에 없는 정보를 있는 것처럼 만든다. `coverageSection`처럼 블록을 생략하라.
- **`rebuts`의 dangling 처리를 바꾸지 마라.** 이유: 실측 문제 0건이다 (ADR-017).
- **기존 테스트를 깨뜨리지 마라.**
