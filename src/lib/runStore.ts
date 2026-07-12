import crypto from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { z } from "zod";
import {
  InterviewAnswersSchema,
  InterviewQuestionsSchema,
  PIPELINE_STEPS,
  ResearchEvidenceSchema,
  RunStateSchema,
  type InterviewAnswers,
  type InterviewQuestions,
  type PipelineStepName,
  type ResearchEvidence,
  type RunState,
  type StepState,
} from "../types/index.js";
import { openDb, type ArtifactKind } from "./db.js";

/** step 산출물이 저장되는 artifacts.kind (ADR-014) */
export const STEP_ARTIFACT_KINDS: Record<PipelineStepName, ArtifactKind> = {
  interviewer: "questions",
  "context-hunter": "context",
  thesis: "thesis",
  "cold-critic": "criticism",
  "solution-designer": "solution",
  verdict: "verdict",
};

// 아래 셋은 step 산출물이 아니므로 STEP_ARTIFACT_KINDS에 넣지 않는다 —
// 넣으면 PipelineStepName과의 1:1 대응이 깨져 resume 판정·웹 진행 뷰까지 파급된다.
// answers는 사람이 제출하는 아티팩트고, research는 context-hunter의 부산물이며(ADR-013),
// report는 파이프라인 종료 후 렌더링된 결과물이다.
const ANSWERS_KIND: ArtifactKind = "answers";
const RESEARCH_KIND: ArtifactKind = "research";
const REPORT_KIND: ArtifactKind = "report";

// runs.updated_at이 이 시간보다 오래 갱신되지 않으면 실행 프로세스가 죽은 것으로 간주한다
// (PRD "run 상태 파생 규칙"). executeStep은 step 실행 중에 아무것도 쓰지 않으므로, 이 값은
// 가장 긴 step보다 커야 한다 — context-hunter는 다중 소스 수집 + grounding·urlContext 왕복으로
// 최악 6분이 걸린다 (ADR-012).
const STALLED_THRESHOLD_MS = 15 * 60 * 1000;

/** 존재하지 않는(또는 삭제된) run에 대한 접근. saveRun의 UPDATE-only 불변식이 이걸로 좀비를 막는다 (ADR-015) */
export class RunNotFoundError extends Error {
  constructor(readonly runId: string) {
    super(`Run not found: ${runId}`);
    this.name = "RunNotFoundError";
  }
}

export type RunDisplayStatus =
  | "completed"
  | "error"
  | "waiting"
  | "running"
  | "stalled";

export interface RunSummary {
  runId: string;
  idea: string;
  createdAt: string;
  completedAt?: string;
  status: RunDisplayStatus;
  /** 재실행으로 생긴 run이면 원본 run_id. 원본이 삭제되면 끊긴다 (ON DELETE SET NULL) */
  rerunOf?: string;
}

export interface ListRunsOptions {
  /** idea 키워드. 빈 문자열·공백은 필터가 없는 것과 같다 */
  q?: string;
  /** stalled 판정의 기준 시각 (테스트 주입용) */
  nowMs?: number;
}

/** LIKE의 와일드카드(%·_)를 리터럴로 만든다 — 사용자가 친 "100%"가 "아무거나"가 되면 안 된다 */
function likePattern(q: string): string {
  return `%${q.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
}

/**
 * run의 표시 상태를 파생한다. 상태 판정의 유일한 권위다 —
 * SQL WHERE 절로 복제하지 마라. 두 곳에 있으면 반드시 갈라진다.
 *
 * updatedAtMs는 runs.updated_at의 epoch ms다 (구 state.json 파일 mtime을 대체한다 — ADR-014).
 */
export function deriveRunStatus(
  state: RunState,
  updatedAtMs: number,
  nowMs: number = Date.now(),
): RunDisplayStatus {
  if (state.completedAt) {
    return "completed";
  }
  if (state.steps.some((step) => step.status === "error")) {
    return "error";
  }
  // 인터뷰 답변 대기는 프로세스가 정상 종료된 상태다.
  // stalled 판정보다 먼저 확인해야 15분 후 stalled로 오판되지 않는다.
  if (state.steps.some((step) => step.status === "waiting")) {
    return "waiting";
  }
  return nowMs - updatedAtMs <= STALLED_THRESHOLD_MS ? "running" : "stalled";
}

function slugify(idea: string): string {
  return idea
    .toLowerCase()
    .replace(/[^a-z0-9가-힣]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 30);
}

function newRunId(idea: string, now: Date): string {
  const timestamp = now.toISOString().replace(/[:.]/g, "-");
  const suffix = crypto.randomBytes(3).toString("hex");
  return [timestamp, slugify(idea), suffix].filter(Boolean).join("-");
}

interface RunRow {
  run_id: string;
  idea: string;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  interview: number;
  rerun_of: string | null;
}

interface StepRow {
  name: string;
  status: string;
  started_at: string | null;
  completed_at: string | null;
  failed_at: string | null;
  error_message: string | null;
}

/** DB 행 → RunState의 원시 형태. 검증은 zod가 한다 (DB는 바이트를, zod는 의미를 소유한다 — ADR-014) */
function toRawState(run: RunRow, steps: StepRow[]): unknown {
  const raw: Record<string, unknown> = {
    runId: run.run_id,
    idea: run.idea,
    createdAt: run.created_at,
    interview: run.interview !== 0,
    steps: steps.map((step) => {
      const rawStep: Record<string, unknown> = {
        name: step.name,
        status: step.status,
      };
      if (step.started_at !== null) rawStep.startedAt = step.started_at;
      if (step.completed_at !== null) rawStep.completedAt = step.completed_at;
      if (step.failed_at !== null) rawStep.failedAt = step.failed_at;
      if (step.error_message !== null) rawStep.errorMessage = step.error_message;
      return rawStep;
    }),
  };
  if (run.completed_at !== null) {
    raw.completedAt = run.completed_at;
  }
  return raw;
}

/** 문자열 content → 스키마 검증된 값. 없거나 깨졌거나 검증에 실패하면 null이다 (ADR-011 페일소프트) */
function parseArtifact<T>(content: string | null, schema: z.ZodType<T>): T | null {
  if (content === null) {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return null;
  }
  const result = schema.safeParse(parsed);
  return result.success ? result.data : null;
}

export class RunStore {
  private readonly db: DatabaseSync;

  constructor(dbPath: string) {
    this.db = openDb(dbPath);
  }

  /** 웹은 요청마다 커넥션을 열고 닫는다 — 모듈 스코프 싱글턴으로 들고 있지 않는다 */
  close(): void {
    if (this.db.isOpen) {
      this.db.close();
    }
  }

  private tx<T>(fn: () => T): T {
    this.db.exec("BEGIN");
    try {
      const result = fn();
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  // ── 내부: 트랜잭션 안에서만 쓰이는 원시 연산 ──

  private insertRunRow(
    state: RunState,
    rerunOf: string | null,
    nowIso: string,
  ): void {
    this.db
      .prepare(
        `INSERT INTO runs (run_id, idea, created_at, updated_at, completed_at, interview, rerun_of)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        state.runId,
        state.idea,
        state.createdAt,
        nowIso,
        state.completedAt ?? null,
        state.interview ? 1 : 0,
        rerunOf,
      );
  }

  /** RunState.steps[]가 그 run의 step 집합 전체다 — upsert하고 남는 행은 지운다 */
  private upsertSteps(state: RunState): void {
    const upsert = this.db.prepare(
      `INSERT INTO steps (run_id, name, ordinal, status, started_at, completed_at, failed_at, error_message)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (run_id, name) DO UPDATE SET
         ordinal       = excluded.ordinal,
         status        = excluded.status,
         started_at    = excluded.started_at,
         completed_at  = excluded.completed_at,
         failed_at     = excluded.failed_at,
         error_message = excluded.error_message`,
    );
    for (const step of state.steps) {
      upsert.run(
        state.runId,
        step.name,
        PIPELINE_STEPS.indexOf(step.name),
        step.status,
        step.startedAt ?? null,
        step.completedAt ?? null,
        step.failedAt ?? null,
        step.errorMessage ?? null,
      );
    }

    const names = state.steps.map((step) => step.name);
    if (names.length === 0) {
      this.db.prepare("DELETE FROM steps WHERE run_id = ?").run(state.runId);
      return;
    }
    const placeholders = names.map(() => "?").join(", ");
    this.db
      .prepare(
        `DELETE FROM steps WHERE run_id = ? AND name NOT IN (${placeholders})`,
      )
      .run(state.runId, ...names);
  }

  /**
   * 모든 쓰기는 runs.updated_at을 민다 — 이 값이 stalled 판정의 유일한 근거다 (ADR-014).
   * 행이 없으면 RunNotFoundError: 삭제된 run에 대한 좀비 프로세스의 쓰기가 여기서 깨끗하게 실패한다.
   */
  private touchRun(runId: string, nowIso: string): void {
    const result = this.db
      .prepare("UPDATE runs SET updated_at = ? WHERE run_id = ?")
      .run(nowIso, runId);
    if (Number(result.changes) === 0) {
      throw new RunNotFoundError(runId);
    }
  }

  private upsertArtifact(
    runId: string,
    kind: ArtifactKind,
    content: string,
    nowIso: string,
  ): void {
    this.db
      .prepare(
        `INSERT INTO artifacts (run_id, kind, content, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT (run_id, kind) DO UPDATE SET
           content    = excluded.content,
           updated_at = excluded.updated_at`,
      )
      .run(runId, kind, content, nowIso);
  }

  private readArtifact(runId: string, kind: ArtifactKind): string | null {
    const row = this.db
      .prepare("SELECT content FROM artifacts WHERE run_id = ? AND kind = ?")
      .get(runId, kind) as { content: string } | undefined;
    return row === undefined ? null : row.content;
  }

  /** artifacts.content는 JSON 직렬화 문자열 한 덩어리다 — 컬럼으로 쪼개지 않는다 (ADR-014) */
  private saveArtifact(
    runId: string,
    kind: ArtifactKind,
    content: string,
  ): void {
    const nowIso = new Date().toISOString();
    this.tx(() => {
      this.touchRun(runId, nowIso);
      this.upsertArtifact(runId, kind, content, nowIso);
    });
  }

  private stepRows(runId: string): StepRow[] {
    return this.db
      .prepare(
        `SELECT name, status, started_at, completed_at, failed_at, error_message
         FROM steps WHERE run_id = ? ORDER BY ordinal`,
      )
      .all(runId) as unknown as StepRow[];
  }

  private runRow(runId: string): RunRow | null {
    const row = this.db
      .prepare(
        `SELECT run_id, idea, created_at, updated_at, completed_at, interview, rerun_of
         FROM runs WHERE run_id = ?`,
      )
      .get(runId) as unknown as RunRow | undefined;
    return row ?? null;
  }

  // ── public API ──

  createRun(idea: string, opts?: { interview?: boolean }): RunState {
    const interview = opts?.interview ?? false;
    const now = new Date();
    const nowIso = now.toISOString();

    const state: RunState = {
      runId: newRunId(idea, now),
      idea,
      createdAt: nowIso,
      // interviewer 스텝은 인터뷰가 켜진 run(웹)에서만 seed한다
      steps: PIPELINE_STEPS.filter(
        (name) => name !== "interviewer" || interview,
      ).map((name) => ({
        name,
        status: "pending" as const,
      })),
      interview,
    };

    this.tx(() => {
      this.insertRunRow(state, null, nowIso);
      this.upsertSteps(state);
    });
    return state;
  }

  /**
   * 재실행은 포크다 — 원본을 덮어쓰지 않는다 (ADR-015).
   * idea·interview와 인터뷰 아티팩트(questions·answers)만 복사하고, research 이후는 전부 새로 돈다.
   */
  createRerun(sourceRunId: string): RunState {
    const source = this.loadRun(sourceRunId);
    const questions = this.readArtifact(
      sourceRunId,
      STEP_ARTIFACT_KINDS.interviewer,
    );
    const answers = this.readArtifact(sourceRunId, ANSWERS_KIND);

    const now = new Date();
    const nowIso = now.toISOString();
    // 질문이 실제로 있을 때만 interviewer를 완료로 둔다. 질문이 없는데 완료로 표시하면
    // orchestrator가 답변 없이 진행한다(인터뷰 도중 실패한 run을 포크하는 경우).
    const interviewerDone = questions !== null;
    const steps: StepState[] = source.steps.map((step) =>
      step.name === "interviewer" && interviewerDone
        ? { name: step.name, status: "completed", completedAt: nowIso }
        : { name: step.name, status: "pending" },
    );

    const state: RunState = {
      runId: newRunId(source.idea, now),
      idea: source.idea,
      createdAt: nowIso,
      steps,
      interview: source.interview,
    };

    this.tx(() => {
      this.insertRunRow(state, sourceRunId, nowIso);
      this.upsertSteps(state);
      if (questions !== null) {
        this.upsertArtifact(
          state.runId,
          STEP_ARTIFACT_KINDS.interviewer,
          questions,
          nowIso,
        );
      }
      if (answers !== null) {
        this.upsertArtifact(state.runId, ANSWERS_KIND, answers, nowIso);
      }
    });
    return state;
  }

  /** 지웠으면 true, 없으면 false. steps·artifacts는 FK CASCADE로 함께 사라진다 (ADR-015) */
  deleteRun(runId: string): boolean {
    return this.tx(() => {
      const result = this.db
        .prepare("DELETE FROM runs WHERE run_id = ?")
        .run(runId);
      return Number(result.changes) > 0;
    });
  }

  loadRun(runId: string): RunState {
    const row = this.runRow(runId);
    if (row === null) {
      throw new RunNotFoundError(runId);
    }
    return RunStateSchema.parse(toRawState(row, this.stepRows(runId)));
  }

  /**
   * loadRun과 달리 없거나 손상됐으면 null이다 — 웹의 상세 조회가 404를 내야 하기 때문이다.
   * updatedAtMs는 stalled 판정에, rerunOf는 계보 표시에 쓰인다 (둘 다 RunState에는 없는 run 메타다).
   */
  loadRunRecord(
    runId: string,
  ): { state: RunState; updatedAtMs: number; rerunOf?: string } | null {
    const row = this.runRow(runId);
    if (row === null) {
      return null;
    }
    const result = RunStateSchema.safeParse(
      toRawState(row, this.stepRows(runId)),
    );
    if (!result.success) {
      return null;
    }
    return {
      state: result.data,
      updatedAtMs: Date.parse(row.updated_at),
      ...(row.rerun_of !== null ? { rerunOf: row.rerun_of } : {}),
    };
  }

  /**
   * UPDATE-only다 — INSERT는 createRun·createRerun만 한다 (ADR-014).
   * 삭제된 run에 detached CLI 프로세스가 쓰기를 시도하면 여기서 실패한다. upsert로 만들면
   * 좀비가 삭제된 run을 되살린다 — 삭제의 안전성은 저장 계층의 불변식이어야 한다 (ADR-015).
   */
  saveRun(state: RunState): void {
    const nowIso = new Date().toISOString();
    this.tx(() => {
      const result = this.db
        .prepare(
          `UPDATE runs
           SET idea = ?, created_at = ?, updated_at = ?, completed_at = ?, interview = ?
           WHERE run_id = ?`,
        )
        .run(
          state.idea,
          state.createdAt,
          nowIso,
          state.completedAt ?? null,
          state.interview ? 1 : 0,
          state.runId,
        );
      if (Number(result.changes) === 0) {
        throw new RunNotFoundError(state.runId);
      }
      this.upsertSteps(state);
    });
  }

  saveStepOutput(runId: string, step: PipelineStepName, data: unknown): void {
    this.saveArtifact(
      runId,
      STEP_ARTIFACT_KINDS[step],
      JSON.stringify(data, null, 2),
    );
  }

  loadStepOutput<T>(
    runId: string,
    step: PipelineStepName,
    schema: z.ZodType<T>,
  ): T | null {
    return parseArtifact(
      this.readArtifact(runId, STEP_ARTIFACT_KINDS[step]),
      schema,
    );
  }

  saveInterviewQuestions(runId: string, questions: InterviewQuestions): void {
    this.saveStepOutput(runId, "interviewer", questions);
  }

  loadInterviewQuestions(runId: string): InterviewQuestions | null {
    return this.loadStepOutput(runId, "interviewer", InterviewQuestionsSchema);
  }

  saveInterviewAnswers(runId: string, answers: InterviewAnswers): void {
    this.saveArtifact(runId, ANSWERS_KIND, JSON.stringify(answers, null, 2));
  }

  loadInterviewAnswers(runId: string): InterviewAnswers | null {
    return parseArtifact(
      this.readArtifact(runId, ANSWERS_KIND),
      InterviewAnswersSchema,
    );
  }

  /** 수집 즉시 영속화한다 — LLM이 손대기 전의 사실이 곧 진실의 원천이다 (ADR-013) */
  saveResearchEvidence(runId: string, evidence: ResearchEvidence): void {
    this.saveArtifact(runId, RESEARCH_KIND, JSON.stringify(evidence, null, 2));
  }

  /** 구 run에는 research가 없다 — 없거나 손상됐으면 throw하지 않고 null이다 */
  loadResearchEvidence(runId: string): ResearchEvidence | null {
    return parseArtifact(
      this.readArtifact(runId, RESEARCH_KIND),
      ResearchEvidenceSchema,
    );
  }

  /** 리포트만 JSON이 아니라 마크다운 원문 그대로 저장한다 */
  saveReport(runId: string, markdown: string): void {
    this.saveArtifact(runId, REPORT_KIND, markdown);
  }

  loadReport(runId: string): string | null {
    return this.readArtifact(runId, REPORT_KIND);
  }

  /** 리포트 유무만 묻는다 — 상세 조회는 2초마다 폴링되므로 본문(수만 자)을 읽어 버리지 않는다 */
  hasReport(runId: string): boolean {
    const row = this.db
      .prepare("SELECT 1 FROM artifacts WHERE run_id = ? AND kind = ?")
      .get(runId, REPORT_KIND);
    return row !== undefined;
  }

  /**
   * 정렬과 키워드 검색은 SQL이, 상태 파생은 deriveRunStatus가 한다.
   * 상태는 updated_at과 현재 시각의 비교로 파생되는 값이라, 판정 규칙을 WHERE 절로
   * 복제하면 두 개의 진실이 생겨 반드시 갈라진다. 상태 필터는 호출부가 메모리에서 건다.
   */
  listRuns(opts?: ListRunsOptions): RunSummary[] {
    const q = opts?.q?.trim();
    const filterByIdea = q !== undefined && q !== "";

    const rows = this.db
      .prepare(
        `SELECT run_id, idea, created_at, updated_at, completed_at, interview, rerun_of
         FROM runs
         ${filterByIdea ? "WHERE idea LIKE ? ESCAPE '\\'" : ""}
         ORDER BY created_at DESC`,
      )
      .all(...(filterByIdea ? [likePattern(q)] : [])) as unknown as RunRow[];

    const summaries: RunSummary[] = [];
    for (const row of rows) {
      // 손상된 run 하나가 목록 전체를 죽이면 안 되므로 검증 실패는 skip한다 (ADR-011)
      const result = RunStateSchema.safeParse(
        toRawState(row, this.stepRows(row.run_id)),
      );
      if (!result.success) {
        continue;
      }
      const state = result.data;
      summaries.push({
        runId: state.runId,
        idea: state.idea,
        createdAt: state.createdAt,
        completedAt: state.completedAt,
        status: deriveRunStatus(state, Date.parse(row.updated_at), opts?.nowMs),
        rerunOf: row.rerun_of ?? undefined,
      });
    }
    return summaries;
  }
}
