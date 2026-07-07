import type { RunDetail, RunSummary } from "@/lib/client/types";

export const COMPLETED_A_ID = "completed-a";
export const COMPLETED_B_ID = "completed-b";
export const RUNNING_ID = "running-a";
export const ERROR_ID = "error-a";

const completedSteps = [
  {
    name: "context-hunter" as const,
    status: "completed" as const,
    startedAt: "2026-07-01T09:00:00.000Z",
    completedAt: "2026-07-01T09:01:10.000Z",
  },
  {
    name: "cold-critic" as const,
    status: "completed" as const,
    startedAt: "2026-07-01T09:01:10.000Z",
    completedAt: "2026-07-01T09:02:20.000Z",
  },
  {
    name: "solution-designer" as const,
    status: "completed" as const,
    startedAt: "2026-07-01T09:02:20.000Z",
    completedAt: "2026-07-01T09:03:30.000Z",
  },
];

export function completedSummary(
  runId = COMPLETED_A_ID,
  idea = "AI 회의록 요약 서비스",
): RunSummary {
  return {
    runId,
    idea,
    createdAt: "2026-07-01T09:00:00.000Z",
    completedAt: "2026-07-01T09:03:30.000Z",
    status: "completed",
  };
}

export function runningSummary(): RunSummary {
  return {
    runId: RUNNING_ID,
    idea: "AI 식물 관리 서비스",
    createdAt: "2026-07-03T14:00:00.000Z",
    status: "running",
  };
}

export function errorSummary(): RunSummary {
  return {
    runId: ERROR_ID,
    idea: "AI 점심 추천 서비스",
    createdAt: "2026-07-05T20:00:00.000Z",
    status: "error",
  };
}

export function completedDetail(
  runId = COMPLETED_A_ID,
  idea = "AI 회의록 요약 서비스",
): RunDetail {
  return {
    state: {
      runId,
      idea,
      createdAt: "2026-07-01T09:00:00.000Z",
      completedAt: "2026-07-01T09:03:30.000Z",
      steps: completedSteps,
    },
    status: "completed",
    hasReport: true,
    context: {
      ideaTitle: idea,
      trends: ["회의 요약 기능이 플랫폼 번들로 흡수되고 있다"],
      competitors: Array.from({ length: 9 }, (_, index) => ({
        name: `경쟁사 ${index + 1}`,
        description: `경쟁 서비스 설명 ${index + 1}`,
        url: `https://example.com/${index + 1}`,
        pricingHint: "무료 + 유료",
      })),
      youtubeVoices: [
        {
          videoTitle: "AI 회의록 툴 후기",
          videoUrl: "https://www.youtube.com/watch?v=abc12345678",
          comment: "요약보다 액션아이템 추적이 더 필요합니다.",
          authorName: "PM",
          likeCount: 12,
        },
      ],
      painPointEvidence: ["요약 후 후속 추적은 여전히 수작업이다"],
      sources: ["https://example.com/report"],
    },
    criticism: {
      painPointReality: [
        {
          claim: "요약만으로는 구매 이유가 약하다",
          evidence: "이미 번들 기능이 많다.",
          severity: "major",
        },
      ],
      bmWeakness: [
        {
          claim: "단독 구독 BM이 취약하다",
          evidence: "무료 번들과 경쟁해야 한다.",
          severity: "fatal",
        },
      ],
      copycatRisk: [
        {
          claim: "플랫폼이 쉽게 복제할 수 있다",
          evidence: "회의 데이터 진입점을 플랫폼이 가진다.",
          severity: "minor",
        },
      ],
      verdict: "요약 단독 기능은 실패 확률이 높고 실행 추적 워크플로우로 전환해야 한다.",
    },
    solution: {
      revisedConcept: "결정-실행 추적 에이전트로 재정의한다.",
      minimalInput: "캘린더 연동 한 번으로 시작한다.",
      agenticWorkflow: "회의 종료 후 담당자별 실행 상태를 추적한다.",
      dataFlywheel: "조직별 결정 이력 그래프가 축적된다.",
      monetization: "팀 플랜과 온프레미스 라이선스로 과금한다.",
    },
  };
}

export function runningDetail(): RunDetail {
  return {
    state: {
      runId: RUNNING_ID,
      idea: "AI 식물 관리 서비스",
      createdAt: "2026-07-03T14:00:00.000Z",
      steps: [
        {
          name: "context-hunter",
          status: "pending",
          startedAt: "2026-07-03T14:00:01.000Z",
        },
        { name: "cold-critic", status: "pending" },
        { name: "solution-designer", status: "pending" },
      ],
    },
    status: "running",
    hasReport: false,
  };
}

export function errorDetail(): RunDetail {
  return {
    state: {
      runId: ERROR_ID,
      idea: "AI 점심 추천 서비스",
      createdAt: "2026-07-05T20:00:00.000Z",
      steps: [
        {
          name: "context-hunter",
          status: "completed",
          startedAt: "2026-07-05T20:00:01.000Z",
          completedAt: "2026-07-05T20:01:00.000Z",
        },
        {
          name: "cold-critic",
          status: "error",
          startedAt: "2026-07-05T20:01:00.000Z",
          failedAt: "2026-07-05T20:02:00.000Z",
          errorMessage: "모델 호출 실패",
        },
        { name: "solution-designer", status: "pending" },
      ],
    },
    status: "error",
    hasReport: false,
  };
}
