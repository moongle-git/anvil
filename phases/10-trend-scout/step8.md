# Step 8: scout-ui

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `/docs/UI_GUIDE.md` — **전체.** 톤·컴포넌트 규격의 단일 소스다
- `/docs/PRD.md` — Phase 1-web-ui의 IA와 진행 뷰·리포트 뷰 규격, "run 상태 파생 규칙"
- `/docs/ADR.md` — **ADR-008**(순차 논증, 상단 요약 배너 금지), **ADR-013**(출처는 사실이다)
- `web/AGENTS.md` — **이 Next.js는 훈련 데이터의 Next.js가 아니다.** `node_modules/next/dist/docs/`의 해당 가이드를 읽어라
- `web/src/components/home/HomeClient.tsx`, `web/src/components/home/IdeaForm.tsx`
- `web/src/components/progress/ProgressView.tsx` — `STEP_LABELS`
- `web/src/components/progress/QuestionForm.tsx` — **이 step이 복제할 선례다** (waiting 상태에서 사람의 입력을 받아 제출)
- `web/src/components/progress/RunDetailClient.tsx`, `web/src/components/progress/useRunDetail.ts`
- `web/src/components/ui/index.ts` — 기존 공통 컴포넌트 목록
- `web/src/test/components/progress.test.tsx`, `web/src/test/components/home.test.tsx`

## 이전 step에서 만들어진 것

- step 1: 스카우트 run은 `trend-scout` step을 갖고 `interviewer`를 갖지 않는다
- step 4: 후보 생성 후 `trend-scout`이 `waiting`. 후보 0개면 `error` + 사람이 읽을 메시지
- step 7: `POST /api/runs { mode: "scout", scope? }`, `POST /api/runs/[id]/selection { candidateId }`, `GET /api/runs/[id]`가 `opportunities`를 함께 반환

이전 step에서 만들어진 코드를 꼼꼼히 읽고, 설계 의도를 이해한 뒤 작업하라.

## 작업

### 1. 홈 — 두 모드

홈 상단 입력 영역이 두 모드를 갖는다. 기존 `IdeaForm`은 **그대로 남긴다.**

- **직접 입력** (기본) — 현행 그대로
- **주제 찾기** — 범위 힌트 textarea(선택) + "주제 찾기" 버튼. 비어 있어도 제출 가능해야 한다

두 모드 모두 제출 후 `/runs/{id}`로 이동한다. 모드 전환 UI 형태(탭·토글 등)는 UI_GUIDE의 톤 안에서 네가 정하라.

**빈 범위로 제출하는 것을 막지 마라.** 범위 없는 전 범위 탐색이 이 기능의 기본 사용법이다. 버튼을 비활성으로 두면 기본 경로가 막힌다.

### 2. 진행 뷰 — 스테퍼

`ProgressView`의 `STEP_LABELS`에 `"trend-scout"`을 추가하라. 내부 step명을 사용자 언어로 번역하는 기존 규칙을 따른다(예: `"주제 탐색"`).

`STEP_LABELS`가 `Record<PipelineStepName, string>`이므로 step 0에서 `PIPELINE_STEPS`가 늘어난 시점에 이미 컴파일 에러가 났을 것이다. 임시 값이 채워져 있다면 제대로 된 라벨로 교체하라.

### 3. 후보 선택 화면 — 이 step의 본체

`trend-scout`이 `waiting`인 run 상세에서 후보 목록을 보여주고 하나를 고르게 한다. `QuestionForm`이 인터뷰 답변을 받는 자리와 같은 위치·같은 흐름이다.

후보 카드에 **반드시** 표시할 것:

| 항목 | 이유 |
|---|---|
| `title`, `whatItIs` | 무엇인지 |
| `whyNow`, `whoPays`, `horizon` | 왜 지금인지, 누가 돈을 내는지, 시간축 |
| `signals[]` — `signalType`, `statement`, **`observedAt`** | 날짜가 보여야 사용자가 최신성을 판단한다 |
| 각 신호의 출처 **링크 + `domain`** | 출처가 통신사인지 블로그인지는 사람이 판단한다 |
| **`counterSignal`** | 불리한 증거. 접어두더라도 **기본 노출**하라 |
| `quote` (있으면) | step 2가 코드 대조 불가로 결론지었다면, **사람이 눈으로 검증하는 것이 유일한 수단이다** |

- **후보에 점수·순위·추천 뱃지를 붙이지 마라.** 데이터에 그런 필드가 없고(step 0), UI가 임의로 만들어내면 파이프라인 완주 전에 결론을 노출하는 것이 된다(ADR-008·ADR-010).
- 카드 순서를 "추천순"으로 재정렬하지 마라. 모델이 낸 순서 그대로 둔다.
- 선택은 **명시적 확인**을 거친다. 클릭 한 번으로 파이프라인이 시작되면 안 된다 — 이후 단계는 되돌릴 수 없고 비용이 든다.
- 제출 중 이중 제출을 막아라(`IdeaForm`의 `submitting` 유지 패턴).

### 4. 후보 0개 — error 상태의 안내

step 4가 후보 0개를 `error` + 메시지로 남긴다. 기존 error 표시 경로(`ErrorState`, "이어서 실행" 버튼)를 타되, **이 경우 "이어서 실행"은 같은 자리에서 다시 멈춘다**(step 4가 저장된 빈 결과를 재사용하므로).

사용자에게 **새 탐색을 다른 범위로 시작하라**고 안내하라. 근거를 못 찾아 후보를 만들지 않은 것은 고장이 아니라 설계된 동작이다 — 실패처럼 읽히되 사용자를 탓하거나 시스템이 망가진 것처럼 보이면 안 된다.

### 5. 리포트 뷰 — 주제 출처

완료된 스카우트 run의 리포트 뷰에서 "이 주제가 어디서 왔는지"를 보여준다.

- **① 시장 맥락보다 앞**, 헤더 영역에 둔다. `report.md`의 배치(step 6)와 일치시켜라.
- **결론·점수를 넣지 마라.** 상단 요약 배너 금지(ADR-008)에 걸린다. 담기는 것은 출처이지 판정이 아니다.
- **`SectionNav`의 5단계 목차(① ~ ⑤)를 건드리지 마라.** 항목을 추가하면 5단계 서사가 6단계로 보인다.

## Acceptance Criteria

```bash
npm run build   # 컴파일 에러 없음 (tsc + next build)
npm test        # 테스트 통과
npm run lint
```

`web/src/test/components/`에 테스트를 **먼저** 작성하라(TDD).

**테스트 작성 방식:** 브리틀한 클래스명 단언(`expect(el).toHaveClass("bg-red-500")`)을 쓰지 마라. **계약·동작·접근성·시맨틱 `data-*` 훅**으로 검증하라 — 역할(role)·접근 가능한 이름·사용자 상호작용의 결과로 단언한다. 기존 `web/src/test/components/*.test.tsx`가 쓰는 방식을 따르고, 필요하면 시맨틱 `data-*` 속성을 컴포넌트에 추가해 훅으로 삼아라.

최소한 아래를 덮어라:

- 홈 — 범위를 비운 채 "주제 찾기" 제출이 **가능하다** (버튼이 비활성이 아니다)
- 홈 — 스카우트 제출 시 `POST /api/runs`에 `mode: "scout"`이 실린다
- 홈 — 직접 입력 모드는 기존 동작 그대로다 (회귀 없음)
- 진행 뷰 — 스카우트 run의 스테퍼에 `"trend-scout"`의 사용자 언어 라벨이 뜬다
- 선택 화면 — 후보의 `observedAt`·출처 `domain`·**`counterSignal`이 렌더된다**
- 선택 화면 — 점수·순위·추천 뱃지가 **렌더되지 않는다**
- 선택 화면 — 확인 단계를 거쳐야 `POST /selection`이 호출된다 (카드 클릭만으로는 호출되지 않는다)
- 선택 화면 — 제출 중 이중 제출이 막힌다
- 후보 0개 error run — 새 탐색을 안내하는 문구가 뜬다
- 리포트 뷰 — 주제 출처가 ① 시장 맥락보다 앞에 있다
- 리포트 뷰 — `SectionNav` 목차가 여전히 5개다

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크리스트를 확인한다:
   - ARCHITECTURE.md 디렉토리 구조를 따르는가?
   - ADR 기술 스택을 벗어나지 않았는가? (차트·UI 라이브러리를 새로 도입하지 않았는가 — ADR-009)
   - CLAUDE.md CRITICAL 규칙을 위반하지 않았는가?
   - **UI_GUIDE.md의 컴포넌트 규격과 톤을 따르는가?**
   - 데이터 접근이 API route를 경유하는가? (서버 컴포넌트에서 RunStore 직접 호출 금지)
3. 결과에 따라 `phases/10-trend-scout/index.json`의 해당 step을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약"`
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - 사용자 개입 필요 → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

## 금지사항

- **후보에 점수·순위·추천 뱃지를 UI에서 만들어내지 마라.** 이유: 데이터에 없는 판정을 UI가 발명하는 것이고, 파이프라인 완주 전에 결론을 노출한다(ADR-008·ADR-010).
- **범위가 비었다고 제출을 막지 마라.** 이유: 전 범위 탐색이 기본 사용법이다.
- **카드 클릭 한 번으로 파이프라인을 시작하지 마라.** 이유: 되돌릴 수 없고 비용이 든다.
- **`SectionNav`의 5단계 목차에 항목을 추가하지 마라.** 이유: 5단계 서사가 6단계로 보인다(PRD "순서는 협상 불가").
- **리포트 뷰 상단에 결론·점수를 노출하지 마라.** 이유: ADR-008이 금지한 상단 요약 배너다.
- **`counterSignal`을 숨기지 마라.** 이유: 유리한 신호만 보이면 사용자가 편향된 상태로 주제를 고른다.
- **클래스명으로 테스트를 단언하지 마라.** 이유: 브리틀하다. 계약·동작·접근성·시맨틱 `data-*` 훅으로 검증한다.
- **차트·UI 라이브러리를 새로 도입하지 마라.** 이유: ADR-009 — 시각화는 인라인 SVG로 한다.
- **Next.js API를 기억에 의존해 쓰지 마라.** 이유: `web/AGENTS.md` — 이 버전은 훈련 데이터와 다르다.
- 기존 테스트를 깨뜨리지 마라.
