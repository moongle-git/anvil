# Step 9: scout-docs

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 기획·아키텍처·설계 의도를 파악하라:

- `/docs/ADR.md` — **전체 구조와 서술 톤.** 특히 ADR-012·ADR-013·ADR-016·ADR-017의 형식(맥락 → 결정 → 근거 → 번복 조건 / 폐기 관계)
- `/docs/ARCHITECTURE.md` — "디렉토리 구조", "DB 스키마", "패턴", "데이터 흐름", "웹 UI 데이터 흐름"
- `/docs/PRD.md` — phase별 섹션 구조(목표 / 동작 요구사항 / 하위호환 / 제외 사항)
- `/CLAUDE.md` — 아키텍처 규칙, 명령어, 환경변수
- 이 phase에서 만들어진 코드 전부:
  - `src/types/opportunity.ts`
  - `src/agents/scoutPlanner.ts`, `src/agents/scoutSearch.ts`, `src/agents/trendScout.ts`
  - `src/lib/runStore.ts`, `src/pipeline/orchestrator.ts`, `src/lib/report.ts`, `src/agents/contextHunter.ts`의 변경분
  - `web/src/app/api/runs/**`, `web/src/components/**`의 변경분
- `phases/10-trend-scout/index.json` — **step 0~8의 `summary`를 전부 읽어라.** 실제로 무엇이 만들어졌는지의 기록이다

## 이전 step에서 만들어진 것

step 0~8이 `trend-scout` 기능을 완성했다. 이 step은 **코드를 바꾸지 않고** 문서를 실제 구현에 맞춘다.

**추측으로 쓰지 마라.** 각 문서 문장의 근거를 코드에서 확인하라. 설계 단계의 계획과 실제 구현이 다르면 **구현이 옳다** — 문서를 구현에 맞춰라. 다르다는 사실 자체가 기록할 가치가 있으면 ADR에 적어라.

## 작업

### 1. `docs/ADR.md` — ADR-019 추가

제목 예: **"주제를 사용자 입력에서 자본 흐름 탐색으로 확장하고, 귀속을 스키마로 강제한다"**

기존 ADR의 서술 밀도를 따르라 — 결정만이 아니라 **왜 다른 길을 택하지 않았는지**를 적는다. 최소한 아래를 담아라:

**결정 1 — 두 모드 공존, 스카우트는 파이프라인 앞 step**
- 별도 `scouts` 테이블 + 별도 라우트로 분리하지 않은 이유: `usage.run_id`가 NOT NULL FK라 run이 아닌 개체의 Gemini 호출 비용을 적을 곳이 없다(ADR-016의 "모든 호출은 기록된다"가 깨진다). 앞 step으로 두면 usage·steps·artifacts·비교·재실행·삭제 인프라를 전부 재사용한다
- `interviewer`의 `waiting` pause/resume이 선례다. detached CLI에는 stdin이 없어 아티팩트로 멈추고 재개한다(ADR-007)
- 대가: `runs.idea`가 가변이 된다. `run_id` slug에 초기 힌트가 남는다(불투명 식별자라 동작 문제 없음)

**결정 2 — `scout`은 컬럼이 아니라 `steps`에서 파생한다**
- `runs`에 컬럼을 더하지 않은 이유: `db.ts`의 DDL이 전부 `CREATE TABLE IF NOT EXISTS`라 **기존 DB에 컬럼이 생기지 않는다.** `usage`(ADR-016) 추가가 무사했던 것은 통째로 새 테이블이었기 때문이다. ADR-014가 마이그레이션 러너를 금지하므로 러너를 만드는 것도 답이 아니다
- 결과: 스키마 변경 0, `SCHEMA_VERSION` 그대로, 마이그레이션 0
- `interview`가 컬럼으로 남는 이유(인터뷰가 켜졌는데 질문이 0개면 두 값이 불일치)도 함께 적어라

**결정 3 — grounded 호출을 검색과 합성으로 쪼갠다**
세 가지 이유를 모두 적어라:
1. grounding 인용 URI는 만료되는 `vertexaisearch` 리다이렉트 주소라 LLM이 볼 수도 타이핑할 수도 없다 → 코드가 `C1`·`C2` 번호를 붙여 다음 호출에 넘겨야 ID 지목이 가능하다(`contextHunter`의 `[V1]` 패턴과 동일)
2. grounding은 `responseJsonSchema`를 못 쓴다 → 중첩 깊은 후보 스키마를 자유 텍스트 JSON 추출로 받으면 형식 실패가 쏟아진다
3. 그래서 비싸진다 → ADR-016 실측에서 `context-hunter` 비용을 부풀린 원인이 "grounding 정액 + 형식 실패 재시도"였다

**결정 4 — 환각 방어는 프롬프트가 아니라 스키마다**
코드가 강제하는 것을 나열하라: 인용 화이트리스트 / 삼각측량(서로 다른 `signalType` 2종 + 서로 다른 인용 2개) / `observedAt` 날짜창 / 수치 귀속 / `counterSignal` 필수 / **침묵 허용**.

그리고 **경계를 명시하라** — ADR-013이 그은 선과 같다:
- 코드가 보장하는 것: 모든 주장이 실제로 검색된 문서를 가리킨다
- **코드가 보장하지 못하는 것: 그 문서가 정말 그 말을 하는가.** 이 구멍은 닫히지 않았다
- `groundingSupports` 원문 대조가 가능한지에 대한 **step 2의 조사 결론과 그에 따른 실제 처리**를 적어라. 대조하지 않았다면 하지 않았다고 적어라
- 자본 데이터의 1차 사료(PitchBook·CB Insights·산업 리포트)는 유료 장벽 뒤라 Google Search grounding이 닿지 못한다. 얻는 것은 자본 흐름의 **공개된 그림자**다. `regulation`이 네 축 중 유일하게 1차 사료가 공개된 축이라는 점도 적어라

**결정 5 — 스카우트는 점수를 매기지 않고, 검증하지 않는다**
- 후보에 점수·순위가 없는 이유: ADR-010이 판정자를 분리한 근거와 같다
- "이미 레드오션인가"를 앞단에서 거르지 않는 이유: `cold-critic`(反)의 일이고, 앞에서 거르면 反이 공격할 표적이 사라진다
- `counterSignal`은 후보를 **걸러내지 않고 주석만 단다** — 판정이 아니라 사실 요구다

**번복 조건** — 기존 ADR들(ADR-016·ADR-018)이 쓰는 형식으로, 이 결정이 뒤집힐 조건을 적어라.

### 2. `docs/PRD.md` — Phase 10 섹션 추가

기존 phase 섹션 형식(목표 / 동작 요구사항 / 하위호환 / 제외 사항)을 따르라.

- **목표** — 아이디어 입력을 전제하던 파이프라인에 자본 흐름 기반 주제 탐색 모드를 더한다. 5단계 서사는 바뀌지 않는다
- **동작 요구사항** — 두 모드, 선택적 범위 힌트, 후보 3~5개, 하나만 선택, 스카우트 모드에서 인터뷰 생략, 후보 0개 처리
- **하위호환** — 기존 run은 `trend-scout` step이 없어 지금과 동일하게 동작한다. **DB 스키마가 바뀌지 않아 기존 DB 파일이 그대로 열린다**(ADR-011처럼 구 run이 빈 리포트가 되는 일이 없다)
- **제외 사항** — 후보 복수 선택(한 run = 한 주제), CLI 스카우트 모드(detached라 stdin 없음 — `interviewer`와 같은 이유), 유료 자본 데이터 소스, 인기도 기반 소스(HN 인기글·YouTube 급상승·네이버 데이터랩 — 자본 흐름과 다른 축이라 의도적으로 제외), 탐색 결과 캐싱·재사용

### 3. `docs/ARCHITECTURE.md` 갱신

- **디렉토리 구조** — `agents/`의 설명에 `scoutPlanner`·`scoutSearch`·`trendScout` 추가. `types/`에 `opportunity` 추가
- **DB 스키마** — `artifacts.kind` 주석의 kind 목록에 `opportunities`·`selection` 추가. 아래 대응표에도 두 행 추가. **`runs` 테이블과 `SCHEMA_VERSION`은 바뀌지 않았다는 사실을 명시하라**
- **패턴** — "자본 흐름 탐색은 검색과 합성으로 쪼갠다" 항목 추가. 기존 항목들의 밀도(한 문단, ADR 참조 포함)를 따르라
- **데이터 흐름** — `trend-scout` step을 흐름도 맨 앞에 추가. `interviewer`와 상호배타적임을, `waiting` pause와 `selection` 수신을, 확정 주제가 `runs.idea`로 UPDATE됨을 표기하라. `scout-planner`·`scout-search`·`trend-scout` 세 usage 라벨이 남는다는 것도 적어라
- **웹 UI 데이터 흐름** — `POST /api/runs`의 scout 모드와 `POST /api/runs/{id}/selection` 추가

### 4. `CLAUDE.md` 갱신

"아키텍처 규칙"에 이 phase의 CRITICAL 규칙을 추가하라. 기존 항목들의 톤(규칙 + 이유 + ADR 참조)을 따르되 **짧게** 써라. 최소한:

- 스카우트 후보의 모든 주장은 코드가 추출한 인용에 ID로 귀속되어야 하며, 검증은 `opportunitiesSchemaFor` 팩토리가 `generateStructured` 안에서 한다(바깥으로 빼면 재시도가 안 붙는다 — ADR-017과 같은 이유)
- `candidates: []`는 합법이다. 빈 결과를 불법으로 만들면 모델이 환각을 낸다
- 후보에 점수·순위를 넣지 마라(ADR-010). 레드오션 판정은 `cold-critic`의 일이다
- `runs`에 컬럼을 추가하지 마라 — DDL이 `IF NOT EXISTS`뿐이라 기존 DB에 반영되지 않는다(ADR-019 결정 2)

### 5. 비용 실측 — 추정치를 숫자로 대체하라

설계 단계에서 "스카우트 모드 run은 대략 1.5배"라고 **추정**했다. ADR-016이 세운 선례는 **추정이 아니라 실측을 근거로 삼는 것**이다.

- `formatUsageSummary`(`src/cli/index.ts`)가 라벨별 비용을 출력한다. `scout-planner`·`scout-search`·`trend-scout` 세 라벨이 run 비용에서 차지하는 비중을 확인할 수 있다
- 실행에 `GEMINI_API_KEY`가 필요하다. **키가 없거나 실행이 불가능하면 숫자를 지어내지 마라** — `status: "blocked"`, `blocked_reason`에 사유를 적고 즉시 중단하라. 이 phase 전체가 "확인하지 않은 것을 확인한 것처럼 적지 않는다"를 위한 것이다
- 실측했다면 ADR-016이 자기 실측을 적은 형식을 따라 **표본 수(n)를 함께 적어라.** n=1이면 "이 숫자로 분포를 말하지 마라"고 명시하라 — ADR-018이 쓴 문장 그대로다

### 6. `phases/index.json`

`10-trend-scout`의 `status`는 execute.py가 갱신한다. **직접 건드리지 마라.**

## Acceptance Criteria

```bash
npm run build   # 컴파일 에러 없음
npm test        # 테스트 통과
npm run lint
```

문서 step이므로 코드 변경이 없어야 하고, 위 커맨드는 **step 8 종료 시점과 동일하게** 통과해야 한다.

추가 확인:
- `docs/` 안에서 배포 절차를 중복 서술하지 않았는가 (`docs/DEPLOY.md`가 단독 소유 — ARCHITECTURE.md의 명시적 규칙)
- ARCHITECTURE.md의 데이터 흐름도가 `src/pipeline/orchestrator.ts`의 실제 순서와 일치하는가
- CLAUDE.md에 적은 규칙이 실제 코드에서 지켜지고 있는가 (문서가 코드보다 앞서가면 안 된다)

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크리스트를 확인한다:
   - 문서가 실제 구현과 일치하는가? (계획이 아니라 코드를 근거로 썼는가)
   - ADR 번호가 중복되지 않는가? (기존 최대 번호 확인 후 다음 번호 사용)
   - 기존 ADR을 폐기·수정했다면 그 관계를 명시했는가?
3. 결과에 따라 `phases/10-trend-scout/index.json`의 해당 step을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약"`
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - 사용자 개입 필요 (비용 실측용 API 키 등) → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

## 금지사항

- **코드를 수정하지 마라.** 이유: 이 step의 scope는 문서다. 문서와 구현이 어긋나면 **문서를 구현에 맞춰라**. 구현이 정말 틀렸다면 고치지 말고 ADR에 기록한 뒤 별도 step으로 남겨라
- **실행하지 않은 비용 수치를 적지 마라.** 이유: ADR-016의 선례는 실측이다. 키가 없으면 `blocked`로 중단하라. 이 phase 전체의 주제가 "확인하지 않은 것을 적지 않는다"이다
- **`docs/DEPLOY.md`의 절차를 다른 문서에 복사하지 마라.** 이유: 두 곳에 적으면 반드시 갈라진다(ARCHITECTURE.md의 명시적 규칙)
- **코드가 보장하지 못하는 것을 보장한다고 쓰지 마라.** 특히 "환각을 없앴다"고 쓰지 마라. 이유: 인용이 실재함은 보장되지만 그 문서가 그 말을 하는지는 보장되지 않는다. 남은 구멍을 명시하는 것이 이 ADR의 핵심이다
- **`phases/index.json`을 직접 수정하지 마라.** 이유: execute.py가 소유한다
- 기존 테스트를 깨뜨리지 마라
