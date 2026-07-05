# PRD: anvil — AI 서비스 기획 컨설팅 에이전트

## 목표
비즈니스 아이디어를 입력하면 실시간 시장 데이터(웹검색 + YouTube)를 근거로 냉정한 비판과 AI 네이티브 재설계안을 담은 컨설팅 리포트(Markdown)를 자동 생성한다.

## 사용자
서비스 기획자, 1인 개발자, 창업 준비자 — 아이디어의 시장성을 빠르게 검증하고 AI 시대에 생존 가능한 형태로 다듬고 싶은 사람.

## 핵심 기능
1. **Context Hunter (시장 맥락 수집)** — Gemini Google Search grounding으로 최신 트렌드·유사/경쟁 서비스를 수집하고, YouTube Data API로 관련 영상과 댓글 원문(실제 유저 목소리)을 수집·정제한다.
2. **Cold Critic (냉정한 비판)** — 수집된 시장 데이터를 근거로 페인포인트의 허구성, 수익 모델(BM) 취약성, 카피캣 리스크 3축에서 매섭고 객관적인 비판을 생성한다. 근거 없는 긍정·위로는 배제한다.
3. **Solution Designer (AI 네이티브 재설계)** — 비판을 수용하여 Minimal Input/Zero UI, Agentic Workflow, Data Flywheel, 지속 가능한 BM 관점으로 아이디어를 재설계한 제안을 생성한다.

파이프라인은 하네스 패턴으로 동작한다: 각 에이전트는 순차 실행되는 step이며, 산출물은 `runs/{run-id}/`에 단계별 JSON으로 persist되고, 중단 시 완료된 step을 건너뛰고 이어서 실행(resume)할 수 있다. 최종 산출물은 아래 규격의 `report.md`다.

## 리포트 출력 규격
```markdown
# [컨설팅 리포트] {아이디어 제목}

## 1. 실시간 시장 맥락 (Market Context)
*   **수집된 유사/경쟁 서비스 현황:** (웹검색 기반 데이터)
*   **YouTube/커뮤니티 내 타겟 유저의 실제 목소리:** (실제 페인포인트 인용)

## 2. 냉정한 현실 인식 및 비판 (Cold Criticism)
> [경고] 본 아이디어가 실패할 확률이 높은 구조적 이유를 나열합니다.
*   **페인포인트의 허구성:** ...
*   **수익 모델(BM)의 취약성:** ...
*   **카피캣 리스크:** ...

## 3. AI 네이티브 관점의 해결책 (Solution Architecture)
### ① 데이터 수집 및 최소 입력 구조 (Minimal Input)
### ② 에이전틱 워크플로우 (Agentic Workflow)
### ③ 독점적 데이터 플라이휠 (Data Flywheel)

## 4. 지속 가능한 비즈니스 모델 (Monetization Model)
```
리포트 본문은 한국어로 작성한다.

## MVP 제외 사항
- 웹 UI (입력 폼·진행 상태·리포트 뷰어) — 다음 phase(1-web-ui)에서 구현
- 데이터베이스(SQLite/PostgreSQL) — 파일 기반 저장으로 대체
- YouTube 자막(Transcript) 수집 — 댓글·메타데이터 수집까지만
- 사용자 인증, 멀티테넌시, 과금

## 디자인
- MVP는 CLI 전용. 웹 UI 디자인은 docs/UI_GUIDE.md(라이트 문서/리포트 톤)를 따른다.

---

# Phase 1-web-ui: 웹 UI

## 목표
로컬에서 실행하는 웹 UI로 컨설팅 파이프라인의 전 과정을 제공한다: 아이디어 입력 → 실행 → 진행 상태 → 리포트 열람 → 이력 관리(검색/필터·resume·비교). 리포트는 report.md가 아닌 **구조화 JSON**(context/criticism/solution.json)을 직접 렌더링해 데이터 특성에 맞는 UX를 만든다. report.md는 다운로드용으로 유지한다.

## 화면 구성 (IA)
```
/                 홈: 새 컨설팅 시작(입력 폼) + run 이력 목록
/runs/{id}        run 상세: 미완료면 진행 뷰, 완료면 리포트 뷰 (같은 URL에서 전환)
/compare?a=&b=    두 run 비교
```

### 홈 (/)
- 상단: 아이디어 입력 폼(textarea + "컨설팅 시작") — 제출 시 run 생성 후 `/runs/{id}`로 이동
- 하단: run 목록(최신순): 아이디어 제목, 실행 일시, 상태 뱃지(완료/진행중/중단됨/실패)
- 아이디어 키워드 검색 + 상태 필터. 실패/중단 run에는 "이어서 실행"(resume) 버튼
- 완료된 run 2개 체크 선택 → "비교하기" 버튼 활성화 → /compare 이동
- 빈 상태: 첫 사용자를 위한 안내 + 예시 아이디어 제시

### 진행 뷰 (/runs/{id}, 미완료)
- 3단계 스테퍼 — 내부 step명을 사용자 언어로 번역: context-hunter → "시장 조사", cold-critic → "냉정한 비판", solution-designer → "AI 네이티브 재설계"
- step별 상태 아이콘 + 경과 시간. 2초 간격 폴링으로 갱신
- step error 시 errorMessage 표시 + "이어서 실행" 버튼
- 전체 완료 감지 시 리포트 뷰로 자동 전환

### 리포트 뷰 (/runs/{id}, 완료) — 이 phase의 핵심
UX 원칙: **역피라미드**. "그래서 이 아이디어 어떻다는 건데?"를 최상단에.
1. **헤더**: 아이디어 제목, 실행 일시, report.md 다운로드 버튼
2. **요약 배너**: verdict 전문 + severity 집계 뱃지(fatal N · major N · minor N)
3. **섹션 목차 네비**(데스크톱 좌측 sticky / 모바일 상단): ① 시장 맥락 ② 냉정한 비판 ③ AI 네이티브 재설계 ④ 비즈니스 모델 — 리포트 내러티브(근거→진단→처방→수익화) 순서 유지
4. **① 시장 맥락**: 트렌드 불릿 리스트 / 경쟁 서비스 테이블(이름·설명·가격힌트 뱃지·외부 링크, 초기 8개 + 더보기) / YouTube 실제 목소리 인용 카드(댓글 원문·작성자·좋아요 수·영상 링크 새 탭) / 페인포인트 근거 리스트 / 출처는 접힘
5. **② 냉정한 비판**: 3축 서브섹션(페인포인트의 허구성 / 수익 모델(BM)의 취약성 / 카피캣 리스크). 각 항목 카드 = severity 뱃지 + claim(제목) + evidence(기본 접힘). 마지막에 verdict 강조 콜아웃
6. **③ AI 네이티브 재설계**: revisedConcept를 리드 문단으로 강조 → minimalInput/agenticWorkflow/dataFlywheel 서브섹션. 장문 텍스트는 좁은 본문 폭(max-w-3xl)
7. **④ 비즈니스 모델**: monetization 본문

### 비교 뷰 (/compare?a=&b=)
- 두 run을 2컬럼으로: 실행 정보 → severity 집계 → verdict → revisedConcept → monetization 순 행 정렬. 모바일은 세로 스택
- 미완료 run이 포함되면 안내 후 차단

## run 상태 파생 규칙 (UI 표시용)
- state.json에 `completedAt` 존재 → **완료(completed)**
- 어느 step이든 `status: "error"` → **실패(error)**
- 그 외: state.json 파일 mtime이 10분 이내 → **진행중(running)**, 10분 초과 → **중단됨(stalled)** — 실행 프로세스가 죽은 것으로 간주, resume 가능

## Phase 1-web-ui 제외 사항
- run 삭제, DB 도입(ADR-002 유지), 실시간 로그 스트리밍/SSE, 다크 모드, 사용자 인증·배포·멀티테넌시, YouTube 영상 임베드(링크만 제공)
