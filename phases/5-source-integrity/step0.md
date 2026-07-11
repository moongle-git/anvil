# Step 0: design-docs

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `/docs/ADR.md` — 특히 **ADR-012**(자료조사 다중 소스 확장 + grounding 인용 코드 추출). 이번 phase는 ADR-012를 부분 갱신한다.
- `/docs/ARCHITECTURE.md` — 디렉토리 구조, 데이터 흐름, `runs/{run-id}/` 산출물 목록
- `/CLAUDE.md` — CRITICAL 규칙
- `src/types/marketContext.ts` — `CitationSchema`, `CommunityVoiceSchema`, `CODE_INJECTED_CONTEXT_KEYS`
- `src/services/gemini.ts` — `extractCitations`, `generateValidated`, `generateGrounded`

## 배경 — 이 phase가 존재하는 이유

실제 산출물 8개 run을 전수조사하고 URL을 라이브로 HTTP 검증한 결과, 리포트의 출처가 신뢰할 수 없다는 것이 확인됐다.

| 확인 항목 | 실측 결과 |
|---|---|
| YouTube 영상 ID 실존 여부 | 10/10 실존 (200) — 수집 계층 자체는 정상 |
| 8개 run 중 네이버 커뮤니티 인용 | **0건** (`.env`에 `NAVER_CLIENT_SECRET` 누락으로 소스 미등록) |
| 8개 run의 `citations[]` (코드가 추출하는 유일한 검증 필드) | **전부 0건** |
| 경쟁사 URL 89개 도달성 | **53개(60%) 사망** |

원인은 세 가지다.

1. **`citations[]`가 항상 비어 있다.** `generateValidated`(`src/services/gemini.ts`)는 **검증에 성공한 시도의 response만** 반환한다. grounding 모드는 `responseSchema`를 못 써서 자유 텍스트 → `extractJsonText` → zod 검증 경로라 1차 시도 실패가 잦은데, 재시도는 `[교정 요청]` 프롬프트라 모델이 **새 검색을 하지 않는다**. 따라서 최종 response에 `groundingMetadata`가 없고 `citations`는 빈 배열이 된다. `src/services/gemini.test.ts`에는 이 폐기 동작을 *의도된 것*으로 못박은 테스트가 있다("1차는 JSON 형식 실패 — 그 시도의 groundingMetadata(A)는 함께 버려져야 한다").

2. **수집한 진짜 증거가 디스크에 저장되지 않는다.** `collectAll()`의 결과는 프롬프트 문자열로 포맷되어 LLM에 들어간 뒤 버려진다. `runContextHunter`의 `return { ...data, citations }`에서 `data`는 **LLM의 초안**이다. 즉 `context.json`의 `communityVoices`는 수집된 증거가 아니라 **LLM이 다시 받아적은 것**이다.

3. **LLM이 URL을 타이핑한다.** 스모킹건 — 실제 산출물에 이런 문자열이 저장돼 있다:
   ```
   https://vertexaisearch.cloud.google.google.com/grounding-api-redirect/AUZIYQEe... [4] 10 Best AI Meeting Assistants and Note-Takers in 2026 - We360.ai
   ```
   도메인에 `.google`이 중복됐고(같은 파일의 나머지 29개는 정상), URL·각주번호·제목이 한 문자열로 뭉개져 있다. **코드가 API 응답에서 주입한 URL은 오타가 날 수 없다.**

## 작업

**코드는 절대 건드리지 않는다. 문서만 수정한다.**

### 1. `docs/ADR.md`에 ADR-013 추가

기존 ADR들의 서술 톤과 구조(**결정 / 이유 / 뒤집는 결정 / 기각한 대안 / 트레이드오프 / 하위호환**)를 그대로 따르라. ADR-012 바로 아래에 붙인다.

제목: `### ADR-013: 출처를 판단이 아니라 사실로 만든다 — 코드 주입 인용과 링크 박탈`

담아야 할 결정 4가지:

- **`communityVoices[]`를 코드 주입 필드로 전환한다.** LLM은 증거 ID(`V1`, `V2`…)만 선택하고 코드가 실제 `CommunityVoice` 객체로 치환한다. `CODE_INJECTED_CONTEXT_KEYS`에 `communityVoices`가 추가된다. 근거 — `citations`에 이미 적용된 원칙("LLM에게 인용을 채우라고 하면 URL을 지어낸다", `marketContext.ts`)을 인용문에도 적용하는 것뿐이다. LLM의 판단(어느 목소리가 유의미한가)은 남기되, 사실(그 목소리의 원문·출처·작성자)은 코드가 소유한다.

- **재시도 간 grounding 메타데이터를 누적한다.** 실패한 시도의 `groundingMetadata`를 버리는 현행 동작을 뒤집는다. 폐기의 명분(검증된 본문과 인용의 대응 유지)보다, 그 결과로 **인용이 0건이 되어 환각 필드만 살아남는 실패**가 압도적으로 나쁘다. `citations[]`는 문장별 각주가 아니라 "grounding이 실제로 무엇을 가져왔는가"의 **run 단위 기록**이므로 누적이 더 정직하다.

- **검증되지 않은 URL의 링크를 박탈한다.** `sources[]`·`competitors[].url`은 LLM 자기보고이므로 텍스트로만 표시하고 `href`를 걸지 않는다. 클릭 가능한 링크는 코드가 주입한 `citations[]`와 `communityVoices[]`뿐이다. 근거 — 실측 사망률 60%. 사용자가 링크를 클릭한다는 것은 그 URL이 검증됐다고 믿는다는 뜻이다. 형식만 맞는 URL에 `href`를 거는 것은 거짓 신호다.

- **`CitationSchema`에 `kind` 판별자를 추가한다.** `urlContextMetadata.retrievedUrl`은 원본 URL(`origin`)이고 `groundingChunks[].web.uri`는 만료되는 리다이렉트(`redirect`)다. 지금은 한 배열에 섞여 있어 **가장 강한 인용과 반드시 깨질 인용을 구분할 수 없다.**

**뒤집는 결정** 절에는 ADR-012의 어느 부분을 갱신하는지 명시하라: ADR-012는 "`citations[]`와 `sources[]`는 실패 모드가 상보적이므로 공존한다"고 했다. **공존 자체는 유지한다** — 다만 실전에서 `citations`가 8/8 run 전부 비면서 공존이 아니라 *환각 필드만 살아남는 구조*가 됐다. 상보성은 두 필드가 **둘 다 채워질 때만** 성립한다. 따라서 (a) citations를 실제로 채우고, (b) 자기보고 필드의 링크를 박탈해 둘의 신뢰도 차이를 렌더링에서 드러낸다.

**트레이드오프**로 적을 것: LLM이 수집 증거에 없는 목소리를 인용하고 싶어도 못 한다(그것이 목적이다). `sources[]`가 링크가 아니게 되어 독자가 URL을 직접 복사해야 한다. 재시도 시 누적된 citations는 최종 본문에 대응하지 않는 인용을 포함할 수 있다 — run 단위 기록이라는 재정의로 이를 수용한다.

### 2. `docs/ARCHITECTURE.md` 갱신

- `runs/{run-id}/` 구조 목록에 `research.json` 추가. 설명: `수집된 원시 증거 (ResearchEvidence) — voices[] + 소스별 coverage[]. context.json의 communityVoices는 이 파일의 부분집합이어야 한다`. `context.json` 바로 위에 배치하라(수집이 먼저다).
- **데이터 흐름** 다이어그램의 `step: context-hunter` 블록을 갱신: `collectAll` 결과가 `research.json`으로 영속화되고, LLM은 voice ID만 선택하며, 코드가 `communityVoices`를 주입한다는 것이 드러나야 한다.
- **패턴** 절에 항목 추가: `**출처는 사실이다** (ADR-013) — 클릭 가능한 링크로 렌더되는 URL은 코드가 API 응답에서 주입한 것뿐이다(citations, communityVoices). LLM이 타이핑한 URL(sources[], competitors[].url)은 텍스트로만 표시한다.`

## Acceptance Criteria

```bash
npm run build   # 컴파일 에러 없음
npm test        # 테스트 통과
git diff --name-only   # docs/ADR.md, docs/ARCHITECTURE.md 만 나와야 한다
```

## 검증 절차

1. 위 AC 커맨드를 실행한다. 코드 무변경이므로 build·test는 당연히 통과해야 한다 — 통과하지 않으면 문서 외의 파일을 건드린 것이다.
2. `git diff --name-only`에 `docs/` 밖의 파일이 하나라도 있으면 되돌려라.
3. 아키텍처 체크리스트:
   - ADR-013이 ADR-012와 모순되지 않고, 어느 부분을 갱신하는지 명시했는가?
   - ARCHITECTURE.md의 `runs/` 구조와 데이터 흐름이 이후 step의 구현 계획과 일치하는가?
4. 결과에 따라 `phases/5-source-integrity/index.json`의 step 0을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약"`
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`

## 금지사항

- **코드를 수정하지 마라.** 이유: 이 step의 산출물은 이후 6개 step의 가드레일이다. 문서와 코드를 같은 step에서 바꾸면 무엇이 설계이고 무엇이 구현인지 분리되지 않는다.
- ADR-012를 삭제하거나 재작성하지 마라. 이유: ADR은 append-only 기록이다. 갱신은 새 ADR이 "뒤집는 결정" 절에서 명시하는 방식으로만 한다 (ADR-008·ADR-012의 선례를 따르라).
- `sources[]` 필드를 스키마에서 제거하자고 문서에 적지 마라. 이유: ADR-012의 상보성 논거는 여전히 유효하다 — 자기보고는 부정확하지만 만료되지 않는다. 제거가 아니라 **링크 박탈**이 이번 결정이다.
- 기존 테스트를 깨뜨리지 마라.
