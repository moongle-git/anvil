# PRD: anvil — AI 서비스 기획 컨설팅 에이전트

## 목표
비즈니스 아이디어를 입력하면 실시간 시장 데이터(웹검색 + YouTube + Hacker News + 네이버 커뮤니티)를 근거로 냉정한 비판과 AI 네이티브 재설계안을 담은 컨설팅 리포트(Markdown)를 자동 생성한다.

## 사용자
서비스 기획자, 1인 개발자, 창업 준비자 — 아이디어의 시장성을 빠르게 검증하고 AI 시대에 생존 가능한 형태로 다듬고 싶은 사람.

## 핵심 기능
아이디어는 정반합(正反合) 변증법으로 검증된다. 파이프라인 step은 총 6개다:
`interviewer → context-hunter → thesis → cold-critic → solution-designer → verdict`
(interviewer는 웹에서 생성된 run에서만 활성화된다.)

1. **Context Hunter (시장 맥락 수집)** — 소스별 검색어를 먼저 생성한 뒤(한국어: YouTube·네이버 / 영어: Hacker News), **YouTube 댓글 · Hacker News 토론 · 네이버 블로그·카페글·지식iN**을 병렬로 수집해 정규화된 커뮤니티 목소리로 정제한다. 웹검색은 Gemini Google Search grounding으로 최신 트렌드·유사/경쟁 서비스·시장 지표를 조사하되, LLM의 자기보고 URL과 별개로 **코드가 grounding 응답에서 추출한 검증된 검색 인용(citations)** 을 함께 남긴다. 경쟁사 공식 페이지는 urlContext로 직접 읽어 가격·기능 정확도를 높인다. 일부 소스가 실패하거나 키가 없으면 그 소스만 빠지고 나머지로 진행한다.
2. **Thesis (낙관적 논제, 正)** — 시장 맥락을 근거로 이 아이디어가 가질 수 있는 성공의 최대 잠재력, 바이럴 시나리오, 수익화 시나리오를 적극적으로 긍정한다. 反이 공격할 표적을 세우는 것이 이 에이전트의 역할이다.
3. **Cold Critic (냉정한 비판, 反)** — 수집된 시장 데이터를 근거로 페인포인트의 허구성, 수익 모델(BM) 취약성, 카피캣 리스크 3축에서 매섭고 객관적인 비판을 생성한다. 각 비판은 正의 주장과 같은 축 위에서 정면으로 대립한다. 근거 없는 긍정·위로는 배제한다.
4. **Solution Designer (AI 네이티브 재설계, 合)** — 비판을 수용하여 Minimal Input/Zero UI, Agentic Workflow, Data Flywheel, 지속 가능한 BM 관점으로 아이디어를 재설계한 제안을 생성한다. 反을 방어·우회하는 피벗 전략이다.
5. **Verdict (최종 판정)** — 시장 맥락·正·反·合을 모두 입력받아 생존 가능성 점수(0~100)와 종합 결론을 낸다. 기존의 `criticism.verdict`는 反 섹션의 소결론으로 격하되고, 리포트의 최종 판정은 이 에이전트가 생성한다.

파이프라인은 하네스 패턴으로 동작한다: 각 에이전트는 순차 실행되는 step이며, 산출물은 `runs/{run-id}/`에 단계별 JSON으로 persist되고, 중단 시 완료된 step을 건너뛰고 이어서 실행(resume)할 수 있다. 최종 산출물은 아래 규격의 `report.md`다.

## 리포트 출력 규격
리포트는 5단계 서사로 전개된다. **순서는 협상 불가다.** 독자는 근거를 먼저 보고, 대립하는 두 해석을 거쳐, 종합에 도달한 뒤에야 판정을 읽는다.

| # | 섹션 | 성격 | 데이터 출처 |
|---|------|------|------------|
| 1 | 시장 맥락 (Context) | 건조한 팩트. 트렌드·시장 규모 지표 브리핑 | `context.json` |
| 2 | 正 (낙관적 가설) | 최대 잠재력·바이럴/수익화 시나리오 | `thesis.json` |
| 3 | 反 (냉정한 비판) | 수익 모델 취약성·카피캣 리스크. 正과 정면 대립 | `criticism.json` |
| 4 | 合 (인사이트 및 재설계) | 反을 방어·우회하는 피벗 전략. **가장 중요한 섹션** | `solution.json` |
| 5 | 최종 판정 (Verdict) | 4단계를 거친 후의 생존 가능성과 종합 결론 | `verdict.json` |

`report.md`(다운로드용)도 같은 순서를 따른다.

```markdown
# [컨설팅 리포트] {아이디어 제목}

## 1. 시장 맥락 (Context)
## 2. 正 — 낙관적 가설 (Thesis)
## 3. 反 — 냉정한 비판 (Antithesis)
## 4. 合 — 인사이트 및 재설계 (Synthesis)
## 5. 최종 판정 (Verdict)
```
리포트 본문은 한국어로 작성한다.

## 컴포넌트 매핑 규격
리포트는 평면적 텍스트가 아니라 UI 컴포넌트 단위로 구조화된다.

- **Split View** — 2단계(正)와 3단계(反)는 `painPoint`/`bm`/`copycat` 세 축을 공유하며, 같은 축의 낙관 주장과 비판이 좌우로 나란히 놓인다. 모바일에서는 축 단위로 세로 스택된다.
- **Risk Badge & Radar** — 리스크는 텍스트에 묻히지 않는다. 각 비판 항목은 severity 뱃지와 0~100 위험도 점수, 그리고 짧은 리스크 키워드를 분리해서 갖는다. 축별 점수는 레이더 차트로 시각화한다.
- **Accordion (Summary / Details)** — 커뮤니티 목소리 원문(YouTube·Hacker News·네이버)·경쟁사 목록·출처 URL 같은 원시 데이터는 본문에 투척하지 않는다. 본문에는 AI가 정제한 인사이트 문단만 놓고, 원시 근거는 접힌 영역에 넣는다.

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
UX 원칙: **순차 논증(Progressive Disclosure)**. 독자는 시장 맥락 → 正 → 反 → 合 → 판정 순으로 읽는다.
결론을 상단에 미리 노출하지 않는다. 상단 요약 배너는 금지한다.
1. **헤더**: 아이디어 제목, 실행 일시, report.md 다운로드 버튼
2. **섹션 목차 네비**(데스크톱 좌측 sticky / 모바일 상단): ① 시장 맥락 ② 正 ③ 反 ④ 合 ⑤ 최종 판정 — 5단계 서사 순서를 유지한다. 현재 읽고 있는 섹션을 강조해 진행 위치를 알린다.
3. **① 시장 맥락**: 정제된 트렌드·시장 지표 브리핑을 본문에. 경쟁 서비스 테이블(이름·설명·가격힌트 뱃지·외부 링크), YouTube 실제 목소리 인용 카드(댓글 원문·작성자·좋아요 수·영상 링크 새 탭), 출처 URL 목록은 모두 접힌 영역(건수 표기)에 넣는다
4. **② 正 / ③ 反**: `painPoint`/`bm`/`copycat` 축을 공유하는 Split View. 같은 축의 낙관 주장(좌)과 비판(우)이 나란히 놓인다. 비판 항목 카드 = severity 뱃지 + 위험도 점수 + 리스크 키워드 + claim(제목) + evidence(기본 접힘). 反 말미에 criticism.verdict를 反의 소결론 콜아웃으로 표시한다(최종 판정 아님). 축별 위험도 점수는 RiskRadar로 시각화
5. **④ 合**: revisedConcept를 리드 문단으로 강조 → minimalInput/agenticWorkflow/dataFlywheel/monetization 서브섹션. 각 항목은 反의 어느 비판을 방어·우회하는지 밝힌다. 장문 텍스트는 좁은 본문 폭(max-w-3xl)
6. **⑤ 최종 판정**: 생존 가능성 점수(SurvivalGauge) + 종합 결론 본문. 리포트의 마지막에 온다

### 비교 뷰 (/compare?a=&b=)
- 두 run을 2컬럼으로: 실행 정보 → severity 집계 → verdict → revisedConcept → monetization 순 행 정렬. 모바일은 세로 스택
- 미완료 run이 포함되면 안내 후 차단

## run 상태 파생 규칙 (UI 표시용)
- state.json에 `completedAt` 존재 → **완료(completed)**
- 어느 step이든 `status: "error"` → **실패(error)**
- 그 외: state.json 파일 mtime이 15분 이내 → **진행중(running)**, 15분 초과 → **중단됨(stalled)** — 실행 프로세스가 죽은 것으로 간주, resume 가능

## Phase 1-web-ui 제외 사항
- run 삭제, DB 도입(ADR-002 유지), 실시간 로그 스트리밍/SSE, 다크 모드, 사용자 인증·배포·멀티테넌시, YouTube 영상 임베드(링크만 제공)

---

# Phase 2-dialectic-report: 변증법 리포트

## 목표
평면적 마크다운 나열을 폐기하고, 인지 흐름을 통제하는 5단계 입체 컴포넌트 구조로 전환한다.
독자는 결론을 미리 훔쳐보지 못하고 시장 맥락 → 正 → 反 → 合 → 최종 판정 순으로 논증을 따라간다.
正/反은 공유 축 위의 Split View로 대립하고, 리스크는 뱃지·점수·레이더로 계량화되며, 원시 근거는 접힌 영역으로 밀려난다.
최종 판정은 合까지 반영한 별도 에이전트(`verdict`)가 생성한다.

## 하위호환
스키마가 바뀌므로 기존 `runs/`의 산출물은 검증에 실패한다.
- `RunStore.loadStepOutput`은 검증 실패 시 `null`을 반환하므로, **완료된 구버전 run은 리포트 뷰에서 빈 상태로 표시**되고 `report.md` 다운로드로 대체한다.
- 미완료 run은 resume 시 해당 step이 자동 재실행되어 마이그레이션된다.

## Phase 2-dialectic-report 제외 사항
- 레이더 차트 툴팁·인터랙션 (정적 SVG만)
- 다크 모드
- DB 도입 (ADR-002 유지)
- 구버전 run 데이터 마이그레이션 스크립트

---

# Phase 3-multi-source-research: 다중 소스 자료조사

## 목표
자료조사(`context-hunter`)를 YouTube 단일 소스에서 **YouTube + Hacker News + 네이버 검색 3소스 병렬 수집**으로 확장하고,
웹검색 결과를 LLM의 자기보고가 아니라 **검증 가능한 인용(citations)** 으로 만든다.
소스별 검색어는 아이디어 원문을 그대로 쓰지 않고 `researchPlanner`가 생성한다(HN은 영어, YouTube·네이버는 한국어).
소스별 원시 타입은 얇은 어댑터로 공통 `CommunityVoice`(`{source, title, url, text, authorName?, score?, extra?}`)로 정규화되며,
일부 소스가 실패하거나 API 키가 없어도 나머지 소스로 진행한다(fail-soft). 전부 실패해도 웹검색만으로 파이프라인은 계속된다.
서사(시장 맥락 → 正 → 反 → 合 → 최종 판정)는 그대로다 — 이 phase는 1단계 "시장 맥락"의 **입력**만 바꾼다.

## 하위호환
구 `context.json`의 `youtubeVoices[]`는 스키마 검증 시 `communityVoices[]`(`source: "youtube"`)로 **자동 승격**된다(ADR-012).
ADR-011(criticism/thesis 스키마 변경)과 달리 **구 run이 빈 리포트가 되지 않는다.**

## Phase 3-multi-source-research 제외 사항
- Reddit (OAuth 필요)
- 앱스토어 리뷰 수집
- 네이버 카페 본문 전문 수집 (스크래핑·로그인 월 필요 — 검색 스니펫까지만)
- YouTube 자막(Transcript) 수집 (ADR-003 유지)
- 수집 결과 캐싱
- HTTP 레벨 재시도·백오프
