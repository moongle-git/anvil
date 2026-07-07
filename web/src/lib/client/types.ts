import type { RunDisplayStatus, RunSummary } from "@anvil/runStore";
import type {
  Criticism,
  CriticismSeverity,
  MarketContext,
  RunState,
  Solution,
} from "@anvil/types";

export type {
  Criticism,
  CriticismSeverity,
  MarketContext,
  RunDisplayStatus,
  RunState,
  RunSummary,
  Solution,
};

export interface RunDetail {
  state: RunState;
  status: RunDisplayStatus;
  context?: MarketContext;
  criticism?: Criticism;
  solution?: Solution;
  hasReport: boolean;
}

export interface RunsResponse {
  runs: RunSummary[];
}

export interface RunCreatedResponse {
  runId: string;
}
