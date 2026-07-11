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
      interview: false,
    },
    status: "completed",
    hasReport: true,
    context: {
      ideaTitle: idea,
      briefing: "요약 기능이 플랫폼 번들로 흡수되며 독립 서비스의 유료화 명분이 좁아지고 있다.",
      marketSizeIndicators: [],
      competitorInsight: "무료 티어가 시장을 지배해 요약 단독 포지션은 소진됐다.",
      voicesInsight: "사용자는 요약이 아니라 그 다음 단계(실행 추적)에 지불 의사를 남긴다.",
      trends: ["회의 요약 기능이 플랫폼 번들로 흡수되고 있다"],
      competitors: Array.from({ length: 9 }, (_, index) => ({
        name: `경쟁사 ${index + 1}`,
        description: `경쟁 서비스 설명 ${index + 1}`,
        url: `https://example.com/${index + 1}`,
        pricingHint: "무료 + 유료",
      })),
      communityVoices: [
        {
          source: "youtube",
          title: "AI 회의록 툴 후기",
          url: "https://www.youtube.com/watch?v=abc12345678",
          text: "요약보다 액션아이템 추적이 더 필요합니다.",
          authorName: "PM",
          score: 12,
        },
        {
          source: "hackernews",
          title: "Ask HN: What do you use for meeting notes?",
          url: "https://news.ycombinator.com/item?id=40000001",
          text: "Transcription is solved. Deciding who owns what is not.",
          authorName: "hn_reader",
          score: 96,
        },
        {
          source: "naver",
          title: "회의록 정리 어떻게 하시나요",
          url: "https://cafe.naver.com/pmclub/12345",
          text: "요약본은 나오는데 결정사항 추적은 결국 사람이 다시 정리해요...",
          authorName: "기획자모임",
          extra: "검색 스니펫",
        },
      ],
      painPointEvidence: ["요약 후 후속 추적은 여전히 수작업이다"],
      sources: ["https://example.com/report"],
      researchCoverage: [
        { source: "youtube", status: "collected", count: 2 },
        { source: "hackernews", status: "collected", count: 1 },
        { source: "naver", status: "unconfigured", count: 0 },
      ],
      citations: [
        {
          uri: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/aaa",
          title: "협업 도구 시장 리포트 2026",
          domain: "statista.com",
          kind: "redirect",
        },
        {
          uri: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/bbb",
          domain: "clovanote.naver.com",
          kind: "redirect",
        },
      ],
    },
    thesis: {
      points: [
        {
          id: "t1",
          axis: "painPoint",
          claim: "실행 추적 통증은 번들이 손대지 못한 영역이다",
          rationale: "가장 공감받은 댓글이 액션아이템 정리의 수작업을 지목한다.",
        },
        {
          id: "t2",
          axis: "bm",
          claim: "보안 세그먼트는 온프레미스에 지불 의사가 있다",
          rationale: "사내망 실행 요구가 반복 관찰된다.",
        },
        {
          id: "t3",
          axis: "copycat",
          claim: "한국어 회의 최적화가 진입장벽이 된다",
          rationale: "외국 툴의 결정사항 오추출 사례가 인용된다.",
        },
      ],
      revenueModel: "팀 플랜 인당 과금 + 온프레미스 라이선스.",
      growthLevers: ["조직 내부 바이럴 확산"],
      marketTailwinds: ["AI 회의 비서 시장 성장"],
      bestCaseScenario: "국내 팀 침투율을 확보해 카테고리 리더가 된다.",
      winningThesis: "요약 이후의 실행 추적이 유일한 유료 구간으로 남는다.",
    },
    criticism: {
      points: [
        {
          id: "c1",
          axis: "painPoint",
          rebuts: "t1",
          claim: "요약만으로는 구매 이유가 약하다",
          evidence: "이미 번들 기능이 많다.",
          severity: "major",
          riskScore: 55,
          riskKeyword: "번들 흡수",
        },
        {
          id: "c2",
          axis: "bm",
          claim: "단독 구독 BM이 취약하다",
          evidence: "무료 번들과 경쟁해야 한다.",
          severity: "fatal",
          riskScore: 82,
          riskKeyword: "가격 침식",
        },
        {
          id: "c3",
          axis: "copycat",
          claim: "플랫폼이 쉽게 복제할 수 있다",
          evidence: "회의 데이터 진입점을 플랫폼이 가진다.",
          severity: "minor",
          riskScore: 25,
          riskKeyword: "플랫폼 흡수",
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
      synthesis: "요약을 무료 미끼로 내주고 결정-실행 데이터로 해자를 옮긴다.",
    },
    verdict: {
      survivalScore: 58,
      recommendation: "pivot",
      headline: "실행 추적 에이전트로 피벗하면 번들 사정권 밖에서 생존할 수 있다.",
      rationale: "요약 단독은 fatal 리스크에 노출되지만 피벗이 이를 우회한다.",
      residualRisks: [
        {
          keyword: "지불 의사 미검증",
          severity: "major",
          note: "실행 추적 통증이 결제로 전환된다는 증거가 아직 없다.",
        },
      ],
      conditions: ["출시 3개월 내 파일럿 팀 10곳에서 완료율 20%p 개선을 증명한다"],
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
      interview: false,
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
      interview: false,
    },
    status: "error",
    hasReport: false,
  };
}
