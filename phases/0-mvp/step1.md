# Step 1: core-types

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `/docs/ARCHITECTURE.md`
- `/docs/ADR.md`
- `/docs/PRD.md` (리포트 출력 규격 섹션)
- `/CLAUDE.md`
- `package.json`, `tsconfig.json` (step 0 산출물)

이전 step에서 만들어진 코드를 꼼꼼히 읽고, 설계 의도를 이해한 뒤 작업하라.

## 작업

`src/types/`에 파이프라인 전체가 공유하는 zod 스키마와 타입을 TDD로 작성한다. 모든 스키마는 `z.infer`로 TypeScript 타입을 함께 export한다.

`src/types/index.ts`에서 전부 re-export하라.

### 1. `src/types/run.ts` — 실행 상태

```ts
export const PIPELINE_STEPS = ["context-hunter", "cold-critic", "solution-designer"] as const;
export type PipelineStepName = typeof PIPELINE_STEPS[number];

// StepStatus: "pending" | "completed" | "error"
// StepState: { name: PipelineStepName, status: StepStatus, startedAt?, completedAt?, failedAt?, errorMessage? }
// RunState: { runId: string, idea: string, createdAt: string(ISO), steps: StepState[], completedAt?: string }
export const RunStateSchema: z.ZodType<...>;
```

### 2. `src/types/marketContext.ts` — Context Hunter 산출물

```ts
// CompetitorService: { name, description, url?, pricingHint? }
// YoutubeVoice: { videoTitle, videoUrl, comment(원문), authorName?, likeCount? }
// MarketContext: {
//   ideaTitle: string,           // 아이디어를 한 줄 제목으로 정제한 것
//   trends: string[],            // 최신 트렌드 요약 bullet
//   competitors: CompetitorService[],
//   youtubeVoices: YoutubeVoice[], // 실제 유저 목소리 (댓글 원문 인용)
//   painPointEvidence: string[],  // 수집 데이터에서 발견된 페인포인트 근거
//   sources: string[]             // 참고한 URL 목록
// }
export const MarketContextSchema;
```

### 3. `src/types/criticism.ts` — Cold Critic 산출물

```ts
// CriticismPoint: { claim: string, evidence: string(MarketContext 근거 인용), severity: "fatal" | "major" | "minor" }
// Criticism: {
//   painPointReality: CriticismPoint[],  // 페인포인트의 허구성
//   bmWeakness: CriticismPoint[],        // 수익 모델 취약성
//   copycatRisk: CriticismPoint[],       // 카피캣 리스크
//   verdict: string                       // 종합 판정 (한 문단)
// }
export const CriticismSchema;
```

### 4. `src/types/solution.ts` — Solution Designer 산출물

```ts
// Solution: {
//   minimalInput: string,        // 최소 입력/Zero UI 구조 설명
//   agenticWorkflow: string,     // 에이전트 파이프라인 재설계 설명
//   dataFlywheel: string,        // 독점 데이터 플라이휠 설계
//   monetization: string,        // 지속 가능한 BM 제안
//   revisedConcept: string       // 재설계된 서비스 컨셉 요약
// }
export const SolutionSchema;
```

각 스키마에 대해 유효/무효 입력을 검증하는 테스트(`src/types/*.test.ts`)를 먼저 작성하라. 필드 상세(옵셔널 처리, min length 등)는 재량이되, 위 구조에서 벗어나지 마라 — 이후 step들이 이 시그니처에 의존한다.

## Acceptance Criteria

```bash
npm run build   # 컴파일 에러 없음
npm test        # 테스트 통과
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크리스트를 확인한다:
   - ARCHITECTURE.md 디렉토리 구조를 따르는가? (타입은 src/types/에만)
   - ADR 기술 스택을 벗어나지 않았는가?
   - CLAUDE.md CRITICAL 규칙(TDD)을 위반하지 않았는가?
3. 결과에 따라 `phases/0-mvp/index.json`의 해당 step을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약"`
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - 사용자 개입 필요 → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

## 금지사항

- API 호출 코드나 파이프라인 로직을 작성하지 마라. 이유: 이 step은 타입/스키마 레이어만 다룬다.
- zod 외의 검증 라이브러리를 추가하지 마라. 이유: ADR-005에서 zod로 확정했다.
- 기존 테스트를 깨뜨리지 마라
