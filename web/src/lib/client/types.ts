import type { RunDisplayStatus, RunSummary } from "@anvil/runStore";
import type {
  Criticism,
  CriticismPoint,
  CriticismSeverity,
  DialecticAxis,
  InterviewQuestions,
  MarketContext,
  RunState,
  Solution,
  Thesis,
  ThesisPoint,
  Verdict,
} from "@anvil/types";

// 도메인 타입은 루트 src/types가 단일 소스다 (ADR-005/006). 여기서는 재export만 한다.
export type {
  Criticism,
  CriticismPoint,
  CriticismSeverity,
  DialecticAxis,
  InterviewQuestions,
  MarketContext,
  RunDisplayStatus,
  RunState,
  RunSummary,
  Solution,
  Thesis,
  ThesisPoint,
  Verdict,
};

/** server/runs.ts의 RunDetail과 같은 모양이어야 한다 — /api/runs/{id}의 응답 본문이다 */
export interface RunDetail {
  state: RunState;
  status: RunDisplayStatus;
  questions?: InterviewQuestions;
  context?: MarketContext;
  thesis?: Thesis;
  criticism?: Criticism;
  solution?: Solution;
  verdict?: Verdict;
  hasReport: boolean;
}

export interface RunsResponse {
  runs: RunSummary[];
}

export interface RunCreatedResponse {
  runId: string;
}
