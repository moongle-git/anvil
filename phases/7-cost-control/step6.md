# Step 6: final-verify

## 읽어야 할 파일

- `/docs/ADR.md` — **ADR-016** 전체. 구현이 결정을 지켰는지 대조하는 것이 이 step의 일이다.
- `/docs/ARCHITECTURE.md`, `/CLAUDE.md`
- `phases/7-cost-control/index.json` — **step 0~5의 `summary` 전부.** 특히 step 3(기준선)·step 4(thinking after)·step 5(prompt-diet after)의 실측 숫자.
- 이번 phase가 만들거나 바꾼 파일 전부: `src/lib/cost.ts`, `src/lib/db.ts`, `src/lib/runStore.ts`, `src/services/gemini.ts`, `src/services/youtube.ts`, `src/agents/*.ts`, `src/types/marketContext.ts`, `src/cli/index.ts`

## 배경

이 step은 **새 기능을 만들지 않는다.** phase 전체를 검증하고, 문서와 코드의 정합성을 맞추고, **절감 효과를 실측으로 확정한다.**

Phase 6의 `final-verify`(step 8)가 좋은 선례다 — AC 실행 + grep 전수 + 문서-코드 대조 + 죽은 코드 정리 + 전체 시나리오 수동 실행. 같은 강도로 하라.

## 작업

### 1. AC 전수

```bash
npm run build
npm test
npm run lint
env -u GEMINI_API_KEY -u YOUTUBE_API_KEY -u NAVER_CLIENT_ID -u NAVER_CLIENT_SECRET npm test   # CRITICAL 규칙 실측
```

web 워크스페이스 테스트도 돌려라 — 이번 phase는 `web/`을 건드리지 않았으므로 **전부 통과해야 한다.** 깨졌다면 `src/` 변경이 web으로 샌 것이다.

### 2. CRITICAL 규칙 전수 확인

- **외부 API 호출이 `src/services/`에만 있는가?** `src/agents/`·`src/pipeline/`·`src/cli/`·`src/research/`·`src/lib/`에서 `fetch(`나 `@google/genai` import를 grep하라.
- **`src/services/gemini.ts`가 DB를 모르는가?** `RunStore`·`node:sqlite`·`lib/db` import를 grep하라 → 0건이어야 한다 (ADR-016 결정 3).
- **`src/lib/cost.ts`가 순수 함수인가?** 외부 호출·DB·전역 상태가 없어야 한다.
- **테스트가 실제 API를 때리지 않는가?** 위 `env -u` 실행이 통과하면 실측된다.

### 3. 문서–코드 정합성

- ADR-016·ARCHITECTURE의 `usage` DDL이 `src/lib/db.ts`의 실제 DDL과 **글자 그대로 일치**하는가?
- ARCHITECTURE의 "도메인 테이블은 이 3개가 전부다" 문장이 `usage` 추가를 반영해 정정됐는가?
- `src/lib/cost.ts`의 단가표에 **출처와 확인 날짜**가 주석으로 있는가? `cost_usd`가 **추정치**임이 명시돼 있는가?
- ADR-016이 "implicit 캐싱 유보"의 근거를 적었는데, **이제 실측 데이터가 있다.** step 3~5의 usage에서 `cachedTokens`가 실제로 0이 아니었는지 확인하라:
  ```bash
  sqlite3 /tmp/anvil-baseline.db "SELECT label, SUM(cached_tokens), SUM(prompt_tokens) FROM usage GROUP BY label;"
  ```
  **`cached_tokens`가 0이 아니라면 implicit 캐싱이 이미 히트하고 있다는 뜻이다.** 이 사실을 ADR-016의 트레이드오프/후속 절에 **실측치와 함께 추가하라** — 다음 phase가 프롬프트 재배치를 할지 말지의 근거다. 0이라면 그것도 사실로 적어라.

### 4. ★ 절감 효과 확정 (이 step의 핵심 산출물)

`/tmp/anvil-baseline.db`에 step 3(before) → step 4(thinking) → step 5(prompt-diet) 세 run의 usage가 쌓여 있다. 집계하라:

```bash
sqlite3 -header -column /tmp/anvil-baseline.db "
  SELECT run_id, ROUND(SUM(cost_usd),4) cost, SUM(prompt_tokens) inp,
         SUM(output_tokens) outp, SUM(thoughts_tokens) think, COUNT(*) calls
  FROM usage GROUP BY run_id ORDER BY MIN(created_at);"
```

`summary`에 **표로** 적어라: before / thinking 적용 후 / prompt-diet 적용 후의 총 USD·입력·출력·thinking 토큰과 **절감률**.

**여기서 정직하라:**
- 추정했던 "thinking ~58%"가 실측과 다르면 **실측을 적고, 추정이 틀렸다고 적어라.** ADR-016의 추정치도 실측으로 **정정하라** — ADR은 시점의 기록이지만, **명백히 틀린 숫자를 남겨두면 다음 사람이 그것을 근거로 판단한다.**
- 절감률이 기대(50%)에 못 미치면 그대로 적고, **남은 비용이 어디에 있는지** usage 데이터로 지목하라. 그것이 다음 phase의 입력이다.
- run마다 LLM 출력이 다르므로 **1회 비교는 노이즈를 포함한다.** 시간이 허락하면 같은 아이디어로 2회씩 돌려 평균을 내라. 못 했으면 "1회 측정이라 노이즈가 있다"고 적어라.

### 5. 품질 회귀 최종 확인 (수동)

step 4·5에서 이미 봤지만, **최종 리포트를 통째로** 기준선과 비교하라. 웹 `/compare`를 쓰면 나란히 볼 수 있다.

- `coldCritic` 비판 개수와 3축(`painPoint`·`bm`·`copycat`) 분포
- `verdict` 점수·판정
- `communityVoices` 인용 개수
- **리포트를 사람이 읽었을 때 논증이 얕아졌는가?** 숫자로 안 잡히는 것을 보라. 이것이 이 도구의 전부다.

회귀가 있으면 **비용 절감을 되돌리더라도 품질을 지켜라.** 해당 에이전트의 `thinkingBudget`을 올리고 `summary`에 그 사실과 조정된 값을 적어라.

### 6. 정리

- 이번 phase가 만든 죽은 코드가 있으면 지워라.
- 산출물을 "파일"이라 서술하는 등 사실과 어긋난 주석이 새로 생겼으면 고쳐라.
- **기능을 추가하지 마라.** 검증 step에서 테스트 없이 코드를 손대는 것은 금지다(문서 정정과 명백한 죽은 코드 삭제는 예외).

## Acceptance Criteria

```bash
npm run build
npm test
npm run lint
env -u GEMINI_API_KEY -u YOUTUBE_API_KEY -u NAVER_CLIENT_ID -u NAVER_CLIENT_SECRET npm test
```

## 검증 절차

1. 위 AC를 실행한다.
2. 위 작업 1~6을 순서대로 수행한다.
3. **사용자의 실제 `data/anvil.db`와 dev 서버를 건드리지 마라.** 검증은 `ANVIL_DB_PATH` 스크래치 DB와 별도 포트로 격리하라. 끝나면 스크래치를 지우되, **`/tmp/anvil-baseline.db`의 usage 집계 결과는 `summary`에 옮겨 적은 뒤에** 지워라.
4. `phases/7-cost-control/index.json`의 step 6을 업데이트하고, `phases/index.json`의 `7-cost-control` 항목도 `completed`로 바꾼다.
   - `summary`에 반드시 담을 것: **절감 실측 표(before/after/절감률)**, thinking 비중 실측치, `cached_tokens` 실측치(implicit 캐싱 히트 여부), 품질 지표 3종, 조정한 budget이 있으면 그 값과 이유, **다음 phase가 볼 남은 비용의 소재**.

## 금지사항

- **새 기능을 만들지 마라.** 이유: 검증 step이다. 테스트 없이 코드를 손대면 검증한 것이 검증한 대상과 달라진다.
- **절감 효과를 부풀리지 마라.** 추정치(58%/8%)와 실측이 다르면 **실측을 적고 ADR-016의 추정치를 정정하라.** 이유: 이 phase의 요지가 "측정하지 않고 최적화하지 말라"이다. 그 phase가 추측으로 자기 성과를 보고하면 자기모순이다.
- **품질 회귀를 비용 절감으로 정당화하지 마라.** 이유: 이 도구는 컨설팅 리포트의 질이 전부다. 회귀가 있으면 budget을 올리고 절감을 포기하라.
- **사용자의 `data/anvil.db`에 검증 run을 쓰지 마라.** `ANVIL_DB_PATH`로 격리하라.
- 기존 테스트를 깨뜨리지 마라.
