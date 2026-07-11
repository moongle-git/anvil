# Architecture Decision Records

## 철학
MVP 속도 최우선. 외부 의존성 최소화. 작동하는 최소 구현을 선택하되, 하네스 엔지니어링 패턴(순차 step + 파일 기반 상태 + 자가 교정)을 런타임 설계의 기준으로 삼는다.

---

### ADR-001: 실행 엔진으로 Gemini API 직접 오케스트레이션 채택
**결정**: 에이전트 실행을 `@google/genai` SDK(Gemini API)로 직접 오케스트레이션한다. claude CLI 헤드리스 방식은 채택하지 않는다.
**이유**: 독립 배포 가능한 서비스로 만들기 위해 특정 CLI 도구 설치에 의존하지 않는다. Gemini는 Google Search grounding을 내장해 별도 검색 API 없이 실시간 웹검색이 가능하다.
**트레이드오프**: GEMINI_API_KEY가 필요하고, 재시도·검증 로직을 직접 구현해야 한다.

### ADR-002: 저장은 파일 기반, DB 없음
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
**트레이드오프**: 진행 표시가 최대 2초 지연된다. 프로세스 비정상 종료는 mtime 휴리스틱(10분)으로 "중단됨"을 추정한다.

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
