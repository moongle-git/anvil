/**
 * 구 파일 저장소(runs/{run-id}/)를 SQLite DB로 이송하는 일회성 스크립트 (ADR-014 "하위호환").
 *
 * 마이그레이션은 검증기가 아니라 이송기다. state.json만 검증하고(runs·steps 행을 만들려면
 * 구조를 알아야 한다), 나머지 아티팩트는 파싱조차 하지 않고 바이트를 그대로 옮긴다.
 * ADR-011 이전 스키마라 지금은 못 읽는 산출물도 그대로 넣는다 — 여기서 거르면 나중에
 * 스키마가 다시 바뀌어 읽힐 수 있는 데이터를 영영 버리는 셈이다. 읽기 시점에 zod가
 * 실패하면 지금처럼 null이 되어 UI가 빈 상태를 보여준다.
 *
 * 원본 runs/ 디렉토리는 지우지 않는다.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { DatabaseSync } from "node:sqlite";
import { getDefaultDbPath, openDb, type ArtifactKind } from "../src/lib/db.js";
import { PIPELINE_STEPS, RunStateSchema, type RunState } from "../src/types/index.js";

/** 구 파일명 → artifacts.kind. 없는 파일은 그냥 없는 것이다 (구 run에는 research·questions가 없다) */
const ARTIFACT_FILES: readonly { file: string; kind: ArtifactKind }[] = [
  { file: "questions.json", kind: "questions" },
  { file: "answers.json", kind: "answers" },
  { file: "research.json", kind: "research" },
  { file: "context.json", kind: "context" },
  { file: "thesis.json", kind: "thesis" },
  { file: "criticism.json", kind: "criticism" },
  { file: "solution.json", kind: "solution" },
  { file: "verdict.json", kind: "verdict" },
  { file: "report.md", kind: "report" },
];

export interface MigrationResult {
  /** 새로 이송한 runId */
  imported: string[];
  /** 이미 DB에 있어서 건너뛴 runId */
  skipped: string[];
  /** state.json 부재·손상 등으로 이송하지 못한 run */
  failed: { runId: string; reason: string }[];
}

/** state.json을 읽어 검증한다. 실패는 예외가 아니라 사유 문자열이다 */
type StateRead =
  | { ok: true; state: RunState; updatedAt: string }
  | { ok: false; reason: string };

function readState(runDir: string): StateRead {
  const statePath = path.join(runDir, "state.json");

  let raw: string;
  let updatedAt: string;
  try {
    raw = fs.readFileSync(statePath, "utf8");
    // now를 쓰면 안 된다 — 미완료로 죽은 과거 run이 전부 "실행 중"으로 표시된다
    // (deriveRunStatus가 updated_at 기준 15분 이내면 running으로 판정한다)
    updatedAt = fs.statSync(statePath).mtime.toISOString();
  } catch (error) {
    return { ok: false, reason: `state.json을 읽을 수 없다: ${message(error)}` };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    return { ok: false, reason: `state.json JSON 파싱 실패: ${message(error)}` };
  }

  const result = RunStateSchema.safeParse(parsed);
  if (!result.success) {
    return {
      ok: false,
      reason: `state.json 스키마 검증 실패: ${result.error.issues
        .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
        .join(", ")}`,
    };
  }

  return { ok: true, state: result.data, updatedAt };
}

/** 한 run의 이송은 한 트랜잭션이다 — 중간에 실패하면 그 run의 부분 데이터가 남지 않는다 */
function importRun(
  db: DatabaseSync,
  runDir: string,
  state: RunState,
  updatedAt: string,
): void {
  db.exec("BEGIN");
  try {
    db.prepare(
      `INSERT INTO runs (run_id, idea, created_at, updated_at, completed_at, interview, rerun_of)
       VALUES (?, ?, ?, ?, ?, ?, NULL)`,
    ).run(
      state.runId,
      state.idea,
      state.createdAt,
      updatedAt,
      state.completedAt ?? null,
      state.interview ? 1 : 0,
    );

    const insertStep = db.prepare(
      `INSERT INTO steps (run_id, name, ordinal, status, started_at, completed_at, failed_at, error_message)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const step of state.steps) {
      insertStep.run(
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

    const insertArtifact = db.prepare(
      `INSERT INTO artifacts (run_id, kind, content, updated_at) VALUES (?, ?, ?, ?)`,
    );
    for (const { file, kind } of ARTIFACT_FILES) {
      const filePath = path.join(runDir, file);
      let content: string;
      let fileUpdatedAt: string;
      try {
        content = fs.readFileSync(filePath, "utf8");
        fileUpdatedAt = fs.statSync(filePath).mtime.toISOString();
      } catch {
        continue; // 없는 파일은 그냥 없는 것이다
      }
      // 파싱하지 않는다. JSON.parse → stringify로 재직렬화하면 원문이 바뀌고,
      // 파싱조차 안 되는 파일은 버려진다. 바이트를 그대로 옮긴다 (ADR-014).
      insertArtifact.run(state.runId, kind, content, fileUpdatedAt);
    }

    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * runsDir의 run 디렉토리를 dbPath의 DB로 이송한다.
 *
 * 멱등하다 — 이미 같은 run_id가 있으면 건너뛴다(덮어쓰지 않는다. 이송 후 재실행하거나
 * 삭제했을 수 있다). 손상된 run 하나가 나머지의 이송을 막지 않는다(fail-soft).
 *
 * RunStore.createRun을 쓰지 않는 이유: createRun은 timestamp+suffix로 새 runId를 만든다.
 * 이송은 원본 runId를 보존해야 한다 — 웹 북마크·비교 URL이 그 id를 가리키고,
 * 무엇보다 새 id가 생기면 같은 run을 두 번 이송하게 된다.
 */
export function migrateRuns(runsDir: string, dbPath: string): MigrationResult {
  const result: MigrationResult = { imported: [], skipped: [], failed: [] };

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(runsDir, { withFileTypes: true });
  } catch {
    return result; // runs/가 없으면 이송할 것도 없다
  }

  const runDirs = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

  const db = openDb(dbPath);
  try {
    const exists = db.prepare("SELECT 1 FROM runs WHERE run_id = ?");

    for (const dirName of runDirs) {
      const runDir = path.join(runsDir, dirName);

      const read = readState(runDir);
      if (!read.ok) {
        result.failed.push({ runId: dirName, reason: read.reason });
        continue;
      }

      const { state, updatedAt } = read;
      if (exists.get(state.runId) !== undefined) {
        result.skipped.push(state.runId);
        continue;
      }

      try {
        importRun(db, runDir, state, updatedAt);
        result.imported.push(state.runId);
      } catch (error) {
        result.failed.push({ runId: dirName, reason: message(error) });
      }
    }
  } finally {
    db.close();
  }

  return result;
}

function main(): void {
  const [runsArg, dbArg] = process.argv.slice(2);
  const runsDir = path.resolve(runsArg ?? path.join(process.cwd(), "runs"));
  const dbPath = dbArg === undefined ? getDefaultDbPath() : path.resolve(dbArg);

  const result = migrateRuns(runsDir, dbPath);

  for (const { runId, reason } of result.failed) {
    console.error(`실패: ${runId} — ${reason}`);
  }
  console.log(
    `이송 완료: ${result.imported.length}개 ` +
      `(건너뜀 ${result.skipped.length}, 실패 ${result.failed.length})`,
  );
  console.log(
    "원본 runs/ 디렉토리는 지우지 않았다. 웹 UI에서 확인한 뒤 직접 삭제하라.",
  );
}

const invokedPath = process.argv[1];
if (
  invokedPath !== undefined &&
  path.resolve(invokedPath) === fileURLToPath(import.meta.url)
) {
  main();
}
