# Step 0: design-docs

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 기획·아키텍처·설계 의도를 파악하라:

- `/CLAUDE.md`
- `/docs/PRD.md`
- `/docs/UI_GUIDE.md`
- `/docs/ARCHITECTURE.md`
- `/docs/ADR.md`

## 배경

이 프로젝트는 정반합(正反合) 변증법으로 비즈니스 아이디어를 검증한다. 파이프라인은 이미
`interviewer → context-hunter → thesis(正) → cold-critic(反) → solution-designer(合)` 순으로 동작한다.

그러나 현재 리포트는 **결론을 최상단에 노출한다**(역피라미드). `web/src/components/report/ReportView.tsx`가
`VerdictBanner`를 헤더 바로 아래 배치한다. 이건 버그가 아니라 PRD와 UI_GUIDE에 명시된 설계다.

이 설계는 정반합과 양립할 수 없다. 결론을 먼저 보여주면 그 뒤의 正/反 대립은 이미 답을 아는 독자에게
장식일 뿐이다. 변증법은 전개 과정 자체가 산출물이다.

이 step은 **문서만 바꾼다.** 코드는 건드리지 않는다. 이유: `scripts/execute.py`가 매 step 프롬프트에
`CLAUDE.md`와 `docs/*.md` 전문을 가드레일로 주입한다. 문서에 "역피라미드"가 남아 있으면, 이후 step의
세션들이 방금 만든 순차 구조를 다시 역피라미드로 되돌린다. 문서를 먼저 뒤집어야 나머지 11개 step이
같은 방향을 본다.

## 작업

### 1. `docs/PRD.md`

**(a) "핵심 기능" 목록을 5개로 갱신한다.** 현재 3개(Context Hunter / Cold Critic / Solution Designer)에
Thesis와 Verdict를 추가한다. 파이프라인 step은 총 6개다:
`interviewer → context-hunter → thesis → cold-critic → solution-designer → verdict`
(interviewer는 웹에서 생성된 run에서만 활성화된다 — 기존 규칙 유지).

- **Thesis (낙관적 논제, 正)** — 시장 맥락을 근거로 성공 최대 잠재력·바이럴·수익화 시나리오를 적극 긍정한다.
- **Verdict (최종 판정)** — 시장 맥락·正·反·合을 모두 입력받아 생존 가능성 점수와 종합 결론을 낸다.
  기존의 `criticism.verdict`는 反 섹션의 소결론으로 격하되고, 최종 판정은 이 에이전트가 생성한다.

**(b) "리포트 출력 규격" 블록 전체를 아래 5단계 서사로 교체한다.** 순서는 협상 불가다.

| # | 섹션 | 성격 | 데이터 출처 |
|---|------|------|------------|
| 1 | 시장 맥락 (Context) | 건조한 팩트. 트렌드·시장 규모 지표 브리핑 | `context.json` |
| 2 | 正 (낙관적 가설) | 최대 잠재력·바이럴/수익화 시나리오 | `thesis.json` |
| 3 | 反 (냉정한 비판) | 수익 모델 취약성·카피캣 리스크. 正과 정면 대립 | `criticism.json` |
| 4 | 合 (인사이트 및 재설계) | 反을 방어·우회하는 피벗 전략. **가장 중요한 섹션** | `solution.json` |
| 5 | 최종 판정 (Verdict) | 4단계를 거친 후의 생존 가능성과 종합 결론 | `verdict.json` |

**(c) 컴포넌트 매핑 규격을 추가한다.** 리포트는 평면적 텍스트가 아니라 UI 컴포넌트 단위로 구조화된다:

- **Split View** — 2단계(正)와 3단계(反)는 `painPoint`/`bm`/`copycat` 세 축을 공유하며,
  같은 축의 낙관 주장과 비판이 좌우로 나란히 놓인다. 모바일에서는 축 단위로 세로 스택된다.
- **Risk Badge & Radar** — 리스크는 텍스트에 묻히지 않는다. 각 비판 항목은 severity 뱃지와
  0~100 위험도 점수, 그리고 짧은 리스크 키워드를 분리해서 갖는다. 축별 점수는 레이더 차트로 시각화한다.
- **Accordion (Summary / Details)** — YouTube 댓글 원문·경쟁사 목록·출처 URL 같은 원시 데이터는
  본문에 투척하지 않는다. 본문에는 AI가 정제한 인사이트 문단만 놓고, 원시 근거는 접힌 영역에 넣는다.

**(d) "리포트 뷰 (/runs/{id}, 완료)" 항목을 개정한다.**

- `UX 원칙: 역피라미드. "그래서 이 아이디어 어떻다는 건데?"를 최상단에.` → 아래로 교체:
  `UX 원칙: 순차 논증(Progressive Disclosure). 독자는 시장 맥락 → 正 → 反 → 合 → 판정 순으로 읽는다.`
  `결론을 상단에 미리 노출하지 않는다. 상단 요약 배너는 금지한다.`
- 기존 항목 2 "요약 배너: verdict 전문 + severity 집계 뱃지"를 **삭제**한다.
- 섹션 목차 네비 라벨을 5단계 서사에 맞게 갱신하고, "현재 읽고 있는 섹션을 강조해 진행 위치를 알린다"를 추가한다.

**(e) 문서 맨 아래에 `# Phase 2-dialectic-report` 섹션을 신설한다.** 다음을 포함하라:

- 목표: 평면적 마크다운 나열을 폐기하고, 인지 흐름을 통제하는 5단계 입체 컴포넌트 구조로 전환.
- 하위호환: 스키마가 바뀌므로 기존 `runs/`의 산출물은 검증에 실패한다. `RunStore.loadStepOutput`은
  검증 실패 시 `null`을 반환하므로 **완료된 구버전 run은 리포트 뷰에서 빈 상태로 표시**되고
  `report.md` 다운로드로 대체한다. 미완료 run은 resume 시 해당 step이 자동 재실행되어 마이그레이션된다.
- 제외 사항: 레이더 차트 툴팁·인터랙션, 다크 모드, DB 도입, 구버전 run 데이터 마이그레이션 스크립트.

### 2. `docs/UI_GUIDE.md`

**(a) 디자인 원칙 2번을 교체한다.** 현재 "결론 우선(역피라미드). 사용자가 스크롤 없이 verdict와
severity 집계를 파악할 수 있어야 한다." → 아래로:

> 순차 논증. 리포트는 시장 맥락 → 正 → 反 → 合 → 최종 판정 순으로 읽힌다. 결론을 상단에 미리
> 노출하지 않는다. 사용자의 현재 위치는 목차 네비의 현재 섹션 강조로 알린다.

**(b) 레이아웃 규칙에 Split View 예외를 명시한다.** 현재 "리포트 본문(장문 텍스트): max-w-3xl"은
유지하되, 아래를 추가하라:

> 예외: 正/反 Split View 섹션은 `max-w-5xl`을 쓴다. `max-w-3xl`(768px)을 좌우로 나누면 컬럼당 약
> 360px가 되어 한국어 본문 가독 폭에 못 미친다. 이 섹션만 넓히고, 나머지 장문 섹션은 3xl을 유지한다.

**(c) 컴포넌트 절에 아래 3개 규격을 추가한다.** 색은 기존 severity 색상표(fatal `#dc2626` /
major `#d97706` / minor `#6b7280`)를 재사용하고 새 색을 도입하지 마라.

- **RiskRadar** — 인라인 SVG. 격자·축선은 `neutral-200`. 데이터 폴리곤의 stroke는 해당 리포트의
  최고 severity 색, fill은 같은 색 opacity 0.08. 축 라벨은 `text-xs text-neutral-500`.
  좌표 애니메이션·트랜지션 금지(정적 SVG). 아이콘 컨테이너로 감싸지 않는다.
- **SurvivalGauge** — 최종 판정의 생존 점수(0~100). 트랙은 `neutral-200`, 값 부분은 점수 밴드 색
  (0~39 red-600 / 40~69 amber-600 / 70~100 green-600). 숫자는 `tabular-nums`.
- **RiskScoreBadge** — 기존 뱃지 규격(`inline-flex items-center rounded-sm border px-2 py-0.5 text-xs
  font-medium`)을 따르되 점수는 `tabular-nums`, 키워드는 뱃지 옆 `text-xs text-neutral-500`으로 분리 노출.

**(d) 정보 밀도 규칙을 추가한다.**

> 원시 데이터는 본문에 나열하지 않는다. 경쟁사 표, YouTube 댓글 원문, 출처 URL 목록은 반드시
> `Collapsible`(네이티브 `<details>`) 안에 넣는다. 본문에는 에이전트가 정제한 인사이트 문단만 놓는다.
> 접힌 영역의 summary에는 건수를 표기한다(예: "경쟁 서비스 12개", "실제 유저 목소리 8건").

**(e) AI 슬롭 안티패턴 표에 한 행을 추가한다.** `차트 라이브러리 기본 테마(무지개 팔레트)` — 이유:
`색은 데이터 의미에만 쓴다는 원칙 위반`.

### 3. `docs/ARCHITECTURE.md`

- `runs/{run-id}/` 디렉토리 구조에 `thesis.json`(Thesis 산출물)과 `verdict.json`(Verdict 산출물)을 추가한다.
  `questions.json`(인터뷰 질문)·`answers.json`(사용자 답변)도 누락되어 있으면 함께 채워라.
- "데이터 흐름" 다이어그램을 6 step으로 갱신한다:
  `interviewer(웹 전용) → context-hunter → thesis → cold-critic → solution-designer → verdict → report.md`
- `web/src/components/` 설명에 `report/`가 담을 새 컴포넌트를 명시한다:
  `DialecticSplit`(正/反 좌우 대립), `RiskRadar`(인라인 SVG), `VerdictSection`(최종 판정).
- 리포트 렌더링 순서가 5단계 서사를 따르며 결론이 마지막에 온다는 점을 "패턴" 절에 한 줄 추가한다.

### 4. `docs/ADR.md`

기존 ADR-001~007은 **수정·삭제하지 마라.** ADR은 append-only 기록이다. 아래 4개를 뒤에 추가한다.
각 ADR은 기존 형식(결정 / 이유 / 트레이드오프, 필요시 기각한 대안)을 그대로 따른다.

- **ADR-008: 리포트 서사를 역피라미드에서 5단계 순차 논증으로 전환**
  결정: 결론(최종 판정)을 리포트 최하단에 배치하고 상단 요약 배너를 제거한다.
  이유: 정반합은 전개 과정 자체가 산출물이다. 결론을 먼저 노출하면 正/反 대립이 장식으로 전락한다.
  트레이드오프: "그래서 결론이 뭐냐"를 알려면 스크롤이 필요하다. 목차 네비의 현재 섹션 강조로 완화한다.

- **ADR-009: 리스크 시각화는 외부 차트 라이브러리 없이 인라인 SVG로 구현**
  이유: ADR 철학(외부 의존성 최소화), UI_GUIDE의 무채색 문서 톤, 3축 레이더는 좌표 계산이 단순하다.
  기각한 대안: recharts — 번들 크기 증가와 기본 테마가 UI_GUIDE 색 원칙과 충돌해 오버라이드 비용이 크다.
  트레이드오프: 툴팁·반응형을 직접 구현해야 한다(이번 phase에서는 툴팁 제외).

- **ADR-010: 최종 판정을 별도 에이전트 step으로 분리**
  결정: `solution-designer` 다음에 `verdict` step을 추가한다.
  이유: 기존 `criticism.verdict`는 反 에이전트의 산출물이라 合(피벗)을 반영하지 못한다. 이를 최종 결론으로
  쓰면 "피벗을 설계해놓고 피벗 이전의 사망선고를 결론으로 내는" 논리 파탄이 생긴다. 合을 설계한
  `solution-designer`가 스스로 채점하면 낙관 편향이 들어간다.
  트레이드오프: Gemini 호출이 1회 늘어난다.

- **ADR-011: Criticism의 3그룹 배열을 폐기하고 `points[] + axis`로 평탄화**
  결정: `painPointReality`/`bmWeakness`/`copycatRisk` 세 배열을 없애고, `axis` 필드를 가진 단일
  `points[]`로 바꾼다. Thesis에도 같은 축을 가진 `points[]`를 추가한다.
  이유: 축이 배열 이름에만 존재하면 正의 주장과 反의 비판을 짝지을 수 없어 Split View가 성립하지 않는다.
  배열 이름과 `axis` 필드가 공존하면 두 개의 진실이 생겨 LLM이 불일치를 만든다.
  트레이드오프: 구 `criticism.json`·`thesis.json`은 스키마 검증에 실패한다. 완료된 구버전 run은
  리포트 뷰에서 빈 상태가 되고 `report.md` 다운로드로 대체한다.

## Acceptance Criteria

```bash
npm run build && npm test
! grep -rq "역피라미드" docs/
grep -q "ADR-011" docs/ADR.md
grep -q "Phase 2-dialectic-report" docs/PRD.md
grep -q "RiskRadar" docs/UI_GUIDE.md
```

첫 커맨드는 문서만 바뀌었으므로 이 step 이전과 동일하게 통과해야 한다. 통과하지 않으면 코드를 건드린 것이다.

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. `git diff --name-only`로 변경된 파일이 `docs/` 아래 4개 문서뿐인지 확인한다.
3. 아키텍처 체크리스트를 확인한다:
   - ADR-001~007이 원문 그대로 남아 있는가?
   - PRD의 5단계 서사 순서가 `시장 맥락 → 正 → 反 → 合 → 최종 판정`인가?
   - UI_GUIDE에 새 색상값이 도입되지 않았는가? (기존 severity 색만 재사용)
4. 결과에 따라 `phases/2-dialectic-report/index.json`의 step 0을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약"`
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - 사용자 개입 필요 → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

## 금지사항

- `src/` 또는 `web/` 아래 어떤 파일도 수정하지 마라. 이유: 이 step의 유일한 산출물은 이후 11개 step에
  주입될 가드레일 문서다. 코드가 섞이면 문서 변경의 효과를 검증할 수 없다.
- ADR-001~007을 수정하거나 삭제하지 마라. 이유: ADR은 결정의 시점을 보존하는 append-only 기록이다.
  ADR-008이 ADR-007을 뒤집는다면, 뒤집는다는 사실을 ADR-008 본문에 적어라.
- UI_GUIDE에 새 색상값(hex)을 추가하지 마라. 이유: 원칙 3 "색은 데이터의 의미에만 쓴다"를 지키려면
  팔레트가 늘어나선 안 된다. 레이더·게이지는 기존 severity 색만 재사용한다.
- PRD의 "run 상태 파생 규칙"을 수정하지 마라. 이유: 이 phase는 리포트 서사만 바꾼다. 실행 상태
  판정 로직(`deriveRunStatus`)은 이번 변경 범위 밖이다.
- 기존 테스트를 깨뜨리지 마라.
