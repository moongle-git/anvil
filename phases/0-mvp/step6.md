# Step 6: agent-cold-critic

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `/docs/PRD.md` (핵심 기능 2: Cold Critic)
- `/docs/ARCHITECTURE.md`
- `/CLAUDE.md`
- `src/types/criticism.ts`, `src/types/marketContext.ts` (step 1 산출물)
- `src/agents/contextHunter.ts` (step 5 산출물 — 에이전트 구조/프롬프트 상수 스타일 참고)

이전 step에서 만들어진 코드를 꼼꼼히 읽고, 설계 의도를 이해한 뒤 작업하라.

## 작업

`src/agents/coldCritic.ts`에 두 번째 에이전트를 TDD로 작성한다. MarketContext를 근거로 아이디어를 매섭게 비판해 Criticism을 만든다.

```ts
export interface ColdCriticDeps {
  gemini: GeminiService;
}

export async function runColdCritic(deps: ColdCriticDeps, idea: string, context: MarketContext): Promise<Criticism>;
```

`gemini.generateStructured`를 `useGrounding: false`(순수 추론)로 호출한다. 이 step의 핵심 산출물은 **페르소나 프롬프트**다. 시스템 프롬프트에 다음 요소를 반드시 담아라:

1. **페르소나**: 20년 경력의 냉혹한 시장 분석가. 창업자의 감정을 배려하지 않는다. 근거 없는 긍정, 위로, "하지만 잘하면 될 수도 있다"류의 완충 표현을 절대 사용하지 않는다. 차가운 현실주의를 유지한다.
2. **3축 비판 기준** (Criticism 스키마의 3개 필드에 대응):
   - 페인포인트의 허구성 — "이게 정말 존재하는 페인포인트인가? 상상 속의 불편함 아닌가?"
   - 수익 모델(BM)의 취약성 — "사용자가 진정으로 돈을 지불할 용의(Willingness to Pay)가 있는 영역인가?"
   - 카피캣 리스크 — "대기업이나 기존 LLM Wrapper가 API 업데이트 한 번으로 카피할 수 있는 수준 아닌가?"
3. **근거 인용 강제**: 모든 CriticismPoint의 evidence 필드는 전달받은 MarketContext의 실제 데이터(경쟁 서비스, 유저 댓글, 트렌드)를 인용해야 한다. "일반적으로 그렇다"식의 근거 없는 주장은 금지한다고 명시하라.
4. **severity 판정 기준**: fatal(사업 성립 불가) / major(구조 변경 필요) / minor(보완 가능)의 판정 기준을 프롬프트에 정의하라.

핵심 규칙 (설계 의도 — 반드시 지켜라):

- 프롬프트는 한국어, 파일 상단 명명된 상수로 분리.
- 유저 프롬프트에는 아이디어 원문과 MarketContext 전체(JSON 직렬화)를 포함하라. 데이터를 요약·생략해서 전달하면 근거 인용이 불가능해진다.

테스트: GeminiService fake를 주입해 (1) 시스템 프롬프트에 3축 기준·근거 인용 강제 문구가 포함되는지, (2) 유저 프롬프트에 MarketContext 데이터가 유실 없이 직렬화되는지, (3) 반환값이 Criticism 타입인지 검증하라.

## Acceptance Criteria

```bash
npm run build   # 컴파일 에러 없음
npm test        # 테스트 통과 (실제 API 호출 없이)
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크리스트를 확인한다:
   - ARCHITECTURE.md 디렉토리 구조를 따르는가?
   - ADR 기술 스택을 벗어나지 않았는가?
   - CLAUDE.md CRITICAL 규칙(외부 API 직접 호출 금지, TDD)을 위반하지 않았는가?
3. 결과에 따라 `phases/0-mvp/index.json`의 해당 step을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약"`
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - 사용자 개입 필요 → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

## 금지사항

- grounding(웹검색)을 켜지 마라. 이유: 이 에이전트는 이미 수집된 MarketContext만을 근거로 추론해야 하며, 검색을 켜면 근거의 출처가 state 파일과 어긋나 재현성이 깨진다.
- 비판을 완화하는 후처리(톤 조절 등)를 넣지 마라. 이유: PRD가 요구하는 것은 매서운 비판이다. 페르소나가 산출물의 가치다.
- agents/에서 fetch나 @google/genai를 직접 import하지 마라. 이유: CLAUDE.md CRITICAL.
- 기존 테스트를 깨뜨리지 마라
