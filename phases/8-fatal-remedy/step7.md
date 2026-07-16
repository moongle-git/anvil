# Step 7: final-verify

## 읽어야 할 파일

- `/docs/ADR.md` — **ADR-017**(이 phase가 실제로 그 결정대로 구현됐는지 대조한다), **ADR-016**(특히 "실측 결과" 절의 형식 — 이 step이 그 형식을 따른다. 그리고 *측정하지 않고 최적화하지 않는다*)
- `/docs/PRD.md`, `/docs/ARCHITECTURE.md`, `/CLAUDE.md`
- `phases/8-fatal-remedy/index.json` — step 0~6의 summary 전부. 무엇이 실제로 만들어졌는지 파악하라.
- `phases/7-cost-control/step6.md`와 그 summary — **검증 강도의 기준**이다. 이 step은 그 수준을 따른다.
- 이번 phase가 만든 코드 전부

## 배경

이 step은 **검증 step이다.** 원칙적으로 코드를 바꾸지 않는다 — 문서-코드 불일치를 정정하는 것은 예외다 (phase 7 step 6의 선례).

그리고 **이 phase에서 처음으로 실제 데이터를 본다.** step 0~6은 전부 실측 없이 진행됐다. ADR-016의 교훈("추정이 2.7배 틀렸고 계측만이 그것을 잡아냈다")이 여기 적용된다.

## 작업

### 1. AC 전수

```bash
npm run build   # 0 에러
npm test        # root + web
npm run lint    # 0
env -u GEMINI_API_KEY -u YOUTUBE_API_KEY -u NAVER_CLIENT_ID -u NAVER_CLIENT_SECRET npm test
```

마지막 것이 CRITICAL이다 — **API 키 없이 통과해야 한다.**

### 2. CRITICAL 규칙 grep 전수

- `agents/`·`pipeline/`·`cli/`·`research/`·`lib/`·`types/`에서 `fetch(`·`@google/genai` → **0건**이어야 한다
- `services/gemini.ts`가 `RunStore`·`node:sqlite`·`lib/db`를 import하지 않는지 → **0건** (ADR-016 결정 3)
- `types/`가 `services/`·`lib/db`를 import하지 않는지
- 죽은 코드 확인: 이번에 만든 `buildLedger`·`solutionSchemaFor`·`verdictSchemaFor`·`REMEDY_*`가 전부 프로덕션 코드에서 쓰이는가

### 3. 하위호환 실데이터 검증 ★

**이 phase의 핵심 주장은 "현재 렌더되는 run은 아무것도 잃지 않는다"이다. 증명하라.**

```bash
# 사용자 DB를 읽기 전용으로 복사해서 쓴다 — 원본을 건드리지 마라
cp data/anvil.db /tmp/anvil-verify-8.db
node --disable-warning=ExperimentalWarning -e '…'
```

확인할 것:
- 최신 run 5개(`500424`, `13c0ac`, `472fc2`, `6af78e`, `d32758`)의 **verdict 5개가 정적 `VerdictSchema`를 전부 통과**한다
- 같은 run들의 **solution 5개가 정적 `SolutionSchema`를 전부 통과**한다 (`remedies` 기본값 덕분)
- 구 run 5개는 원래도 criticism이 실패했으므로 변화 없다
- **하나라도 실패하면 이 phase의 하위호환 주장이 거짓이다.** 그 경우 정직하게 기록하고 `status: "error"`로 중단하라.

### 4. 실 run 1회 ★★ — 이 phase가 실제로 작동하는지

```bash
npm run consult -- "직장인을 위한 AI 회의록 요약 서비스"
```

(`ANVIL_DB_PATH`로 스크래치 DB를 쓰라. **사용자의 `data/anvil.db`를 오염시키지 마라.**)

측정하고 `index.json` summary에 **ADR-016 "실측 결과" 형식으로** 기록할 것:

| 항목 | 기록 |
|---|---|
| **원장 커버리지** | 비판이 fatal로 판정한 항목 N건 중 해결책이 붙은 것 M건. **M = N이어야 한다** (스키마가 강제하므로). 아니면 버그다 |
| **재시도** | 원장 강제로 검증 재시도가 늘었는가? `usage` 테이블의 `attempt` 컬럼으로 확인 |
| **감사 결과 분포** | `solid` / `restated` / `dismissed` 각 몇 건인가 — **여기서 말장난 비율을 처음 관측한다** |
| **출력 토큰 델타** | `solution-designer`·`verdict`의 출력 토큰이 얼마나 늘었나. 출력은 비용의 28%다 (ADR-016) |
| **총 비용** | run당 USD. ADR-016의 기준선($0.1302)과 비교 |
| **품질** | 리포트 원문을 **사람이 읽고** 판단하라. 해결책이 구체적인가, 아니면 지어낸 말장난인가 |

### 5. 문서-코드 정합

ADR-017·ARCHITECTURE·PRD·CLAUDE.md에 적힌 것이 실제 코드와 일치하는지 대조하라. **불일치는 코드에 맞춰 문서를 정정한다** (phase 7 step 6의 선례 — ADR이 코드를 따라간다).

특히:
- ADR-017의 스키마가 `src/types/`의 실제 스키마와 글자 그대로 일치하는가
- ADR-017이 기각한 것들(floor, 감수 출구, orchestrator validator, rebuts 검증)이 정말로 코드에 없는가
- ARCHITECTURE의 데이터 흐름·패턴 목록이 맞는가

### 6. ADR-017에 "실측 결과" 절 신설

ADR-016의 선례를 따라, 위 4번의 측정치를 ADR 본문에 기록하라.

**추정이 틀렸으면 틀렸다고 적어라.** ADR-016은 자기 추정이 2.7배 틀렸음을 경고 블록으로 남겼고 그것이 이 레포의 문화다. 지우지 말고 정정하라.

## 정직하게 기록해야 할 것

- **말장난 비율이 높게 나오면 그대로 적어라.** "해결책을 의무화하면 못 풀 때 지어낸다"는 것은 ADR-017이 이미 트레이드오프로 예고한 위험이다. 관측됐다면 그것은 실패가 아니라 **예고된 관측**이다.
- **n=1이다.** 실 run 1회로는 분포를 말할 수 없다. ADR-016의 태도를 따르라 — *"방향은 일관되지만 소수점 두 자리를 신뢰하지 마라."*
- **점수가 여전히 65/75에 몰려 있어도 이 phase의 실패가 아니다.** 이 phase는 점수 해상도를 목표로 하지 않았다. 관측만 기록하라.

## 다음 phase가 볼 것 (summary에 남겨라)

- **말장난 비율이 높다면** 다음 레버는 비판의 `severity` 정의나 판정 프롬프트이지 이 구조가 아니다. 구조는 침묵을 막을 뿐 진실성을 만들지 못한다 (ADR-017).
- **자료조사 수율** — 이 phase가 건드리지 않은 별건: HN 0건(2/2 run), 목소리 선별률 11~51% 편차, grounded 형식 실패 2/4, citations 0/0/0/3. ADR-016이 지목한 1순위 레버(grounded 형식 실패율)가 아직 미착수다.

## Acceptance Criteria

```bash
npm run build && npm test && npm run lint
env -u GEMINI_API_KEY -u YOUTUBE_API_KEY -u NAVER_CLIENT_ID -u NAVER_CLIENT_SECRET npm test
```

## 검증 절차

1. 위 AC + 위 1~6번을 전부 수행한다.
2. 최종 체크리스트:
   - 최신 run 5개의 verdict·solution이 정적 스키마를 전부 통과하는가? (하위호환 증명)
   - 실 run에서 fatal 전건에 해결책이 붙었는가?
   - 판정이 `restated`·`dismissed`를 실제로 쓸 수 있는가?
   - 리포트 4절에 감사 결과가 새지 않았는가? (ADR-008)
   - ADR-017이 기각한 것들이 코드에 없는가?
   - 사용자 `data/anvil.db`가 오염되지 않았는가? (mtime 확인)
3. `phases/8-fatal-remedy/index.json`의 step 7을 업데이트한다. summary에 **실측 표 전부**를 기록하라 — 다음 phase가 이것을 근거로 판단한다.

## 금지사항

- **사용자의 `data/anvil.db`를 건드리지 마라.** 이유: 사용자의 실제 이력이다. 복사본이나 `ANVIL_DB_PATH` 스크래치 DB를 써라. 종료 시 mtime으로 확인하라.
- **측정치를 유리하게 반올림하거나 실패를 생략하지 마라.** 이유: ADR-016이 "기대(50%)에 못 미친다. 그대로 적는다"를 남긴 것이 이 레포의 문화다.
- **말장난이 관측됐다고 프롬프트를 급히 손보지 마라.** 이유: n=1이다. 관측을 기록하고 다음 phase가 근거를 갖고 판단하게 하라 — *측정하지 않고 최적화하지 않는다* (ADR-016).
- **새 기능을 추가하지 마라.** 이유: 검증 step이다. 코드 변경은 문서-코드 불일치 정정에 한한다.
- **점수 공식을 손보지 마라.** 이유: 이 phase의 scope가 아니다.
- **기존 테스트를 깨뜨리지 마라.**
