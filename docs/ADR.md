# Architecture Decision Records

## 철학
MVP 속도 최우선. 외부 의존성 최소화. 작동하는 최소 구현을 선택하되, 하네스 엔지니어링 패턴(순차 step + persist된 상태 + 자가 교정)을 런타임 설계의 기준으로 삼는다.
(상태의 저장 매체는 파일에서 SQLite로 바뀌었다 — ADR-014. 하네스 패턴 자체는 매체와 무관하게 유지된다 — ADR-004.)

---

### ADR-001: 실행 엔진으로 Gemini API 직접 오케스트레이션 채택
**결정**: 에이전트 실행을 `@google/genai` SDK(Gemini API)로 직접 오케스트레이션한다. claude CLI 헤드리스 방식은 채택하지 않는다.
**이유**: 독립 배포 가능한 서비스로 만들기 위해 특정 CLI 도구 설치에 의존하지 않는다. Gemini는 Google Search grounding을 내장해 별도 검색 API 없이 실시간 웹검색이 가능하다.
**트레이드오프**: GEMINI_API_KEY가 필요하고, 재시도·검증 로직을 직접 구현해야 한다.

### ADR-002: 저장은 파일 기반, DB 없음
**상태**: ADR-014로 폐기됨 (2026-07-12)
**결정**: 실행 상태와 산출물을 `runs/{run-id}/` 디렉토리의 JSON + Markdown 파일로 저장한다. SQLite/PostgreSQL은 도입하지 않는다.
**이유**: execute.py의 phases/ 상태 관리와 동일한 패턴이라 프로젝트 전체의 일관성이 유지되고, 스키마 관리·마이그레이션 부담이 없다. 산출물이 사람이 직접 읽는 파일(report.md)이므로 파일 시스템이 자연스러운 저장소다.
**트레이드오프**: 이력 조회·검색이 불편하다. 웹 UI phase에서 필요해지면 그때 DB를 도입한다.

### ADR-003: 웹검색은 Gemini grounding, YouTube는 Data API 직접 연동
**결정**: 일반 웹검색은 Gemini의 Google Search grounding 기능을 사용하고, YouTube는 YouTube Data API(v3)로 영상 검색과 댓글(commentThreads) 원문을 직접 수집한다.
**이유**: grounding은 추가 키·비용 없이 검색을 제공한다. 그러나 grounding만으로는 YouTube 댓글 원문(실제 유저 목소리 인용)을 확보할 수 없어, 리포트 품질의 핵심인 "실제 페인포인트 인용"을 위해 Data API를 병행한다.
**트레이드오프**: YOUTUBE_API_KEY 발급과 quota 관리(검색·댓글 수집 상위 N개 제한)가 필요하다. 자막(Transcript) 수집은 MVP에서 제외한다.

### ADR-004: 파이프라인 런타임에 하네스 패턴 채택
**결정**: LangGraph 등 오케스트레이션 프레임워크 대신, scripts/execute.py와 동형인 자체 하네스 패턴(순차 step 실행 + state.json persist + 컨텍스트 누적 주입 + 최대 3회 자가 교정 재시도 + resume)을 구현한다.
**이유**: 에이전트 3개의 선형 파이프라인에 그래프 프레임워크는 과잉이다. 프로젝트에 이미 검증된 동일 패턴(execute.py)이 있어 설계·디버깅 비용이 낮다.
**트레이드오프**: 분기·병렬 실행이 필요해지면 직접 확장해야 한다.

### ADR-005: TypeScript (Node) 단일 스택
**결정**: TypeScript strict mode + Node로 구현한다. 테스트는 vitest, 스키마 검증은 zod를 사용한다.
**이유**: 다음 phase의 웹 UI(Next.js)와 스택을 통일해 타입·스키마를 공유할 수 있다.
**트레이드오프**: execute.py(Python)와 언어가 갈리지만, 하네스 스크립트와 제품 코드는 역할이 분리되어 있어 문제가 없다.

### ADR-006: 웹 UI는 Next.js App Router + npm workspaces (web/)
**결정**: 웹 UI를 `web/` 디렉토리의 Next.js(App Router, TypeScript, Tailwind) 앱으로 만들고, 루트와 npm workspaces로 묶는다. zod 스키마·타입은 `src/types`를 단일 소스로 import하며 web에서 중복 정의하지 않는다.
**이유**: ADR-005에서 예고한 대로 스택을 통일해 스키마를 공유한다. 별도 레포는 타입 공유를 위해 패키지 배포가 필요해지고, 루트 전체를 Next.js 앱으로 재편하면 기존 CLI 빌드/테스트 설정을 전부 재작업해야 한다. 로컬 도구 전제이므로 배포 인프라는 고려하지 않는다.
**트레이드오프**: 루트 src의 TS 소스를 web에서 import하기 위한 컴파일 설정(tsconfig paths + Next 설정)이 필요하다.

### ADR-007: 웹의 파이프라인 실행은 createRun 선생성 + CLI detached spawn, 진행 상태는 state.json 폴링
**결정**: `POST /api/runs`는 `RunStore.createRun(idea)`(순수 파일 작업)로 runId를 먼저 만들고, CLI를 detached child process(`npm run consult -- --resume {runId}`)로 spawn한 뒤 즉시 runId를 응답한다. 진행 상태는 브라우저가 `GET /api/runs/{id}`를 2초 간격 폴링해 state.json 기반으로 표시한다. resume도 동일한 spawn 패턴이다.
**이유**: (1) runId가 CLI 내부에서 생성되므로, 웹이 먼저 createRun하고 `--resume`으로 넘기면 stdout 파싱 없이 즉시 runId를 확보한다 — orchestrator의 resume은 pending run을 처음부터 실행하므로 CLI 수정이 불필요하다. (2) detached spawn은 Next dev 서버의 hot reload와 파이프라인 실행을 격리한다. (3) state.json이 이미 실행 상태의 단일 진실 공급원(ADR-002/004)이라 폴링이 파일 기반 아키텍처와 자연스럽게 정합한다. Gemini/YouTube 호출은 여전히 CLI 프로세스의 services/ 레이어 안에서만 일어난다.
**기각한 대안**: SSE/WebSocket 스트리밍과 실시간 로그는 로그 캡처·저장 구조가 추가로 필요해 로컬 도구에는 과잉이다. in-process 실행(orchestrator 직접 import)은 dev 서버 재컴파일 시 실행이 중단될 수 있어 기각했다.
**트레이드오프**: 진행 표시가 최대 2초 지연된다. 프로세스 비정상 종료는 `updated_at` 휴리스틱(15분)으로 "중단됨"을 추정한다. (초안은 state.json 파일 mtime 10분이었다. ADR-012가 15분으로 늘렸고, ADR-014가 파일 mtime을 `runs.updated_at` 컬럼으로 대체했다. **결정 자체 — createRun 선생성 + CLI detached spawn + 폴링 — 는 유효하다.** 폴링 대상이 파일에서 DB 행으로 바뀔 뿐이다.)

### ADR-008: 리포트 서사를 결론 우선 배치에서 5단계 순차 논증으로 전환
**결정**: 결론(최종 판정)을 리포트 최하단에 배치하고 상단 요약 배너를 제거한다. 리포트는 시장 맥락 → 正 → 反 → 合 → 최종 판정 순으로 읽힌다.
**이유**: 정반합은 전개 과정 자체가 산출물이다. 결론을 먼저 노출하면 正/反 대립이 장식으로 전락한다 — 답을 이미 아는 독자에게 대립 구조는 읽을 이유가 없다.
**뒤집는 결정**: Phase 1-web-ui의 PRD·UI_GUIDE가 규정한 결론 우선 배치(상단 요약 배너 + verdict/severity 집계 선노출)를 폐기한다. 해당 UX 원칙은 이 ADR로 대체된다.
**트레이드오프**: "그래서 결론이 뭐냐"를 알려면 스크롤이 필요하다. 목차 네비의 현재 섹션 강조로 완화한다.

### ADR-009: 리스크 시각화는 외부 차트 라이브러리 없이 인라인 SVG로 구현
**결정**: RiskRadar(축별 위험도 레이더)와 SurvivalGauge(생존 점수)를 인라인 SVG로 직접 구현한다.
**이유**: ADR 철학(외부 의존성 최소화)을 따른다. UI_GUIDE의 무채색 문서 톤을 유지하려면 차트도 severity 색만 써야 한다. 3축 레이더는 좌표 계산이 단순해 라이브러리를 쓸 이유가 없다.
**기각한 대안**: recharts — 번들 크기가 늘고, 기본 테마(무지개 팔레트)가 UI_GUIDE의 "색은 데이터 의미에만 쓴다" 원칙과 충돌해 오버라이드 비용이 크다.
**트레이드오프**: 툴팁·반응형을 직접 구현해야 한다(이번 phase에서는 툴팁 제외).

### ADR-010: 최종 판정을 별도 에이전트 step으로 분리
**결정**: `solution-designer` 다음에 `verdict` step을 추가하고, 리포트의 최종 판정은 이 에이전트가 생성한다. 기존 `criticism.verdict`는 反 섹션의 소결론으로 격하한다.
**이유**: 기존 `criticism.verdict`는 反 에이전트의 산출물이라 合(피벗)을 반영하지 못한다. 이를 최종 결론으로 쓰면 "피벗을 설계해놓고 피벗 이전의 사망선고를 결론으로 내는" 논리 파탄이 생긴다. 그렇다고 合을 설계한 `solution-designer`가 스스로 채점하면 낙관 편향이 들어간다. 따라서 판정자는 제3의 에이전트여야 한다.
**트레이드오프**: Gemini 호출이 1회 늘어난다.

### ADR-011: Criticism의 3그룹 배열을 폐기하고 `points[] + axis`로 평탄화
**결정**: `painPointReality`/`bmWeakness`/`copycatRisk` 세 배열을 없애고, `axis` 필드(`painPoint` | `bm` | `copycat`)를 가진 단일 `points[]`로 바꾼다. Thesis에도 같은 축을 가진 `points[]`를 추가한다.
**이유**: 축이 배열 이름에만 존재하면 正의 주장과 反의 비판을 짝지을 수 없어 Split View가 성립하지 않는다. 배열 이름과 `axis` 필드가 공존하면 두 개의 진실이 생겨 LLM이 불일치를 만든다.
**트레이드오프**: 구 `criticism.json`·`thesis.json`은 스키마 검증에 실패한다. `RunStore.loadStepOutput`이 검증 실패 시 `null`을 반환하므로 완료된 구버전 run은 리포트 뷰에서 빈 상태가 되고 `report.md` 다운로드로 대체한다. 미완료 run은 resume 시 해당 step이 재실행되어 마이그레이션된다.

### ADR-012: 자료조사를 다중 소스로 확장하고 grounding 인용을 코드로 추출
**결정**: 유저 목소리 수집을 YouTube 단일 소스에서 **YouTube + Hacker News + 네이버 검색** 3소스로 확장한다.
소스별 원시 타입은 `src/services/`에 유지하되 얇은 어댑터로 공통 `CommunityVoice`로 정규화하고, `src/research/`에서 `Promise.allSettled`로 **병렬 수집**한다.
웹검색은 계속 Gemini grounding을 쓰되, `groundingMetadata.groundingChunks`에서 **코드가 인용을 추출해 `MarketContext.citations[]`에 담는다**.
`urlContext` 툴을 `googleSearch`와 병용해 경쟁사 공식 페이지를 직접 읽는다.
소스별 검색어는 `researchPlanner`가 생성한다 — 파이프라인 step이 아니라 `context-hunter` 내부 호출이다.

**뒤집는 결정**: ADR-003의 "웹검색은 grounding, 유저 목소리는 YouTube Data API"라는 범위를 갱신한다. grounding을 웹검색 엔진으로 쓴다는 결정 자체는 유지하되, **그 결과를 LLM의 자기보고로만 받던 방식은 폐기한다.** YouTube가 유일한 유저 목소리 소스라는 전제도 폐기한다. ADR-003의 "자막(Transcript) 수집 제외"는 그대로 유효하다.

**이유**:
- `sources[]`는 LLM이 자기 기억으로 적어낸 URL이라 환각을 검증할 장치가 없었다. `groundingMetadata`는 SDK가 이미 응답에 실어 보내는데 코드(`gemini.ts`)가 `response.text`만 읽고 버리고 있었다.
- **`groundingChunks[].web.uri`는 원 사이트 URL이 아니라 `vertexaisearch.cloud.google.com/grounding-api-redirect/...` 형태의 만료되는 리다이렉트 URL**이다. 그래서 `citations[]`가 `sources[]`를 대체하지 않고 **공존**한다 — 두 필드의 실패 모드가 상보적이기 때문이다(자기보고는 부정확하지만 만료되지 않고, 인용은 정확하지만 만료된다). 하나로 합치면 "grounding이 아무것도 돌려주지 않았다"는 사실이 자기보고에 가려져 보이지 않게 된다.
- YouTube 댓글만으로는 한국 커뮤니티(카페·지식iN)의 생활 언어와 영어권 빌더 담론(HN)을 둘 다 놓친다.
- 소스별 타입을 산출물 스키마까지 끌고 가면 스키마 3개 × 프롬프트 JSON 예시 3블록 × 렌더러 3개 × 웹 카드 3개로 비용이 곱해진다. 특히 **grounding 모드는 `responseSchema`를 쓸 수 없어 프롬프트의 JSON 예시가 유일한 형식 지시**이므로, 예시 블록이 3배가 되는 것은 형식 실패율 3배의 리스크다. 따라서 `{source, title, url, text, authorName?, score?, extra?}` 하나로 정규화한다.

**기각한 대안**: 플러그인 레지스트리(동적 소스 등록). 소스는 정확히 3개이고 전부 컴파일 타임에 알려져 있으며 생성 지점이 `src/cli/index.ts` 한 곳이다 — `readonly ResearchSource[]` 배열 자체가 레지스트리다. 쿼리 생성을 별도 pipeline step으로 분리하는 안도 기각했다. resume 이득이 거의 없는데(non-grounding 구조화 호출, 2~4초) `PIPELINE_STEPS`·`STEP_OUTPUT_FILES`·웹 진행 뷰까지 파급되고, 사용자에게 노출되는 "변증법 단계" 언어를 구현 디테일로 오염시킨다.

**트레이드오프**: `NAVER_CLIENT_ID`/`NAVER_CLIENT_SECRET` 발급이 필요하다(무료, 일 25,000회). Gemini 호출이 run당 1회 늘어난다(researchPlanner). `urlContext` 병용으로 grounding 호출 지연이 늘어 타임아웃을 180초로 올리고 재시도를 2회로 줄인다(최악 6분으로 기존과 동일). 그만큼 context-hunter가 길어지므로 ADR-007의 "중단됨" mtime 휴리스틱을 **10분에서 15분으로 올린다**(`STALLED_THRESHOLD_MS`) — 10분은 정상 실행을 중단됨으로 오탐한다. HN은 영어권이라 한국어 쿼리로는 조용히 0건이 되므로, planner의 영어 쿼리 생성이 필수 전제다.

**하위호환**: `MarketContext.youtubeVoices`를 `communityVoices`로 대체하되, `z.preprocess`로 구 `context.json`의 `youtubeVoices[]`를 `communityVoices[]`(`source: "youtube"`)로 **승격**한다. ADR-011과 달리 구 run을 빈 리포트로 만들지 않는다 — MarketContext에 대해서는 더 나은 하위호환을 택했다. `.default([])`만으로는 zod의 `strip` 정책 때문에 구 데이터가 조용히 소멸하므로 부족하다.

### ADR-013: 출처를 판단이 아니라 사실로 만든다 — 코드 주입 인용과 링크 박탈
**결정**: 리포트에서 **클릭 가능한 링크로 렌더되는 URL은 코드가 API 응답에서 주입한 것뿐**이라는 불변식을 세운다. 네 가지를 바꾼다.

1. **`communityVoices[]`를 코드 주입 필드로 전환한다.** `collectAll()`의 수집 결과를 먼저 `runs/{id}/research.json`(`ResearchEvidence` — `voices[]` + 소스별 `coverage[]`)으로 영속화하고, 프롬프트에는 증거를 ID(`V1`, `V2`…)와 함께 넣는다. LLM은 **어느 목소리가 유의미한가를 ID로만 선택**하고, 코드가 그 ID를 `research.json`의 실제 `CommunityVoice` 객체로 치환해 `context.json`에 쓴다. `CODE_INJECTED_CONTEXT_KEYS`에 `communityVoices`가 추가되며, `context.json`의 `communityVoices`는 `research.json` `voices[]`의 **부분집합**임이 구조적으로 보장된다.
2. **재시도 간 grounding 메타데이터를 누적한다.** `generateValidated`가 검증에 성공한 시도의 response만 반환하고 실패한 시도의 `groundingMetadata`를 버리는 현행 동작을 뒤집는다. 재시도 루프 전체에서 인용을 uri 기준으로 dedupe하며 누적하고, 최종 결과에 함께 돌려준다.
3. **검증되지 않은 URL의 링크를 박탈한다.** `sources[]`·`competitors[].url`은 LLM 자기보고이므로 텍스트로만 표시하고 `href`를 걸지 않는다(`report.md`·웹 리포트 모두). 클릭 가능한 링크는 `citations[]`와 `communityVoices[]`뿐이다.
4. **`CitationSchema`에 `kind` 판별자를 추가한다.** `"origin"`(`urlContextMetadata.retrievedUrl` — urlContext가 실제로 읽어낸 원본 URL) | `"redirect"`(`groundingChunks[].web.uri` — 만료되는 vertexaisearch 리다이렉트).

**뒤집는 결정**: ADR-012는 "`citations[]`와 `sources[]`는 실패 모드가 상보적이므로 **공존**한다"고 했다. **공존 자체는 유지한다** — 자기보고는 부정확하지만 만료되지 않고, 인용은 정확하지만 만료된다는 논거는 그대로 유효하다. 뒤집는 것은 두 필드를 **동등한 신뢰도로 렌더링해온 것**이다. 상보성은 두 필드가 **둘 다 채워질 때만** 성립하는데, 실전에서 `citations`가 8/8 run 전부 비면서 공존이 아니라 *환각 필드만 살아남는 구조*가 됐다. 따라서 (a) citations를 실제로 채우고(결정 2), (b) 자기보고 필드의 링크를 박탈해(결정 3) 둘의 신뢰도 차이를 렌더링에서 드러낸다.
ADR-012의 "인용은 LLM이 아니라 코드가 추출한다"는 원칙은 폐기가 아니라 **인용문으로 확장**된다(결정 1) — `communityVoices`가 "LLM이 선별한 목소리"라던 ADR-012의 서술은 "LLM이 **ID로** 선별하고 코드가 실체를 채운다"로 갱신된다. 아울러 `src/services/gemini.test.ts`가 *의도된 동작*으로 못박은 "형식 실패한 시도의 groundingMetadata는 함께 버린다"는 계약을 폐기한다(결정 2).

**이유**: 실제 산출물 8개 run을 전수조사하고 URL을 라이브 HTTP 검증한 결과 — `citations[]` **8/8 run 0건**, 네이버 인용 **0건**, 경쟁사 URL 89개 중 **53개(60%) 도달 불가**. 반면 YouTube 영상 ID는 10/10 실존이다. 즉 **수집 계층은 멀쩡하고, 망가지는 지점은 LLM이 증거를 "다시 받아적는" 구간뿐이다.** 그 구간을 없앤다.
- **citations가 항상 비는 원인은 재시도 폐기다.** grounding 모드는 `responseSchema`를 못 써 자유 텍스트 → `extractJsonText` → zod 검증 경로라 1차 시도의 형식 실패가 잦은데, 재시도 프롬프트는 `[교정 요청]`이라 모델이 **새 검색을 하지 않는다**. 따라서 채택되는 최종 response에는 `groundingMetadata`가 아예 없다. 폐기의 명분(검증된 본문과 인용의 대응 유지)보다, 그 결과로 **인용이 0건이 되어 환각 필드만 살아남는 실패**가 압도적으로 나쁘다. `citations[]`는 문장별 각주가 아니라 "grounding이 이 run에서 실제로 무엇을 가져왔는가"의 **run 단위 기록**이므로, 누적이 오히려 더 정직한 정의다.
- **LLM은 코드가 준 URL조차 다시 타이핑하면 망가뜨린다.** 스모킹건 — 실제 산출물에 `https://vertexaisearch.cloud.google.google.com/grounding-api-redirect/AUZIYQEe... [4] 10 Best AI Meeting Assistants…`가 저장돼 있다. 도메인에 `.google`이 중복됐고(같은 파일의 나머지 29개는 정상) URL·각주번호·제목이 한 문자열로 뭉개졌다. **코드가 API 응답에서 주입한 URL은 오타가 날 수 없다.** LLM의 판단(어느 목소리가 유의미한가)은 남기되, 사실(그 목소리의 원문·출처·작성자)은 코드가 소유한다 — `citations`에 이미 적용된 원칙("LLM에게 인용을 채우라고 하면 URL을 지어낸다", `marketContext.ts`)을 인용문에도 적용하는 것뿐이다.
- **링크 박탈의 근거는 사망률 60%다.** 사용자가 링크를 클릭한다는 것은 그 URL이 검증됐다고 믿는다는 뜻이다. 형식만 맞는 URL에 `href`를 거는 것은 거짓 신호다. 텍스트로 남기는 편이 정직하다 — 독자는 이름으로 직접 검색할 수 있다.
- **`kind`가 없으면 가장 강한 인용과 반드시 깨질 인용을 구분할 수 없다.** urlContext가 실제로 읽어낸 원본 URL과 만료되는 리다이렉트가 한 배열에 섞여 있어, 렌더러가 신뢰도 차이를 표현할 수도 만료를 고지할 수도 없다.

**기각한 대안**:
- **`sources[]`를 스키마에서 제거** — ADR-012의 상보성 논거가 여전히 유효하다. 자기보고는 부정확하지만 만료되지 않고, citations가 0건일 때 "grounding이 아무것도 못 가져왔다"는 사실을 가리지 않고 병렬로 남는다. 제거가 아니라 **링크 박탈**이 이번 결정이다.
- **저장 시점에 URL을 HTTP로 라이브 검증해 죽은 링크를 거르기** — 89개 왕복이 context-hunter에 얹히고, 네트워크 상태에 따라 산출물이 달라져 상태 파일 쓰기의 멱등성(ARCHITECTURE "상태 관리")이 깨진다. 게다가 도메인은 살아 있고 경로만 틀린 환각 URL은 통과하므로 거짓 신호를 오히려 강화한다.
- **"URL을 그대로 복사하라"고 프롬프트로 지시** — 이미 그렇게 하고 있고, 스모킹건이 그 실패다. 프롬프트로는 사실을 지킬 수 없다.

**트레이드오프**: LLM이 수집 증거에 없는 목소리를 인용하고 싶어도 못 한다 — **그것이 목적이다.** 전 소스가 실패하면 `communityVoices`는 빈 배열이 되고 리포트는 근거 부재를 그대로 드러낸다. `sources[]`가 링크가 아니게 되어 독자가 URL을 직접 복사해야 한다. 재시도 시 누적된 citations는 최종 채택 본문에 대응하지 않는 인용(폐기된 시도의 검색 결과)을 포함할 수 있다 — `citations[]`를 run 단위 기록으로 재정의해 이를 수용한다. `research.json`이 늘어 run 디렉토리가 커지고 `context.json`과 일부 중복되지만, 수집물과 선별물의 차이 자체가 관측 대상이다.

**하위호환**: 구 `context.json`은 계속 유효하다. `communityVoices[]`는 **필드 모양이 바뀌지 않는다** — 바뀌는 것은 *누가 채우는가*이지 스키마가 아니다(ADR-012의 `youtubeVoices` 승격도 그대로 유지된다). `kind`가 없는 구 인용은 `"redirect"`로 승격한다(만료 가능 쪽이 보수적 기본값이다 — 실측상 구 run의 citations는 전부 0건이라 대상이 사실상 없다). `research.json`이 없는 구 run은 수집 커버리지 표시만 비고 나머지 리포트는 그대로 렌더된다. ADR-011과 달리 구 run을 빈 리포트로 만들지 않는다.

### ADR-014: 저장소를 SQLite로 전환한다 (ADR-002를 폐기)
**결정**: 실행 상태·에이전트 산출물·리포트를 `runs/{run-id}/` 파일이 아니라 SQLite DB(`data/anvil.db`) 한 파일에 저장한다. 구현체는 Node 내장 `node:sqlite`의 `DatabaseSync`다. **새 npm 의존성을 추가하지 않는다.**

테이블은 3개다:

```
runs(run_id PK, idea, created_at, updated_at, completed_at NULL,
     interview INTEGER, rerun_of NULL REFERENCES runs(run_id) ON DELETE SET NULL)
steps(run_id REFERENCES runs ON DELETE CASCADE, name, ordinal, status,
      started_at, completed_at, failed_at, error_message, PRIMARY KEY(run_id, name))
artifacts(run_id REFERENCES runs ON DELETE CASCADE, kind, content TEXT, updated_at,
          PRIMARY KEY(run_id, kind))
```

`artifacts.kind` ∈ `questions | answers | research | context | thesis | criticism | solution | verdict | report`.

핵심 규칙 3가지:

- **에이전트 산출물을 컬럼으로 정규화하지 않는다.** `artifacts.content`는 JSON 직렬화 문자열이고(`kind='report'`만 마크다운 원문), 검증 권위는 계속 zod다. 에이전트 스키마는 자주 바뀐다(ADR-011의 criticism 평탄화, ADR-013의 citations·communityVoices 코드 주입). 정규화하면 스키마 변경마다 SQL 마이그레이션이 따라붙고, zod와 DDL 두 곳에 스키마가 중복된다. **DB는 바이트를 보관하고, 의미는 zod가 소유한다.**
- **`saveRun`은 UPDATE-only다.** INSERT는 `createRun`/`createRerun`만 한다. 존재하지 않는 run에 `saveRun`이 호출되면 에러다. 삭제된 run을 아직 살아 있는 detached CLI 프로세스가 다시 INSERT해 되살리는 것을 구조적으로 막는다(ADR-015).
- **모든 쓰기는 `runs.updated_at`을 갱신한다.** 이 값이 `stalled` 판정의 유일한 근거이며, 기존 `state.json` 파일 mtime을 대체한다.

연결 시 반드시 설정할 PRAGMA:

| PRAGMA | 값 | 이유 |
|---|---|---|
| `journal_mode` | `WAL` | CLI 프로세스의 쓰기와 Next 서버의 읽기가 동시에 일어난다(ADR-007). WAL이 "쓰는 프로세스 1 + 읽는 프로세스 N"을 정확히 해결한다 |
| `busy_timeout` | `5000` | 잠금 경합 시 즉시 실패하지 않고 대기한다 |
| `foreign_keys` | `ON` | **꺼져 있으면 CASCADE 삭제가 조용히 동작하지 않는다.** SQLite의 기본값은 OFF다 |

**뒤집는 결정**: ADR-002("저장은 파일 기반, DB 없음")를 폐기한다. ADR-002가 예고한 "웹 UI phase에서 필요해지면 그때 DB를 도입한다"의 그 시점이다 — 삭제(run 삭제 기능이 코드베이스에 아예 없다)·재실행(완료 run을 같은 입력으로 처음부터 다시 돌리는 경로가 없다)·상태 판정의 정직성(프로세스 생존을 파일시스템 메타데이터로 짐작한다) 셋이 동시에 필요해졌다.
다만 **ADR-004(하네스 패턴 런타임)는 그대로 유지된다** — step이 순차 실행되고, 산출물이 persist되며, 실패 시 최대 3회 자가 교정하고, completed step을 건너뛰는 resume이 성립한다는 런타임 설계는 저장 매체와 무관하다. **바뀌는 것은 persist의 매체뿐이다.**

**기각한 대안**:
- *PostgreSQL* — 로컬 단일 사용자 도구에 데몬 프로세스와 접속 설정을 요구한다. 순수 비용이다.
- *better-sqlite3* — 성숙하고 실험적 경고가 없지만 네이티브 바이너리라 설치 시 컴파일 리스크가 있고 Next.js에 `serverExternalPackages` 설정이 필요하다. 내장 모듈은 번들러가 자동으로 externalize한다. 현재 런타임 deps가 `@google/genai`·`dotenv`·`zod` 3개뿐인 이 프로젝트의 "외부 의존성 최소화"(ADR 서문)에는 의존성 0개가 더 맞는다.
- *Drizzle/Prisma 같은 ORM* — 테이블이 3개인데 마이그레이션 도구 체계가 통째로 들어온다. 이미 zod가 검증을 소유하고 있어 스키마가 두 곳으로 갈라진다.
- *파일은 두고 인덱스 DB만 추가* — 진실 공급원이 둘이 되어 삭제·재실행에서 반드시 어긋난다.

**트레이드오프**: `node:sqlite`는 Node 24에서 실험적(experimental)이라 실행 시 `ExperimentalWarning`이 출력된다. node를 띄우는 npm 스크립트에 `NODE_OPTIONS=--disable-warning=ExperimentalWarning`을 붙여 억제한다(Node v24.14.1에서 동작 확인). 또한 산출물이 더 이상 사람이 직접 열어보는 파일이 아니다 — 대신 웹 UI와 `report.md` 다운로드가 그 역할을 한다.

**하위호환**: 기존 `runs/*/`는 일회성 스크립트(`npm run migrate:runs`)로 DB에 이송한다. 원본 디렉토리는 지우지 않는다. 스키마 검증에 실패하는 구 run(ADR-011의 평탄화 이전 criticism 등)도 **원문 그대로 이송한다 — 마이그레이션은 검증기가 아니라 이송기다.** 읽기 시점에 zod가 실패하면 지금처럼 `null`이 되어 UI가 빈 상태를 보여준다.

### ADR-015: 삭제는 CASCADE, 재실행은 포크
**결정**:
- **삭제** — `DELETE FROM runs WHERE run_id = ?` 한 줄이 FK CASCADE로 steps·artifacts를 함께 지운다. 단 **`running` 상태인 run은 삭제할 수 없다**(409). 아직 살아 있는 CLI 프로세스가 쓰기를 계속하기 때문이다. `waiting`·`completed`·`error`·`stalled`는 삭제할 수 있다.
- **재실행(rerun) = 새 run으로 포크** — 원본을 덮어쓰지 않는다. 원본의 `idea`·인터뷰 `questions`·`answers`만 복사해 새 `run_id`를 만들고, `research`·`context`·`thesis`·`criticism`·`solution`·`verdict`·`report`는 **복사하지 않는다**. 즉 자료조사부터 전부 새로 돈다. 계보는 `runs.rerun_of` 컬럼에 남긴다.

**이유**:
- 포크는 원본 리포트를 보존한다. 재실행이 실패해도 멀쩡했던 결과를 잃지 않는다.
- 이미 있는 `/compare` 화면으로 **"이전 결과 vs 새 결과"** 비교가 공짜로 성립한다. 같은 입력으로 두 번 돌렸을 때 결론이 얼마나 흔들리는지가 곧 이 도구의 신뢰도이므로, 그 비교는 부산물이 아니라 기능이다.
- 덮어쓰기는 되돌릴 수 없다. 파괴적 동작은 사용자가 명시적으로 요청한 삭제 하나로 충분하다.

**`stalled` run 삭제의 잔여 위험과 그 처리**: `stalled`는 "프로세스가 죽었다고 **추정**"하는 상태다(`runs.updated_at`이 15분 넘게 갱신되지 않았다). 실제로는 살아 있는 좀비 프로세스가 나중에 쓰기를 시도할 수 있다. 그래서 **`saveRun`을 UPDATE-only로 만든다**(ADR-014) — 삭제된 run에 대한 쓰기는 0 rows 갱신으로 에러가 되고, 좀비는 되살아나지 못한 채 죽는다. 삭제의 안전성이 애플리케이션의 조심성이 아니라 **저장 계층의 불변식**으로 보장된다.

**resume과 rerun은 다른 버튼이다**: resume은 **중단 지점부터**(완료 step 건너뜀, error·stalled에서), rerun은 **자료조사부터**(전부 새로, completed에서). UI에서 둘을 같은 버튼으로 합치지 않는다(UI_GUIDE "재실행 버튼").

**기각한 대안**:
- *기존 run 덮어쓰기(in-place reset)* — 이력이 늘지 않는 대신 이전 결과가 사라지고 비교가 불가능하다.
- *`research`를 재사용해 LLM만 다시 돌리기* — 사용자의 요구는 "**다시 자료조사**와 결과값"이다. 자료조사 결과가 고정되면 재실행의 의미가 절반이 된다.

**트레이드오프**: 재실행할 때마다 run이 하나씩 늘어나고 외부 API 쿼터를 다시 쓴다. 삭제 기능이 함께 들어가므로 이력 증가는 사용자가 정리할 수 있다.

**하위호환**: `runs.rerun_of`는 nullable이다 — 이송된 구 run과 새로 만든 run은 `NULL`이고, 계보 표시가 없을 뿐 나머지 동작은 동일하다. 원본이 삭제되면 `ON DELETE SET NULL`로 파생 run의 `rerun_of`만 끊긴다(파생 run은 살아남는다).

### ADR-016: 비용을 관측 가능하게 만들고 thinking에 상한을 둔다
**결정**: Gemini 비용을 **측정한 뒤에** 줄인다. 네 가지를 정한다.

**1. usage는 `artifacts`가 아니라 새 `usage` 테이블에 넣는다.** 도메인 테이블 3개 옆에 **관측 테이블 1개**가 붙는다.

```sql
CREATE TABLE IF NOT EXISTS usage (
  run_id          TEXT NOT NULL REFERENCES runs(run_id) ON DELETE CASCADE,
  label           TEXT NOT NULL,             -- 에이전트 이름 (thesis, cold-critic, …)
  model           TEXT NOT NULL,
  grounded        INTEGER NOT NULL,          -- 0|1. 토큰과 별개로 요청당 정액 과금된다
  attempt         INTEGER NOT NULL,          -- 1부터. 재시도한 시도도 과금되므로 행이 여러 개다
  prompt_tokens   INTEGER NOT NULL,
  cached_tokens   INTEGER NOT NULL,          -- prompt_tokens에 이미 포함된 값이다 (중복 아님)
  output_tokens   INTEGER NOT NULL,
  thoughts_tokens INTEGER NOT NULL,          -- thinking. 출력 요금으로 과금된다 (ADR-016)
  total_tokens    INTEGER NOT NULL,
  cost_usd        REAL NOT NULL,             -- 추정치다. 청구서가 아니다
  created_at      TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_usage_run_id ON usage(run_id);
```

**위 DDL은 `src/lib/db.ts`의 실제 DDL이다.** 이 ADR의 초안은 컬럼을 `agent`/`ok`/`input_tokens`/`thinking_tokens`로, PK를 `id INTEGER PRIMARY KEY AUTOINCREMENT`로 적었으나, 구현이 다음 세 가지를 바꿨다 — 문서를 코드에 맞춘다:
- **컬럼명은 `src/lib/cost.ts`의 `CallUsage`와 1:1로 대응시킨다** (`label`·`prompt_tokens`·`thoughts_tokens`). 관측치가 서비스 → 콜백 → DB로 이름을 바꾸지 않고 흐른다. `label` 값은 kebab-case 파이프라인 step 이름(`context-hunter`, `cold-critic`, …)이라 `steps` 테이블과 나란히 조회된다. grounded 정액 요금을 계산하려면 행마다 `grounded`가 필요하다.
- **`ok` 컬럼은 두지 않는다.** 실패한 시도를 기록한다는 **결정 2는 그대로 유효하다** — 다만 그것을 표현하는 데 컬럼이 필요 없다. 시도는 attempt 1부터 순서대로 쌓이고, 마지막 행이 아닌 모든 행이 실패한 시도다. 재시도 여부는 `COUNT(*) - COUNT(DISTINCT label)`로 나온다(`retryCalls`).
- **PK를 두지 않는다.** 초안은 자연키 충돌을 피하려 대리키(`id`)를 붙였는데, 애초에 이 테이블에 PK가 필요한 질의가 없다 — usage 행은 개별로 지목·갱신되지 않고 오직 집계(SUM·GROUP BY)될 뿐이다. **행을 식별할 이유가 없으면 식별자도 필요 없다.** 아래 논거(자연키를 쓰면 안 되는 이유)는 그대로 유효하다.

`artifacts`는 "에이전트 산출물"을 의미하며 PK가 `(run_id, kind)`다(ADR-014). usage는 산출물이 아니라 **관측 데이터**이고, 재시도 때문에 **한 step에 여러 행**이 생긴다. `kind='usage'`로 우겨넣으면 PK 제약과 의미론이 동시에 깨진다.

PK를 `(run_id, label, attempt)`로 두지 않는 이유: **resume하면 실패했던 step이 처음부터 다시 실행되어 `attempt`가 1부터 재시작한다.** 자연키로 묶으면 그 순간 PK 충돌이 나고, 충돌을 UPSERT로 무마하면 **이미 청구된 이전 시도의 기록이 덮어써져 사라진다.** usage는 상태가 아니라 **추가만 되는 사건 로그**다.

ADR-014의 "DB는 바이트를 보관하고 의미는 zod가 소유한다"는 **에이전트 산출물**에 대한 규칙이다. 그 규칙의 근거는 "에이전트 스키마가 자주 바뀐다"(ADR-011의 criticism 평탄화, ADR-013의 코드 주입)인데, usage는 Gemini의 `usageMetadata`가 정하는 **고정된 숫자 관측치**다. 자주 바뀌지 않고, 집계(SUM·GROUP BY)가 존재 이유다. 따라서 컬럼으로 정규화하는 것이 옳다 — 이것은 **ADR-014의 예외가 아니라 적용 범위 밖이다.**

**2. 실패한 시도의 usage도 반드시 기록한다** (검증에 실패한 시도도 자기 행을 갖는다 — 위 DDL 주석 참조).
검증에 실패한 응답도 과금된다. ADR-013이 "**형식이 실패한 것이지 검색이 실패한 게 아니다**"라며 실패한 시도의 grounding 인용을 살린 것과 정확히 같은 논리다: **형식이 실패한 것이지 청구가 실패한 게 아니다.** 성공한 시도만 세면 재시도 비용이 장부에서 통째로 사라지는데, 재시도야말로 프롬프트 전문을 다시 전송하는 **가장 비싼 경로**다. 실패한 시도를 못 세면 "재시도를 줄이는 것이 이득인가"라는 질문에 영영 답할 수 없다.

**3. `GeminiService`는 DB를 모른다.** usage는 `onUsage` 콜백으로 **밖으로 흘려보내고**, DB 기록은 `cli/`가 배선한다.
CLAUDE.md의 CRITICAL 규칙과 ARCHITECTURE의 "서비스 레이어 격리" 때문이다 — `services/`는 외부 API 래퍼이고 저장소를 모른다. `GeminiService`가 `RunStore`를 import하면 계층 규칙이 무너지고, 테스트에서 Gemini를 mock할 때 DB가 함께 딸려온다(현재 agents 테스트 7개가 전부 DB 없이 돈다). 콜백이면 서비스는 "얼마 썼다"를 알리기만 하고, 그것을 어디에 적을지는 배선하는 쪽이 정한다.

**4. thinking은 끄지 않고 상한을 둔다.** 에이전트별 `thinkingBudget`:

아래 표는 **구현된 최종 값**이다(`src/agents/*.ts`의 `*_THINKING_BUDGET` 상수). 초안의 값에서 세 줄이 실측으로 바뀌었다 — 바뀐 줄에 근거를 적는다.

| 에이전트 | budget | 이유 |
|---|---|---|
| `researchPlanner` | **0** | 아이디어 → 소스별 검색어. 기계적 변환이다 |
| `interviewer` | **0** | 아이디어 → 질문 목록. 기계적 변환이다 |
| `contextHunter` | **8192** | *초안 2048 → 8192.* 4096에서 **상한에 붙었고**(4,279토큰) 그 run에서 YouTube 목소리 15건 중 **0건 선별**·**citations 0건**이 나왔다 — ADR-013의 핵심 불변식이 깨졌다. 8192는 이 모델의 dynamic thinking 최대치라 **평시에 물리지 않는 안전망**이지 throttle이 아니다 |
| `thesis` | 2048 | 표적을 세우는 역할(PRD) — 反만큼의 깊이는 필요 없다 |
| `coldCritic` | 4096 | 비판의 깊이가 이 도구의 존재 이유다 |
| `solutionDesigner` | **2048** | *초안 4096 → 2048.* 실측 사용량이 1,462~1,670토큰으로 4096에 한참 못 미쳐 상한이 아무것도 막지 않았다. 合 4개 서브섹션이 전부 유지됨을 확인하고 내렸다 |
| `verdict` | **2048** | *초안 4096 → 2048.* 실측 사용량 1,538~1,746토큰. 판정 점수·residualRisks·conditions 개수가 유지됨을 확인하고 내렸다 |

전부 0으로 끄지 않는 이유: coldCritic의 비판 깊이와 verdict의 판정 품질이 **이 도구의 존재 이유**다. ADR-010이 "合을 설계한 에이전트가 스스로 채점하면 낙관 편향이 들어간다"며 판정자를 제3의 에이전트로 분리한 것도 오직 판정 품질 때문이었다. 비용을 아끼자고 그 판정을 생각 없이 내리게 만들면, 아낀 돈보다 잃는 것이 크다. 없애는 것은 **무제한 dynamic thinking**이지 사고 자체가 아니다.

**`thinkingBudget`은 하드 상한이 아니라 목표치다.** 실측에서 contextHunter가 budget 8192에 대해 **8,925토큰**을 쓴 run이 있다. 모델이 초과할 수 있으므로 budget으로 비용의 천장을 보장할 수는 없다 — 기대값을 낮출 뿐이다.

**이유**: Gemini 비용이 예상보다 높은데 **코드에 `usageMetadata`를 읽는 줄이 하나도 없다**(레포 전체 grep 0건). 비용이 어디서 나는지 알 수단이 지금 존재하지 않는다. 코드와 `data/anvil.db`(run 9개)를 실측해 확인한 것:

- `src/services/gemini.ts`의 두 `baseConfig`(`:269-273` structured, `:298` grounded) **어디에도 `thinkingConfig`가 없다.** `gemini-2.5-flash`는 **동적 thinking이 기본 ON**(콜당 최대 8,192 토큰)이고 **thinking 토큰은 출력 요금($2.50/1M)으로 과금된다.** 즉 가장 비싼 토큰이 제어도 계측도 없이 흐르고 있다.
- `context` 아티팩트 하나(실측 52,824자)가 하류 4개 콜에 **바이트 동일하게 재전송**된다(`thesis.ts:59-62`, `coldCritic.ts:85-87`, `solutionDesigner.ts:71-74`, `verdict.ts:88-92`) — 하류 프롬프트 입력의 **71%**다. 그 `context`의 **73.5%가 `communityVoices`(39.8%) + `sources`(33.7%)**이고, 그중 `sources`(LLM 자기보고 URL 문자열, 4,449자)는 **正·反·合·판정 어느 에이전트도 논증에 쓰지 않는다.** 하류 프롬프트는 `JSON.stringify(x, null, 2)`라 **들여쓰기 공백까지 과금**된다.
- YouTube 댓글에 **길이 상한이 없다**(`youtube.ts:146-151`). HN은 1,200자 컷이 있다(`hackerNews.ts:18`). 즉 파이프라인 최대 프롬프트의 **상한이 열려 있다.**

추정 비용 구조는 run당 **thinking ~58% / 출력 JSON ~17% / grounding ~15% / 입력 ~8%**다. **이 숫자들은 코드 실측이 아니라 추정이며, 이 phase의 계측이 붙어야 확정된다.** ADR에 굳이 적는 이유는 순서를 정당화하기 위해서다 — 통상 비용 최적화의 1순위로 꼽히는 **컨텍스트 캐싱은 저 8% 슬라이스만 건드린다.** 돈은 thinking에 있다. 그래서 이 phase의 순서는 **계측 → thinking 상한 → 페이로드 다이어트**이며, 계측이 맨 앞에 오는 이유는 **저 추정이 틀렸을 경우 뒤의 두 순서가 바뀌어야 하기 때문**이다.

> ⚠️ **위 추정은 틀렸다.** 계측 결과 thinking은 58%가 아니라 **21.6%**였고, 최대 지출은 thinking이 아니라 **grounding 정액 요금(39.3%)** 이었다. 정정된 수치는 아래 **"실측 결과"** 절에 있다 — 그 절의 숫자를 근거로 삼아라. 이 문단은 *결정 당시의 추측*으로만 남긴다. (계측을 맨 앞에 둔 판단 자체는 옳았다. 추정이 틀렸음을 계측이 잡아냈기 때문이다.)

**기각한 대안**:
- **컨텍스트 캐싱(explicit `caches.create`) 도입** — 입력 토큰은 전체 비용의 8%뿐이라 최선의 경우에도 절감폭이 작다. 게다가 explicit 캐시는 **저장 요금($1.00/1M 토큰/시간)이 따로 붙는데** run 하나가 수 분이면 캐시 수명이 짧아, 절감액이 캐시 생성·만료 관리 비용을 넘지 못한다. 8% 슬라이스를 최적화하려고 새 실패 지점(만료된 캐시 핸들)을 들이는 거래다.
- **implicit 캐싱을 노린 프롬프트 재배치** — Gemini 2.5는 implicit 캐싱이 기본 ON이고 공통 프리픽스가 2,048토큰을 넘으면 히트한다. 공통 `context`를 프롬프트 앞머리로 옮기면 히트율이 오를 **것 같다.** 그러나 (a) 절감 대상이 여전히 8% 슬라이스이고, (b) exact-prefix 매칭이 에이전트마다 다른 `systemInstruction` 때문에 깨지는지 **알 수 없다.** **계측이 붙으면 `cachedContentTokenCount`가 이 질문에 직접 답한다** — 그래서 `usage.cached_tokens`가 컬럼으로 있다. 추측으로 프롬프트를 재배치하지 말고, 데이터를 보고 다음 phase에서 결정한다. **이 phase의 계측은 그 데이터를 얻기 위한 것이기도 하다.** 이것이 이 ADR의 요지다: *측정하지 않고 최적화하지 않는다.*
  > **답이 나왔다 (아래 "실측 결과" 참조): 하류 4개 에이전트의 `cached_tokens`는 20콜 207,139 입력토큰에 걸쳐 전부 0이다.** (b)의 우려가 사실로 확인됐다 — 공통 `context`를 4번 재전송하지만 `systemInstruction`과 프롬프트 도입부가 에이전트마다 달라 **공통 프리픽스가 성립하지 않는다.** 캐시가 히트한 유일한 지점은 `contextHunter`(같은 프롬프트를 그대로 다시 보내는 **재시도**, 그리고 같은 아이디어를 다시 돌린 run 사이)였다. 즉 implicit 캐싱 기능 자체는 살아서 동작하고 있고, **우리 프롬프트가 그 조건을 못 맞추고 있을 뿐이다.**
- **모델을 `gemini-2.5-flash-lite`로 내리기** — 출력 단가가 6배 싸다(=$0.40/1M). 그러나 품질 회귀의 범위를 **지금은 알 수 없다.** thinking 상한만으로 목표에 도달하는지 먼저 본다. 계측이 붙으면 **에이전트별** 비용이 보이므로, 그때 "researchPlanner만 lite로" 같은 판단이 **근거를 갖고** 가능해진다. 그래서 `usage.model`이 행마다 저장된다 — 에이전트별로 모델이 갈라져도 장부가 성립한다.
- **Batch API(50% 할인)** — 파이프라인은 대화형이고 step이 순차 의존한다(ADR-004). 배치의 지연(수 시간)은 "아이디어를 넣고 리포트를 받는" 이 도구의 UX와 양립하지 않는다.
- **`sources[]`를 스키마에서 빼기** — ADR-013이 `sources`와 `citations`의 **상보성**(자기보고는 부정확하지만 만료되지 않고, 인용은 정확하지만 만료된다)을 근거로 공존을 결정했고, 리포트 렌더러가 `sources`를 쓴다. 이번에 바뀌는 것은 **하류 프롬프트에 넣지 않는다**는 것뿐이다 — **저장도 렌더링도 그대로다.** 논증에 쓰지 않는 4,449자를 4번 재전송하지 않는 것과, 출처를 산출물에서 지우는 것은 다른 일이다.

**트레이드오프**:
- `usage` 테이블이 run마다 **7~20행**씩 늘어난다(에이전트 7개 × 재시도). 관측의 대가다. 삭제 시 FK CASCADE로 함께 사라진다(ADR-015).
- **단가표가 코드(`src/lib/cost.ts`)에 하드코딩된다.** Google이 가격을 바꾸면 그 파일을 고쳐야 한다. **`cost_usd`는 추정치이지 청구서가 아니다** — 이 문장을 코드 주석에도 남긴다. 진짜 청구서는 Google Cloud 콘솔에 있다.
- **`cost_usd`는 토큰 요금 + grounding 정액 요금을 합한 값이다.** 초안은 "토큰 요금만 세므로 `cost_usd`는 하한"이라 적었으나, 구현은 `grounded` 행에 `GROUNDING_REQUEST_USD`($0.035 = $35/1,000 requests)를 **더한다**(`src/lib/cost.ts`의 `estimateCostUsd`) — 그래서 `usage.grounded` 컬럼이 있다. 오히려 **과대추정**일 수 있다: grounding은 **1,500건/일까지 무료**인데 그 한도를 모델링하지 않기 때문이다(일 단위 누적 상태를 이 도구는 알 방법이 없다. 과대추정이 과소추정보다 안전하다).
- **thinking 상한이 품질을 떨어뜨릴 수 있다.** 검증은 저장된 기존 run과의 **수동 비교**로 한다 — 별도 eval 하네스를 만들지 않는다. 리포트 품질은 이 도구의 존재 이유지만, 그것을 자동 채점하겠다는 것은 이 phase보다 큰 일이다.

**하위호환**:
- `usage` 테이블은 `IF NOT EXISTS`로 추가되는 **순수 증분**이다. 기존 run은 usage 행이 없을 뿐이고, 조회하면 빈 요약이 나온다. 기존 아티팩트·스키마·산출물은 **하나도 바뀌지 않는다.**
- `schema_version`은 **2로 올렸다.** 초안은 "1 그대로 둔다 — 시딩이 빈 DB에만 값을 쓰므로 기존 DB는 1, 새 DB는 2가 되어 같은 스키마에 두 버전 번호가 생긴다"고 적었는데, 그 문제는 **시딩을 멱등으로 고치면 사라진다**: 행이 있으면 UPDATE, 없으면 INSERT(`src/lib/db.ts`). 그래서 기존 DB도 열리는 즉시 2가 되고 버전 번호가 갈라지지 않는다. 마이그레이션 러너는 여전히 없다 — `usage` 추가는 `IF NOT EXISTS` 증분이라 **변환할 기존 데이터가 없다.** 버전 번호는 러너를 위한 것이 아니라 "이 DB가 아는 스키마가 무엇인가"의 기록이다.
- Step 5의 프롬프트 다이어트는 **하류 프롬프트만** 바꾸고 **저장되는 `context` 아티팩트는 그대로 둔다.** 리포트 렌더러와 웹 UI는 영향받지 않는다.

---

#### 실측 결과 (2026-07-12, phase 7 종료 시점) — 위 추정치를 정정한다

같은 아이디어("직장인을 위한 AI 회의록 요약 서비스")를 `gemini-2.5-flash`·소스 3개 전부 활성으로 돌린 run들의 `usage` 집계다. **이 ADR 본문의 추정치가 아니라 이 숫자를 근거로 삼아라.**

| | 총 USD | 입력 | 출력 | thinking | 콜 |
|---|---|---|---|---|---|
| **BEFORE** (무제한 dynamic thinking) | $0.1782 | 69,751 | 19,970 | 15,397 | 7 |
| **+ thinking 상한** (결정 4) | $0.1204 | 54,587 | 14,558 | 13,372 | 6 |
| **+ 프롬프트 다이어트** (2회 평균) | **$0.1302** | 37,997 | 11,977 | 14,556 | 6.5 |
| **절감률** | **−26.9%** | −45.5% | −40.0% | −5.5% | |

**추정이 어떻게 틀렸는가.** 실측 비용 분해(BEFORE): **grounding 정액 39.3% / 출력 본문 28.0% / thinking 21.6% / 입력 11.1%**. 추정(thinking 58% / 출력 17% / grounding 15% / 입력 8%)은 **thinking을 2.7배 과대평가**하고 grounding을 2.6배 과소평가했다. "돈은 thinking에 있다"는 본문의 단언은 **틀렸다** — 돈은 grounding과 출력 본문에 있었다. 그래서 결정 4(thinking 상한)의 순효과는 애초에 작을 수밖에 없었고, 실제로 **기준선 총액의 약 12%**(non-grounded 5개 에이전트의 thinking −55.6%)에 그쳤다.

**thinking 비중은 오히려 올랐다.** 과금 출력 대비 43.5% → 54.4%. 입력(−45.5%)과 출력 본문(−40.0%)이 thinking(−5.5%)보다 훨씬 많이 줄었기 때문이다. 남은 토큰 요금의 **46.9%가 thinking**이고, 그 절반이 `contextHunter`(grounded, 5,340~8,925토큰)다.

**implicit 캐싱: 하류는 0, contextHunter만 히트.**

| label | cached | prompt | 히트율 |
|---|---|---|---|
| `context-hunter` | 10,360 | 44,684 | **23.2%** |
| `thesis`·`cold-critic`·`solution-designer`·`verdict`·`research-planner` | **0** | 210,709 | **0%** |

캐시가 히트한 3건은 전부 **grounded 재시도이거나 같은 아이디어의 다음 run** — 즉 프롬프트 프리픽스가 글자 그대로 반복된 경우다. 공통 `context`를 4번 재전송하는 하류 4개 에이전트는 **단 한 번도 히트하지 않았다.** 기능이 꺼진 게 아니라 우리 프롬프트가 조건을 못 맞춘다(에이전트마다 `systemInstruction`과 도입부가 다르다). **프롬프트 재배치는 이제 근거를 갖는다** — 다만 입력은 남은 토큰 요금의 14.7%뿐이라 상한은 여전히 작다.

**남은 비용은 어디에 있는가 — `contextHunter` 하나가 run 비용의 65%다** ($0.0851 / $0.1302). 그 안에서:
1. **grounded 정액 요금 $0.035/콜** — 최대 단일 항목. 단 **1,500건/일 무료 한도 안이면 실제 청구는 0**이므로 `cost_usd`는 이 부분을 과대추정한다.
2. **grounded 형식 실패 재시도** — 6개 run 중 **3개**에서 attempt 1이 **출력 0토큰**을 내고 실패했다. 실패해도 입력과 grounding 정액은 과금된다. 이 재시도 복권이 run 총액을 지배한다 (다이어트 후 두 run이 $0.1171(재시도 0) vs $0.1433(재시도 1)로 갈렸다). **ADR-013이 서술한 grounded 형식 실패가 실재함을 계측이 확인했다** — 다음 phase의 1순위 레버는 thinking도 캐싱도 아니라 **이 실패율을 낮추는 것**이다.
3. **contextHunter의 thinking** (7,132토큰 평균) — 남은 thinking의 절반. 상한 8192는 안전망이라 물리지 않는다(위 "하드 상한이 아니라 목표치다" 참조).

**측정의 한계**: 각 조건이 1~2회 실행이라 **LLM 출력 편차(노이즈)를 포함한다.** 특히 grounded 재시도 유무가 총액을 $0.035씩 흔들어, 위 표의 −26.9%는 ±$0.035 수준의 불확실성을 안고 있다. 방향(입력·출력 감소, thinking 비중 증가, contextHunter 지배)은 모든 run에서 일관되지만, **소수점 두 자리를 신뢰하지 마라.**

### ADR-017: 치명적 결함에는 해결책이 따라야 한다
**결정**: 反이 `severity: "fatal"`로 판정한 비판은 사망선고가 아니라 **설계 과제**다. 合은 그 결함마다 해결책을 내야 하고, **스키마가 그것을 강제한다.** 네 가지를 정한다.

**1. 재설계는 치명적 결함마다 해결책을 낸다 — 프롬프트의 부탁을 칸으로 바꾼다.**

```ts
// src/types/ledger.ts — 合의 원장과 판정의 감사가 공유하는 어휘
export const REMEDY_STRATEGIES = ["defend", "bypass"] as const;
export const RemedyStrategySchema = z.enum(REMEDY_STRATEGIES);
export type RemedyStrategy = (typeof REMEDY_STRATEGIES)[number];

export const RemedySchema = z.object({
  /** 대응 대상 CriticismPoint.id */
  respondsTo: z.string().min(1),
  /** defend = 취약점을 구조적으로 제거 / bypass = 비판이 성립하는 전장을 떠남 */
  strategy: RemedyStrategySchema,
  /** 해결책 본문 */
  remedy: z.string().min(1),
});
export type Remedy = z.infer<typeof RemedySchema>;
```
`SolutionSchema`에 `remedies: z.array(RemedySchema).default([])`가 추가되고, `synthesis`의 `.optional()`은 제거된다.

**2. 판정은 각 해결책을 감사한다.**

```ts
// src/types/ledger.ts
export const REMEDY_ASSESSMENTS = ["solid", "restated", "dismissed"] as const;
export const RemedyAssessmentSchema = z.enum(REMEDY_ASSESSMENTS);
export type RemedyAssessment = (typeof REMEDY_ASSESSMENTS)[number];

export const RemedyAuditSchema = z.object({
  /** 감사 대상 CriticismPoint.id */
  criticismId: z.string().min(1),
  /** solid = 유효한 해결책 / restated = 비판을 수식어만 붙여 재주장 / dismissed = 비판을 기각하고 넘어감 */
  assessment: RemedyAssessmentSchema,
  note: z.string().min(1),
});
export type RemedyAudit = z.infer<typeof RemedyAuditSchema>;
```
`VerdictSchema`에 `remedyAudits: z.array(RemedyAuditSchema).default([])`가 추가된다. 세 값은 발명이 아니라 **실측에서 관찰된 세 가지 양태**다(아래 `6af78e` 대조표).

**3. 교차 산출물 검증은 `src/types/`의 스키마 팩토리로 한다.**

```ts
// src/types/ledger.ts — 코드가 소유하는 세 가지: 참조 무결성 · 침묵 · 귀속
export function fatalIds(points: readonly CriticismPoint[]): string[];
/** criticism에 없는 id를 참조했는가 (참조 무결성) */
export function danglingRefs(refs: readonly string[], points: readonly CriticismPoint[]): string[];
/** 아무도 언급하지 않은 fatal이 있는가 (침묵) */
export function uncoveredFatalIds(refs: readonly string[], points: readonly CriticismPoint[]): string[];

// src/types/solution.ts
export function solutionSchemaFor(criticism: Criticism): z.ZodType<Solution>;
// src/types/verdict.ts
export function verdictSchemaFor(criticism: Criticism): z.ZodType<Verdict>;
```
두 팩토리는 `superRefine`으로 (a) `respondsTo`/`criticismId`의 참조 무결성, (b) fatal 전건 커버리지, (c) 중복 참조 없음을 검증한다. **에러 메시지에 누락된 id를 나열한다** — 그 문자열이 곧 자가 교정 재시도의 피드백이 되기 때문이다(ADR-004). 반환 타입이 `z.ZodType<Solution>`이라 `generateStructured`의 `schema: ZodType<T>`에 그대로 들어가고, **재시도 루프를 공짜로 탄다.** `VerdictSchema`가 이미 `.refine`(밴드 검증)을 달고도 `z.toJSONSchema`를 통과하고 있으므로 refinement 체이닝에는 선례가 있다.

의존은 **파이프라인이 흐르는 방향으로만** 흐른다: 하류(solution·verdict)의 스키마는 상류(criticism)를 알 수 있고, 상류는 하류를 모른다. `CriticismSchema`는 지금도 Thesis를 모른다(`criticism.ts:16-18`) — 그 규율을 깨지 않는다.

**4. 코드는 침묵만 소유한다. 유효성 판단은 판정에 남긴다.**

이것이 이 ADR의 핵심이다. ADR-013("출처는 판단이 아니라 사실이다")의 유비를 가져오되 **절반만** 적용한다.

> ADR-013이 통한 것은 **외부 정답지**가 있었기 때문이다 — URL은 API 응답에 실재했고, 코드는 LLM을 전사(轉寫) 경로에서 제거하기만 하면 됐다. 그러나 **"이 해결책이 유효한가"는 어떤 API 응답에도, 어떤 DB에도 없다. 주입할 사실이 존재하지 않는다.**
>
> 코드가 소유할 수 있는 것은 더 좁지만 여전히 결정적이다:
> - **침묵** — "재설계가 c5에 대해 아무 말도 하지 않았다"는 두 문서 간의 집합 뺄셈이다. 증명 가능하다.
> - **참조 무결성** — "c99라는 비판은 존재하지 않는다". 증명 가능하다.
> - **주장의 귀속** — "재설계가 c3를 우회했다고, 이런 말로 주장했다"는 기록이다. 증명 가능하다.
>
> **"방어가 유효한가"는 영원히 판단이다.** 그러므로 이 ADR의 슬로건은 "사실로 만든다"가 아니라:
>
> **판단은 남기되, 침묵은 코드가 불가능하게 만든다.**

**역할 분리**. 편향을 없애는 게 아니라 **이동하지 못하게** 하는 것이 목적이다 — ADR-010은 낙관 편향을 제거한 게 아니라 판정자로 **옮겼다**. 그 이동을 여기서 멈춘다.

| 단계 | 소유 | 접근 금지 |
|---|---|---|
| 비판 | `severity` (fatal/major/minor) | 상류에서 동결 — 하류가 수정 불가 |
| 재설계 | 결함별 해결책 | 점수를 모른다 |
| 판정 | 해결책 감사 + 점수 | 비판의 `severity`를 못 바꾼다 |
| 코드 | 참조 무결성 · 치명적 결함 전건 커버리지 | 유효성 판단 불가 |

**정보 차단벽**: 재설계에게 **점수 규칙을 알려주지 않는다.** `RECOMMENDATION_SCORE_BANDS`도, "fatal이 남으면 40점 미만"도 `solutionDesigner`의 프롬프트에 넣지 않는다. 알면 점수를 위해 해결책을 지어낸다 — 채점 기준을 아는 응시자는 답이 아니라 채점자를 겨냥한다. 이 금지는 step 2에 박힌다.

**severity 세탁이 불가능한 이유**: 판정은 방어하기 곤란한 c7을 "major였다"고 부르고 싶겠지만, `severity`는 `criticism` 아티팩트에 있고 상류에서 동결된다. 판정의 유일한 출구는 그 항목에 `solid`라고 쓰는 것인데, 그건 이제 **명시적이고, 귀속 가능하며, 리포트에 렌더되는 주장**이다. 줄글에 묻힌 관대함과 원장에 적힌 `solid`는 같은 관대함이 아니다 — 후자는 반박할 수 있다. **구조가 갈 수 있는 데까지는 여기까지다.** 판정이 거짓말하기로 하면 여전히 거짓말할 수 있고, 이 ADR은 그 한계를 소리 내어 말한다.

**이유**:

측정된 사실이다 (`data/anvil.db` — run 11건 / ADR-011 이후 형식의 판정 5건).

| 사실 | 수치 |
|---|---|
| 재설계가 **모든 fatal id**를 `revisedConcept` 줄글에 언급하는 run | **5/5** |
| 그 언급의 형식 | **5개 run이 5가지** — `(反 c1)` · `**c1 (무료 대안 확산) & c3 … 대응 (우회):**` · `**c1 (fatal: …) 대응**` · `**(c2: … 방어)**` · `'…한계(c1)'` |
| 판정이 보고한 잔존 fatal | 5개 중 **4개가 0건** — fatal 9건을 재설계가 전부 해소했다는 뜻 |
| 잔존 fatal을 보고한 run | **1개** (`472fc2`) |
| 판정 점수 분포 | 65 · 65 · 65 · 75 · 75 — **두 값뿐**. `abandon`(0~39)은 0회 |
| `rebuts` dangling ref | 참조 16건 중 **0건** |

> ⚠️ **이 phase 초안의 "태깅 2/5"는 틀렸다.** 초안은 *"비판 id를 태깅하는 run은 5개 중 2개(`6af78e`, `d32758`)이고, 나머지 3개(`500424`, `13c0ac`, `472fc2`)는 결함 번호를 언급조차 안 한다"* 고 적었다. DB를 전수조사한 결과 **5개 run 전부가 모든 fatal id를 언급한다.** 초안이 놓친 것은 존재가 아니라 **형식**이다 — 세 run은 `(c2:` 꼴이 아니라 `(反 c1)`·`**c1 (무료 대안 확산) …**` 꼴이라, 한 패턴만 찾으면 0건으로 보인다. **정정은 결정을 뒤집지 않고 강화한다**(아래). ADR-016의 선례를 따라 틀린 추정을 지우지 않고 남긴다 — *측정하지 않고 최적화하지 않는다*는 규칙은 이 phase의 초안에도 적용된다.

**능력이 없는 게 아니라 칸이 없다 — 5/5가 그 증거다.** 요구는 **이미 프롬프트에 적혀 있고**(`solutionDesigner.ts:38-41`: *"severity가 fatal 또는 major인 항목 **각각**에 대해 … revisedConcept에 반드시 드러나야 한다"*), 모델은 **부탁만 받고도 5/5로 원장을 만들어낸다.** 즉 이 phase는 새 능력을 요구하지 않는다. 설계 리스크는 낮다.

문제는 그 원장이 **줄글이라는 것**이다:
- **형식이 5개 run에 5가지다.** 코드가 읽을 수 없다. `(反 c1)`과 `**c1 (무료 대안 확산) & c3 …**`를 같은 것으로 파싱하려면 정규식 군비경쟁이 시작된다 — 그리고 그 정규식은 초안이 그랬듯 **조용히 3건을 놓친다.**
- **5/5는 보장이 아니라 표본이다.** n=5의 우연이며, 6번째 run이 c5에 침묵해도 그것을 잡는 것이 아무것도 없다. **부탁은 지켜졌는지 확인되지 않는다 — 지켜진 것처럼 보일 뿐이다.**
- **커버리지를 셀 수 없으면 판정도 항목별로 감사할 수 없다.**

고칠 것은 "모델이 안 한다"가 아니라 **"했는지 확인할 방법이 없다"**이다. 이는 ADR-013이 이미 해결한 문제와 같은 구조다 — LLM에게 "URL을 정확히 받아적어라"라고 부탁했더니 `cloud.google.google.com`이 나왔고, ADR-013은 부탁을 그만두고 구조를 바꿨다. 여기서도 부탁을 **칸**으로 바꾼다.

**결정 1은 기반이고, 결정 2가 지렛대다.** 정직하게 말하면 결정 1의 `superRefine`은 **기존 5개 run 어디에도 걸리지 않는다** — 오늘 침묵하는 run은 없다. 결정 1의 값어치는 (a) 미래의 침묵을 불가능하게 만드는 보험이고, (b) 원장을 **주소 지정 가능**하게 만들어 결정 2가 항목별로 감사할 수 있게 하는 것이다. 실재하는 불이 붙은 곳은 결정 2 쪽이다:

**판정이 말장난을 걸러내지 못한다** (`6af78e` 전수 대조 — 판정: 65점 / `pivot` / **잔존 fatal 0건**):

| 비판 | severity | 비판의 지적 | 재설계의 답 | 실제 |
|---|---|---|---|---|
| c4 | `fatal` | 대기업이 기능 복제 가능 | 농가 '품질 지문' + 소비자 '맛 프로필' 데이터 플라이휠 | **유효한 해결책** (`solid`) |
| c5 | `fatal` | "AI 품질 예측은 해자 부재를 가리는 **허상**" | "**경량화된** IoT 센서와 클라우드 AI 모델" | **재주장** (`restated`) — 허상이라 한 것에 수식어만 붙였다 |
| c1 | `minor` | '니스칠 사과' 품질 우려 | "**과장된 우려**… 일일이 반박하기보다 포괄하여 방어" | **비판 기각** (`dismissed`) — 풀지 않고 넘어갔다 |

**셋 다 판정에 똑같은 줄글로 도착했고, 셋 다 승인됐다.** 문제는 "판정이 관대하다"가 아니다. **판정이 진짜 해결책과 재주장을 구분할 수단이 없다**는 것이다. 원장이 생기면 판정은 c5에 대해 `solid`/`restated`/`dismissed` 중 하나를 **골라 적어야** 한다. 고르는 행위 자체가 관대함을 드러낸다.

**기각한 대안**:
- **"치명적 결함 미해결 → `survivalScore` 40점 미만 강제"(floor)** — 두 가지 이유로 기각한다.
  1. **ADR-010 위반.** ADR-010은 *"피벗을 설계해놓고 피벗 이전의 사망선고를 결론으로 내는 논리 파탄"*을 막으려고 판정자를 제3의 에이전트로 분리했다. floor는 **바로 그 사망선고를 코드로 자동화한다.** 치명적 결함은 설계 과제이지 사형 사유가 아니다.
  2. **역효과.** 판정 5건 중 잔존 fatal을 쓴 것은 `472fc2` **하나뿐**이다. floor는 **유일하게 정직했던 run만 처벌하고** 침묵한 4건은 그대로 통과시킨다. 합리적인 모델의 반응은 `fatal`이라는 단어를 쓰지 않는 것이다 — 보이는 모순 1건을 보이지 않는 모순 5건으로 바꾸고 그것을 개선이라 부르게 된다.
  → **커버리지 없는 floor는 이 phase의 축소판이 아니라 회귀다.** 이 순서 제약을 못박는다: 원장이 먼저다.
- **재설계에 "감수(accept)" 출구 제공** — 못 풀어도 되는 탈출구는 요구사항과 반대다. 현재 프롬프트의 *"대응할 수 없는 fatal 비판이 있다면 … 그 한계를 명시하라"*(`solutionDesigner.ts:41`) 탈출구도 이번에 **제거한다.**
- **재설계의 자기신고를 "사실"로 코드 주입** — 재설계가 전부 "방어함"이라 쓰면 코드는 "미해결 0건"을 *코드 주입 사실의 탈을 씌워* 판정에 전달한다. **지금보다 나쁘다.** `researchCoverage`가 사실인 것은 수집기가 개수를 반환했기 때문이다(ADR-013). **자기신고는 스키마를 입은 의견이다.** 게다가 점수가 재설계의 신고에 걸리면 **재설계가 판정의 점수를 통제**하게 되어 ADR-010을 정면으로 위반한다. **재설계의 원장은 감사 대상 입력이지 권위가 아니다.**
- **orchestrator에 validator 모듈 신설** — `generateStructured`가 **반환한 뒤** 돌기 때문에 재시도가 안 붙는다. ADR-004의 자가 교정 루프를 손으로 다시 만들어야 하고, 프롬프트 전문을 루프 밖에서 재청구한다(ADR-016: 재시도는 가장 비싼 경로다).
- **`rebuts` 교차 검증 추가** — 스키마 팩토리 패턴이 생기면 `rebuts`도 `thesis.points`에 대해 검증할 수 있다. **하지 않는다.** 실측상 `rebuts` 참조 16건 중 dangling이 **0건**이다. 측정된 문제가 없는데 검증을 붙이면 새 재시도 실패와 비용만 산다 (ADR-016: *측정하지 않고 최적화하지 않는다*). **패턴이 이것을 가능하게 만들지만, 근거를 이유로 사양한다** — 이 문장을 기록으로 남긴다.
- **`major`까지 전건 강제** — 요구사항이 치명적 결함에 대한 것이므로 강제 범위도 딱 거기까지다. 실측상 fatal 2 + major 3이면 의무 항목이 5개가 되어 재시도 위험과 출력 토큰(비용의 28% — ADR-016 실측)이 오른다. `major`는 **허용하되 강제하지 않는다.**
- **네 번째 감사 에이전트 신설** — 판정이 이미 감사자다. 에이전트를 늘리면 콜이 늘고(비용), 같은 낙관 편향이 한 칸 더 이동할 뿐이다.

**트레이드오프**:
- **해결책을 의무화하면 못 풀 때 지어낼 수 있다.** 위 c5·c1이 이미 그 형태의 말장난이고, 칸을 만든다고 사라지지 않는다 — 오히려 빈 칸은 채우라는 압력이다. 이를 막는 것은 판정의 감사이며, 그래서 **결정 1과 결정 2는 한 세트이고 분리 출시하지 않는다.** 원장만 넣으면 말장난에 번호만 붙는다.
- **판정의 `assessment`는 여전히 LLM의 판단이다.** 구조는 판단을 **기록·귀속**하게 만들 뿐 정확하게 만들지 못한다. `restated`여야 할 것에 `solid`라고 쓰는 판정을 코드는 막지 못한다.
- **`remedies`·`remedyAudits`가 출력 토큰을 늘린다.** 출력은 비용의 28%다(ADR-016 실측). fatal 2건 기준 원장 2항목 + 감사 2항목이 추가된다. step 7에서 관측한다.
- **판정 점수가 65/75 두 값에 몰린 것은 이 phase가 고치지 않는다.** 증상으로만 기록한다 — n=5이고 원인이 측정되지 않았다. 점수 해상도를 프롬프트로 손보는 것은 희망을 프롬프팅하는 짓이다. (`abandon`이 0회인 것도 결함의 증거로 쓰지 않는다. 5건은 표본이 아니고, 그 아이디어들이 철회 대상이었다는 근거가 없다. 문제는 `abandon`이 안 쓰인 게 아니라 **도달 가능한 경로가 있는지 모른다**는 것이다.)

**하위호환**:
- **정적 스키마는 관대하게(`.default([])`), 팩토리만 엄격하게.** 그래서 **현재 렌더되는 run은 아무것도 잃지 않는다** — 최신 run 5개의 `solution`·`verdict`는 원장이 없어도 정적 스키마를 전부 통과한다.
- **`synthesis`의 `.optional()`은 제거한다.** 이것이 없는 구 solution은 **criticism이 이미 ADR-011 이전 형식이라 실패하는 run**(실측 5건: `e5d75e`·`dd2e18`·`8fd760`·`ca0eda`·`764b6f`)에만 있고, 그 run들은 오늘도 빈 화면 + "이전 버전 형식" 안내를 렌더한다. 빈 대립에 붙은 合 줄글을 지키려고 optional을 남길 이유가 없다.
- **resume 시 `loadStepOutput`이 팩토리로 재검증하므로**, 원장 없는 저장된 solution은 `null` → "산출물이 없거나 손상됨"으로 자동 재생성된다 (ADR-011이 문서화한 이송 경로와 같다).
- **웹 읽기 경로는 정적 스키마를 계속 쓴다.** 웹은 `criticism`을 로드하지 않고도 `solution`을 렌더해야 한다. **관대한 읽기 / 엄격한 쓰기** — 두 단계 엄격도는 설계이지 실수가 아니다.
