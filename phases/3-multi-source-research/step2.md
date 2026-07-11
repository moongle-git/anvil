# Step 2: html-util

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `/CLAUDE.md`
- `/docs/ADR.md` — **철학: "외부 의존성 최소화"**. ADR-009가 차트 라이브러리를 기각한 선례
- `/docs/ARCHITECTURE.md` — 디렉토리 구조의 `lib/`
- `/src/services/withTimeout.ts` — `src/`의 작고 순수한 유틸이 어떻게 생겼는지 보여주는 예시(21줄)
- `/package.json` — 의존성이 `@google/genai`, `dotenv`, `zod` **3개뿐**임을 확인하라

## 배경

step 3(Hacker News)과 step 4(네이버)가 가져올 데이터에는 **HTML이 섞여 온다.**

- **Hacker News**: `comment_text` 필드가 통째로 HTML이다. `<p>`, `<i>`, `<a href="...">`, `<pre><code>`와
  엔티티 `&#x27;` `&quot;` `&gt;` `&amp;`가 그대로 들어온다.
- **네이버 검색 API**: `title`과 `description`에 검색어 하이라이트용 `<b>` 태그가 박혀 나오고, 엔티티도 섞인다.

이 원문이 정제 없이 LLM 프롬프트와 리포트 인용문으로 들어가면 `&#x27;t work`, `<b>회의록</b>` 같은 쓰레기가
사용자에게 그대로 노출된다.

**파서 라이브러리를 새로 들이지 않는다** (cheerio, jsdom, html-entities 전부 금지). ADR 철학이 외부 의존성
최소화이고, 현재 런타임 의존성은 3개뿐이다. 우리가 다루는 건 임의의 HTML 문서가 아니라 **두 API가 뱉는
좁고 예측 가능한 인라인 마크업**이라 정규식 기반 유틸로 충분하다.

이 step은 **완전히 독립적이다.** 다른 어떤 파일도 수정하지 않는다.

## 작업

### `src/lib/html.ts` (신설)

```ts
/**
 * HTML 태그를 제거하고 엔티티를 디코드해 평문으로 만든다.
 * Hacker News의 comment_text(HTML 본문)와 네이버 검색 API의 <b> 하이라이트를 정제하는 데 쓴다.
 * 임의의 HTML 문서를 위한 범용 파서가 아니다 — 두 API가 뱉는 인라인 마크업만 다룬다.
 */
export function stripHtml(input: string): string;
```

**반드시 지켜야 할 처리 순서와 규칙:**

1. **블록 경계를 개행으로 보존한다.** `<br>`, `<br/>`, `</p>`, `</div>`는 개행으로 치환한다.
   HN 댓글은 `<p>`로 문단이 나뉘는데, 이걸 그냥 지우면 여러 문단이 한 줄로 뭉개진다.
2. **나머지 태그는 제거한다.** `<[^>]*>` 패턴.
3. **엔티티를 디코드한다.** 최소한 아래를 처리하라:
   `&lt;` `&gt;` `&quot;` `&#39;` `&#x27;` `&apos;` `&nbsp;` `&#x2F;` `&#47;`
   숫자 엔티티(`&#\d+;`, `&#x[0-9a-fA-F]+;`)를 일반적으로 처리하면 더 좋다.
4. **★ `&amp;`는 반드시 마지막에 디코드하라.**
   이유: `&amp;lt;`(= 화면에 문자 그대로 `&lt;`를 보여주려는 이스케이프)를 먼저 `&lt;`로 바꾸면
   그다음 규칙이 그걸 다시 `<`로 바꿔 **이중 디코드**가 일어난다. 원문이 왜곡된다.
5. **공백을 정규화한다.** 3개 이상 연속된 개행은 2개로 줄이고, 각 줄의 trailing 공백을 없애고,
   전체를 `trim()`한다.
6. 빈 문자열 입력은 빈 문자열을 반환한다. **절대 throw하지 않는다.**

`src/lib/` 안에 두는 이유: `services/`는 외부 API 호출 전용이고(CLAUDE.md CRITICAL), 이건 순수 문자열 함수다.
**`fs`·`path`·네트워크를 import하지 마라 — 순수 함수여야 한다.**

## 테스트 (TDD — 먼저 작성한다)

### `src/lib/html.test.ts` (신설)

- `<b>회의록</b> 요약` → `회의록 요약` (네이버 하이라이트)
- `&quot;` `&#x27;` `&#39;` `&gt;` `&lt;` `&nbsp;` 디코드
- **★ 이중 디코드 방지**: `&amp;lt;` → `&lt;` (`<`가 **아니다**). 이 테스트가 이 유틸의 핵심 계약이다.
- `&amp;amp;` → `&amp;`
- `<p>첫 문단</p><p>둘째 문단</p>` → 두 문단이 **개행으로 분리**된다 (한 줄로 뭉개지지 않는다)
- `줄1<br>줄2` → 개행 분리
- `<a href="https://x.com">링크</a>` → `링크` (URL은 사라진다)
- `<pre><code>const x = 1;</code></pre>` → 코드 텍스트만 남는다
- 3개 이상 연속 개행 → 2개로 정규화
- 빈 문자열 → 빈 문자열 (no-throw)
- 태그·엔티티가 전혀 없는 평문 → **입력 그대로** (불필요한 변형 금지)
- 순수성: 같은 입력 → 같은 출력

## Acceptance Criteria

```bash
npm run build
npm test
npm run lint
git diff --name-only    # src/lib/html.ts, src/lib/html.test.ts 2개만 나와야 한다
grep -c "" package.json  # 의존성이 늘지 않았는지 눈으로 확인 — cheerio/jsdom/html-entities 추가 금지
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. `git diff --name-only`가 정확히 2개 파일만 보여주는지 확인한다. `package.json`이 나오면 실패다.
3. 아키텍처 체크리스트:
   - `src/lib/html.ts`가 순수 함수인가? (`fs`/`path`/네트워크 import 0)
   - 새 런타임 의존성이 0개인가? (ADR 철학 — 외부 의존성 최소화)
   - 테스트가 API 키 없이 통과하는가?
4. 결과에 따라 `phases/3-multi-source-research/index.json`의 step 2를 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "..."`
     (요약에 `stripHtml`의 정확한 시그니처와 파일 경로를 포함하라. step 3·4가 이 함수를 import한다.)
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "..."`
   - 사용자 개입 필요 → `"status": "blocked"`, `"blocked_reason": "..."` 후 즉시 중단

## 금지사항

- **HTML 파서 라이브러리를 설치하지 마라** (cheerio, jsdom, node-html-parser, html-entities, he 등).
  이유: ADR 철학이 외부 의존성 최소화이고, 현재 런타임 의존성은 `@google/genai`·`dotenv`·`zod` 3개뿐이다.
  우리가 다루는 건 임의의 HTML 문서가 아니라 두 API가 뱉는 좁은 인라인 마크업이다.
- **`&amp;`를 다른 엔티티보다 먼저 디코드하지 마라.** 이유: `&amp;lt;`가 `&lt;` → `<`로 **이중 디코드**되어
  원문이 왜곡된다. `&amp;`는 항상 마지막이다.
- **`<p>`/`<br>`를 그냥 지우지 마라.** 이유: HN 댓글은 문단이 `<p>`로 나뉜다. 지우기만 하면 여러 문단이
  한 줄로 뭉개져서 "원문 그대로 인용"이라는 리포트 계약이 깨진다. 개행으로 치환하라.
- **입력을 자르거나(truncate) 요약하지 마라.** 이유: 길이 제한은 각 서비스(step 3·4)의 정책이지
  이 유틸의 일이 아니다. `stripHtml`은 길이를 바꾸는 변환만 하고 내용을 버리지 않는다.
- **다른 파일을 수정하지 마라.** 이유: 이 step은 완전히 독립적이다. 소비자는 step 3·4가 붙인다.
- 기존 테스트를 깨뜨리지 마라.
