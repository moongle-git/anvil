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
