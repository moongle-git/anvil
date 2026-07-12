# Step 5: prompt-diet

## 읽어야 할 파일

- `/docs/ADR.md` — **ADR-016**(하류 프롬프트만 줄이고 저장 아티팩트는 그대로 둔다)과 **ADR-013**(`sources[]`와 `citations[]`의 상보성 — 왜 `sources`를 **스키마에서 지우면 안 되는가**). ADR-013을 오해하면 이 step에서 리포트를 망가뜨린다.
- `/docs/ARCHITECTURE.md` — "출처는 사실이다" 패턴
- `src/types/marketContext.ts` — `toPromptContext`(`:157`). **`citations`만 벗기고 있다.** 그 옆에 `sources`를 추가하는 것이 이 step의 1번 작업이다. `:153-155` 주석이 "sources는 남긴다"고 정당화하고 있으니 그 주석도 함께 갱신하라.
- `src/agents/thesis.ts:59-62`, `coldCritic.ts:85-87`, `solutionDesigner.ts:71-74`, `verdict.ts:88-92` — `JSON.stringify(x, null, 2)` 호출부 4곳
- `src/services/hackerNews.ts:18` — HN의 1,200자 댓글 컷. **이것을 YouTube에 이식한다.**
- `src/services/youtube.ts:146-151` — 댓글 수집부. 길이 상한이 **없다.**
- `src/lib/report.ts` — **`sources`를 쓴다.** 저장 아티팩트에서 `sources`를 지우면 여기가 깨진다.

## 배경

실측(`data/anvil.db` 9개 run):

- `context` JSON 하나가 하류 4개 콜(`thesis`·`cold-critic`·`solution-designer`·`verdict`)에 **바이트 동일하게 재전송**된다 → **52,824자**, 하류 프롬프트 입력의 **71%**.
- 그 `context`의 구성: `communityVoices` **39.8%** + `sources` **33.7%** + 나머지 26.5%.
- **`sources`(LLM 자기보고 URL 문자열, 4,449자)는 正/反/合/판정 어느 에이전트도 논증에 쓰지 않는다.** 4번 재전송되어 17,796자를 차지한다.
- YouTube 댓글에는 **길이 상한이 없다**(HN은 1,200자 컷이 있다) → 파이프라인 최대 프롬프트의 **상한이 열려 있다.** 장문 댓글 50개가 걸리면 프롬프트가 무제한 팽창한다. 비용 문제이자 **견고성 문제**다.

**입력 토큰은 전체 비용의 ~8%로 추정된다**(step 3의 기준선이 확정해준다). 즉 이 step은 step 4보다 절감폭이 작다. 그럼에도 하는 이유는 (a) 공짜에 가깝고 품질 리스크가 없으며, (b) YouTube 상한 부재는 **비용과 무관하게 고쳐야 할 결함**이기 때문이다. **절감 효과를 부풀려 적지 마라.**

## 작업

### 1. `toPromptContext`가 `sources`도 벗긴다

`src/types/marketContext.ts:157`. 현재 `citations`만 제거하고 있다. `sources`를 추가하라.

근거: `sources`는 하류 논증에 쓰이지 않는데 context의 33.7%를 차지하고 4번 재전송된다. ADR-013이 이미 `sources`의 **링크를 박탈**했다(LLM 자기보고라 60%가 죽은 URL이다) — 하류 프롬프트에서 빼는 것은 그 판단의 자연스러운 연장이다.

`:153-155`의 "sources는 남긴다"는 주석을 **갱신하라.** 왜 남겼었고 왜 이제 빼는지를 적어라.

### 2. 하류 프롬프트의 pretty-print 제거

`thesis.ts`·`coldCritic.ts`·`solutionDesigner.ts`·`verdict.ts`의 `JSON.stringify(x, null, 2)` → `JSON.stringify(x)`.

들여쓰기 공백과 줄바꿈이 그대로 입력 토큰으로 과금된다. LLM은 minify된 JSON을 읽는 데 아무 문제가 없다.

**contextHunter의 프롬프트 JSON 예시 블록은 건드리지 마라.** grounded 모드는 `responseSchema`를 못 써서 **프롬프트의 JSON 예시가 유일한 형식 지시**다(ADR-012). 그것을 minify하면 형식 실패율이 오른다 — 재시도가 늘어 오히려 비싸진다.

### 3. YouTube 댓글 길이 상한

`src/services/youtube.ts`에 댓글 길이 상한을 넣어라. **`hackerNews.ts:18`과 같은 규칙**(1,200자 초과 시 자르지 않고 **통째로 버린다**)을 쓰되, 상수는 YouTube 파일에 따로 두고 이름을 붙여라.

**자르지 말고 버려라.** 이유: HN이 이미 그렇게 하고 있고(일관성), 잘린 인용문은 `communityVoices`에 그대로 실려 리포트에 인용된다 — **잘린 문장을 인용으로 싣는 것은 원문을 왜곡하는 것이다**(`src/research/format.ts:30`의 "요약본을 인용으로 실으면 리포트가 거짓말을 한다"와 같은 논리).

### 4. 테스트

- `src/types/marketContext.test.ts`: `toPromptContext`가 `sources`와 `citations`를 **둘 다** 제거하고 나머지는 보존한다.
- **★ `src/lib/report.test.ts`: 저장된 `context` 아티팩트의 `sources`가 리포트에 여전히 렌더된다.** 이 테스트가 이 step의 안전벨트다 — `toPromptContext`와 저장 아티팩트를 혼동하면 여기서 잡힌다.
- 각 에이전트 테스트: 프롬프트에 `sources` URL 문자열이 들어가지 않는다.
- `src/services/youtube.test.ts`: 1,200자를 넘는 댓글이 **버려진다**(잘려서 포함되는 게 아니다). 경계값(정확히 1,200자)도 테스트하라.

## Acceptance Criteria

```bash
npm run build
npm test
npm run lint
env -u GEMINI_API_KEY -u YOUTUBE_API_KEY -u NAVER_CLIENT_ID -u NAVER_CLIENT_SECRET npm test
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. **★ 저장된 아티팩트가 온전한지 확인하라.** `data/anvil.db`의 기존 완료 run 하나를 골라 리포트를 렌더하고, **`sources` 섹션이 그대로 나오는지** 눈으로 확인하라. 웹 UI(`npm run web`)의 리포트 뷰에서도 확인하라. 사라졌다면 `toPromptContext`를 저장 경로에 잘못 끼워 넣은 것이다 — **즉시 되돌려라.**
3. **실제 API로 측정**: step 3·4와 **같은 아이디어**로 같은 스크래치 DB에 돌려라.
   ```bash
   ANVIL_DB_PATH=/tmp/anvil-baseline.db npm run consult -- "직장인을 위한 AI 회의록 요약 서비스" 2>&1 >/dev/null | tail -30
   ```
   `summary`에 **입력 토큰의 before/after**를 적어라. 절감폭이 작을 것으로 예상된다 — **작으면 작다고 적어라.**
4. 품질 확인: `communityVoices` 인용 개수와 `coldCritic` 비판 개수가 step 4 대비 유지되는가? (`sources`를 뺐다고 논증이 얕아졌다면 그 사실을 적고 되돌려라)
5. 아키텍처 체크리스트:
   - **저장되는 `context` 아티팩트에 `sources`가 여전히 있는가?** (반드시 있어야 한다)
   - `report.ts`가 여전히 `sources`를 렌더하는가?
   - contextHunter의 JSON 예시 블록을 minify하지 않았는가?
6. `phases/7-cost-control/index.json`의 step 5를 업데이트한다.

## 금지사항

- **저장되는 `context` 아티팩트에서 `sources`를 지우지 마라.** 이유: ADR-013이 `sources`와 `citations`의 **상보성**을 근거로 공존을 결정했고(자기보고는 부정확하지만 만료되지 않고, 인용은 정확하지만 만료된다), `src/lib/report.ts`와 웹 리포트 뷰가 `sources`를 렌더한다. **이번에 바뀌는 것은 "하류 프롬프트에 넣지 않는다"뿐이다.** `MarketContextSchema`에서 `sources`를 제거하는 것은 명백한 위반이다.
- **`communityVoices`의 원문을 자르거나 요약하지 마라.** 이유: `src/research/format.ts:30` — "요약본을 인용으로 실으면 리포트가 거짓말을 한다." 하류 에이전트는 이 원문을 페인포인트 논증의 **증거**로 쓴다. 이것을 줄이면 비용은 줄지만 리포트의 근거가 사라진다.
- **YouTube 댓글을 잘라서(truncate) 포함하지 마라.** 버려라(drop). 이유: 잘린 문장이 `communityVoices`에 실려 리포트에 인용된다. 원문 왜곡이다.
- **contextHunter의 프롬프트 JSON 예시를 minify하지 마라.** 이유: grounded 모드는 `responseSchema`를 쓸 수 없어 프롬프트의 JSON 예시가 **유일한 형식 지시**다(ADR-012). 형식 실패율이 오르면 재시도가 늘어 오히려 비싸진다.
- **`thinkingBudget`을 조정하지 마라.** 이유: step 4에서 확정했다. 두 변수를 동시에 움직이면 무엇이 효과를 냈는지 분리할 수 없다.
- 기존 테스트를 깨뜨리지 마라.
