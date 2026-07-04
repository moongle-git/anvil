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
- MVP는 CLI 전용. UI 디자인은 1-web-ui phase에서 UI_GUIDE.md와 함께 확정한다.
