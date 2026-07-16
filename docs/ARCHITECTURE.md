# 아키텍처

## 디렉토리 구조
```
src/
├── cli/               # CLI 엔트리포인트 (아이디어 입력 → 파이프라인 실행 → 리포트 경로 출력)
├── pipeline/          # 오케스트레이터 (step 순차 실행, 상태 관리, 재시도, resume)
├── agents/            # contextHunter / coldCritic / solutionDesigner (프롬프트 + 호출 로직)
├── services/          # 외부 API 래퍼 — gemini.ts (@google/genai), youtube.ts (YouTube Data API),
│                      #   hackerNews.ts (Algolia HN Search API), naver.ts (네이버 검색 API)
├── research/          # 소스 어댑터 + 병렬 수집(collectAll) + 프롬프트 포맷팅
│                      #   — services/를 CommunityVoice로 정규화. 직접 fetch하지 않는다
├── lib/               # db (SQLite 연결·스키마 — node:sqlite DatabaseSync, PRAGMA 설정),
│                      #   runStore (SQLite 저장소 — run·step·artifact·usage CRUD + listRuns),
│                      #   cost (모델 단가표 + 토큰→USD 추정 — 순수 함수. 추정치이지 청구서가 아니다),
│                      #   report (Markdown 렌더러), html (HTML 태그·엔티티 제거)
└── types/             # zod 스키마 + TypeScript 타입 (RunState, MarketContext, Criticism, Solution),
                       #   ledger (合의 원장·판정의 감사가 공유하는 어휘 — Remedy, RemedyAudit,
                       #     참조 무결성·침묵 검사 순수 함수. severity가 dialectic에 사는 것과 같은 이유 — ADR-017)

web/                   # Next.js App Router 웹 UI (npm workspace) — 1-web-ui phase
├── src/app/           # 라우트: / (홈), /runs/[id] (진행/리포트), /compare, /api/*
├── src/components/    # ui/ (UI_GUIDE 기반 공통 컴포넌트), report/ (리포트 섹션)
│                      #   report/: DialecticSplit(正/反 좌우 대립), RiskRadar(인라인 SVG),
│                      #            VerdictSection(최종 판정)
├── src/lib/server/    # 서버 전용: RunStore 어댑터, CLI spawn, 상태 파생
└── src/test/          # vitest 설정, fixture run 데이터

data/anvil.db          # SQLite DB — 실행 상태·산출물의 단일 진실 공급원 (git 미추적, ADR-014)
                       #   WAL 모드라 anvil.db-wal / anvil.db-shm 파일이 함께 생긴다 (역시 git 미추적)
```

## DB 스키마 (ADR-014, ADR-016)
```
runs(run_id PK, idea, created_at, updated_at, completed_at NULL,
     interview INTEGER, rerun_of NULL REFERENCES runs(run_id) ON DELETE SET NULL)
steps(run_id REFERENCES runs ON DELETE CASCADE, name, ordinal, status,
      started_at, completed_at, failed_at, error_message, PRIMARY KEY(run_id, name))
artifacts(run_id REFERENCES runs ON DELETE CASCADE, kind, content TEXT, updated_at,
          PRIMARY KEY(run_id, kind))
```
**도메인 테이블은 이 3개가 전부다.** 여기에 **관측 테이블 1개**가 붙는다 (ADR-016):
```
usage(run_id REFERENCES runs ON DELETE CASCADE, label, model, grounded, attempt,
      prompt_tokens, cached_tokens, output_tokens, thoughts_tokens, total_tokens,
      cost_usd REAL, created_at)          -- PK 없음
```
`usage`는 **산출물이 아니라 사건 로그다.** Gemini 호출 1회 = 1행이며, 재시도한 시도도 실패한 시도도 각각 한 행이 된다. **PK가 없다** — usage 행은 개별로 지목·갱신되지 않고 오직 집계(SUM·GROUP BY)될 뿐이라 식별할 이유가 없다. 자연키(`run_id, label, attempt`)는 특히 쓰면 안 된다: resume하면 `attempt`가 1부터 재시작해 충돌하고, 그것을 UPSERT로 무마하면 이미 청구된 기록이 덮어써진다. 컬럼명은 `src/lib/cost.ts`의 `CallUsage`와 1:1로 대응해 관측치가 서비스 → `onUsage` 콜백 → DB로 이름을 바꾸지 않고 흐른다. `label`은 kebab-case step 이름(`context-hunter`, `cold-critic`, …)이라 `steps`와 나란히 조회된다. 산출물이 아니므로 ADR-014의 "정규화하지 않는다"(그 규칙의 대상은 **에이전트 산출물**이다)와 충돌하지 않는다. usage는 스키마가 고정된 숫자 관측치이고 집계가 존재 이유라 컬럼으로 정규화하는 것이 옳다.

그 밖에 `schema_version(version)`(현재 **2** — 기록만 하고 **마이그레이션 러너는 두지 않는다**. `usage` 추가는 `IF NOT EXISTS` 증분이라 변환할 기존 데이터가 없다. 시딩이 멱등이라(행이 있으면 UPDATE, 없으면 INSERT) 기존 DB도 열리는 즉시 2가 된다)과 인덱스 2개(`idx_runs_created_at ON runs(created_at DESC)` — 목록 정렬용, `idx_usage_run_id ON usage(run_id)` — run별 비용 집계용)가 있다. DDL은 전부 `IF NOT EXISTS`라 커넥션을 여러 번 열어도 안전하다(`src/lib/db.ts`의 `openDb`).

연결 시 PRAGMA: `journal_mode = WAL`(CLI 쓰기 + Next 서버 읽기의 동시 접근), `busy_timeout = 5000`(잠금 경합 시 대기), `foreign_keys = ON`(**꺼져 있으면 CASCADE 삭제가 조용히 동작하지 않는다** — SQLite 기본값은 OFF).

`runs` + `steps`가 구 `state.json`을 대체한다. `artifacts.content`는 JSON 직렬화 문자열이며(`kind='report'`만 마크다운 원문), 구 파일과 다음과 같이 대응한다:

| `artifacts.kind` | 구 파일 | 내용 |
|---|---|---|
| `questions` | `questions.json` | Interviewer 산출물 (InterviewQuestions) — 웹 생성 run에서만 |
| `answers` | `answers.json` | 사용자가 제출한 인터뷰 답변 (InterviewAnswers) — step 산출물이 아닌 사람의 아티팩트 |
| `research` | `research.json` | 수집된 원시 증거 (ResearchEvidence) — voices[] + 소스별 coverage[]. `context`의 communityVoices는 이 증거의 부분집합이어야 한다 |
| `context` | `context.json` | Context Hunter 산출물 (MarketContext) |
| `thesis` | `thesis.json` | Thesis 산출물 (Thesis, 正) |
| `criticism` | `criticism.json` | Cold Critic 산출물 (Criticism, 反) |
| `solution` | `solution.json` | Solution Designer 산출물 (Solution, 合) |
| `verdict` | `verdict.json` | Verdict 산출물 (Verdict) — 최종 판정 |
| `report` | `report.md` | 최종 컨설팅 리포트 (마크다운 원문) |

기존 `runs/{run-id}/` 디렉토리는 일회성 스크립트(`npm run migrate:runs`)로 DB에 이송한다. 원본은 지우지 않는다.

## 패턴
- **하네스 패턴 런타임** (scripts/execute.py와 동형): 각 에이전트는 순차 실행되는 step. 산출물은 파일로 persist하고, 이전 step 산출물을 다음 프롬프트에 컨텍스트로 주입한다. 실패 시 에러 메시지를 피드백하며 최대 3회 자가 교정 재시도한다.
- **구조화 출력 + 스키마 검증**: 모든 에이전트 산출물은 Gemini 구조화 출력(JSON)으로 받고 zod 스키마로 검증한다. 검증 실패는 재시도 대상이다.
- **서비스 레이어 격리**: 외부 API(Gemini, YouTube, Hacker News, 네이버) 호출은 services/에서만 일어난다. agents/는 services/를 통해서만 외부와 통신하고, research/도 직접 fetch하지 않고 주입받은 services/를 정규화만 한다.
- **다중 소스 병렬 수집 + fail-soft** (ADR-012): 유저 목소리 소스(YouTube·Hacker News·네이버)는 `src/research/`의 `collectAll`이 `Promise.allSettled`로 병렬 수집한다. 일부 소스의 실패(quota 초과, 네트워크 오류)는 흡수하고 성공한 소스만 사용하며, **전부 실패해도 파이프라인을 멈추지 않는다** — 웹검색만으로 진행한다. API 키가 없는 소스는 실패가 아니라 애초에 소스 배열에서 제외한다.
- **순차 논증 렌더링**: 리포트는 5단계 서사(시장 맥락 → 正 → 反 → 合 → 최종 판정)를 따라 렌더링되며, 결론(최종 판정)은 마지막에 온다. 상단 요약 배너는 두지 않는다 (ADR-008).
- **출처는 사실이다** (ADR-013): 클릭 가능한 링크로 렌더되는 URL은 코드가 API 응답에서 주입한 것뿐이다(`citations`, `communityVoices`). LLM이 타이핑한 URL(`sources[]`, `competitors[].url`)은 텍스트로만 표시한다.
- **저장소는 바이트를, zod는 의미를** (ADR-014): 에이전트 산출물은 artifacts 테이블에 JSON 문자열로 통째로 들어간다. 컬럼으로 정규화하지 않는다. 스키마의 권위는 zod 단독이다.
- **삭제는 CASCADE, 재실행은 포크** (ADR-015): run 삭제는 FK `ON DELETE CASCADE`로 steps·artifacts를 함께 지운다(`running` run은 삭제 불가). 재실행은 원본을 덮어쓰지 않고 `idea`·`questions`·`answers`만 복사한 새 run을 만들어 자료조사부터 다시 돈다. 계보는 `runs.rerun_of`에 남는다.
- **비용은 관측된다** (ADR-016): 모든 Gemini 호출은 **재시도까지 포함해** `usage` 테이블에 한 행씩 기록된다 — 검증에 실패한 시도도 과금되므로 자기 행을 남긴다(형식이 실패한 것이지 청구가 실패한 게 아니다). thinking 토큰은 출력 요금으로 과금되므로 `thoughts_tokens` 컬럼으로 분리해 본다. thinking은 끄지 않고 에이전트별 `thinkingBudget`으로 상한만 둔다(기계적 에이전트 0, 추론 에이전트 2048~8192). `GeminiService`는 **DB를 모른다** — usage를 `onUsage` 콜백으로 흘려보내고, DB 기록은 `cli/`가 배선한다(서비스 레이어 격리). 계측 결과 run 비용의 **65%가 `context-hunter`** 하나이고(grounding 정액 + 형식 실패 재시도), thinking은 예상(58%)보다 훨씬 작았다(실측 21.6%) — ADR-016 "실측 결과" 참조.
- **교차 산출물 검증은 스키마 팩토리다** (ADR-017): 하류 산출물의 스키마는 상류를 알 수 있다. 상류는 하류를 모른다 — 의존은 파이프라인이 흐르는 방향으로만 흐른다. `solutionSchemaFor(criticism)`·`verdictSchemaFor(criticism)`은 여전히 `ZodType<Solution>`·`ZodType<Verdict>`이므로 ADR-004의 자가 교정 루프를 그대로 탄다(에러 메시지가 곧 재시도 피드백이다). 검증을 orchestrator로 빼면 `generateStructured`가 반환한 **뒤**라 재시도가 붙지 않는다.
- **치명적 결함에는 해결책이 따른다** (ADR-017): 反이 `severity: "fatal"`로 판정한 비판은 合이 전부 해결책(`solution.remedies[]`)을 내야 하고, 판정이 그것을 항목별로 감사한다(`verdict.remedyAudits[]` — `solid`/`restated`/`dismissed`). **코드는 침묵**(재설계가 어떤 fatal에 대해 아무 말도 하지 않음)**·참조 무결성·귀속만 소유하고, 유효성 판단은 판정에 남긴다** — "이 해결책이 유효한가"는 어떤 API 응답에도 없어 주입할 사실이 존재하지 않기 때문이다(ADR-013의 유비가 절반만 적용되는 이유). 점수 하한(floor) 강제는 ADR-010 위반이라 두지 않는다.

## 데이터 흐름
```
사용자 입력(아이디어) → cli → pipeline/orchestrator
  (모든 산출물은 DB에 저장된다: artifacts(run_id, kind) — ADR-014)
  (아래 모든 gemini 호출은 재시도·실패 시도까지 각각 usage 테이블에 1행씩 기록된다 — ADR-016.
   GeminiService가 onUsage로 흘려보내고 cli/가 RunStore에 적는다. 서비스는 DB를 모른다)
  → step: interviewer     (웹 전용, gemini)                  → artifacts.kind=questions
                                                             ← artifacts.kind=answers (사용자 제출)
  → step: context-hunter                    → artifacts.kind=research → artifacts.kind=context
      ├ researchPlanner (gemini, 소스별 검색어 생성 — step 아님)
      ├ collectAll (youtube + hackernews + naver 병렬, fail-soft)
      │   └ 수집 즉시 artifacts.kind=research로 영속화 (voices[] + coverage[]) — LLM 이전의 사실
      ├ gemini grounding + urlContext (프롬프트에는 증거를 V1·V2… ID로 붙여 넣는다)
      │   └ LLM은 유의미한 목소리의 ID만 고른다 (판단은 LLM, 사실은 코드 — ADR-013)
      └ 코드 주입 → artifacts.kind=context
          ├ citations[]      : 재시도 전체에서 누적 추출 (kind: origin | redirect)
          └ communityVoices[]: 선택된 ID를 research 증거의 voices[]로 치환
  → step: thesis (正)     (gemini, context 주입)             → artifacts.kind=thesis
  → step: cold-critic (反) (gemini, context+thesis 주입)      → artifacts.kind=criticism
  → step: solution-designer (合) (gemini, context+thesis+criticism 주입) → artifacts.kind=solution
      └ remedies[]: 결함별 해결책 원장 (respondsTo=CriticismPoint.id, strategy=defend|bypass)
          └ solutionSchemaFor(criticism)이 fatal 전건 커버리지·참조 무결성을 강제 — ADR-017
            (재설계는 점수 규칙을 모른다. 알면 점수를 위해 해결책을 지어낸다)
  → step: verdict         (gemini, context+正+反+合 주입)     → artifacts.kind=verdict
      └ remedyAudits[]: 해결책 감사 (criticismId, assessment=solid|restated|dismissed)
          └ verdictSchemaFor(criticism)이 fatal 전건 감사·참조 무결성을 강제 — ADR-017
            (판정은 비판의 severity를 못 바꾼다. 상류에서 동결된다)
  → lib/report 렌더러 → artifacts.kind=report (마크다운 원문) → CLI가 완료 출력
```
- step의 진행 상태(`status`·타임스탬프·`error_message`)는 `steps` 테이블에, run 단위 메타(`idea`·`completed_at`·`updated_at`·`rerun_of`)는 `runs` 테이블에 기록된다.
- 토큰 사용량·추정 비용은 `usage` 테이블에 기록된다 — step이 아니라 **gemini 호출 단위**다. researchPlanner는 step이 아니지만 gemini를 호출하므로 usage 행을 남긴다.

## 웹 UI 데이터 흐름 (1-web-ui)
```
브라우저 → Next.js API route (web/src/app/api/*)
  읽기:  RunStore(src/lib/runStore)로 DB 읽기 → JSON 응답 (zod 스키마 재사용)
  실행:  POST /api/runs → RunStore.createRun(idea)로 runId 선(先)생성 (DB INSERT)
         → CLI를 detached child process로 spawn: npm run consult -- --resume {runId}
         → 즉시 runId 응답 (외부 API 호출은 CLI 프로세스의 services/ 안에서만 발생)
  진행:  브라우저가 GET /api/runs/{id}를 2초 폴링
         — runs·steps 테이블이 진행 상태의 단일 진실 공급원
  재개:  POST /api/runs/{id}/resume  → 동일한 spawn 패턴 (중단 지점부터, 완료 step 건너뜀)
  재실행: POST /api/runs/{id}/rerun  → 새 run으로 포크 후 동일한 spawn 패턴 (자료조사부터)
  삭제:  DELETE /api/runs/{id}       → DELETE FROM runs (CASCADE). running이면 409
```
- web은 외부 API(Gemini·YouTube·Hacker News·네이버)를 직접 호출하지 않는다. DB 읽기·쓰기와 CLI spawn만 한다.
- **API 요청마다 DB 커넥션을 열고 닫는다.** 모듈 스코프 싱글턴으로 들고 있지 마라 — Next dev 서버의 HMR이 모듈을 재평가하면서 싱글턴을 재활용하면 이미 닫힌(또는 죽은) 핸들이 남는다.
- 타입·스키마는 src/types를 단일 소스로 import한다(중복 정의 금지) — ADR-005/ADR-006.
- run 상태 파생 규칙(완료/실패/진행중/중단됨)은 PRD "run 상태 파생 규칙"을 따른다.

## 상태 관리
- DB의 `runs`·`steps` 테이블이 실행 상태의 단일 진실 공급원. `steps`가 step별 `status`(pending | waiting | completed | error)와 타임스탬프를 기록한다.
- 같은 run-id로 재실행하면 `completed`인 step은 건너뛰고 이어서 실행한다(resume). step 산출물이 존재하고 스키마 검증을 통과해야 completed로 인정한다.
- 상태 쓰기는 멱등적이어야 한다: 같은 입력으로 여러 번 실행해도 결과가 달라지지 않는다.
- **모든 쓰기는 `runs.updated_at`을 갱신한다**(ADR-014). `saveRun`은 UPDATE-only다 — 존재하지 않는(삭제된) run에 대한 쓰기는 에러이며, 좀비 프로세스가 삭제된 run을 되살릴 수 없다(ADR-015).
- 프로세스 비정상 종료는 `runs.updated_at` 휴리스틱으로 추정한다(구 state.json 파일 mtime을 대체한다). `STALLED_THRESHOLD_MS`는 **15분**이다 — step 실행 중에는 `updated_at`이 갱신되지 않는데, context-hunter가 다중 소스 수집 + grounding·urlContext 왕복으로 최악 6분까지 걸려(ADR-012) 10분으로는 정상 실행을 "중단됨"으로 오탐한다. PRD "run 상태 파생 규칙"의 숫자와 일치해야 한다.
