import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { migrateRuns } from "../../../scripts/migrateRuns.js";

/** fixture run 디렉토리 — 실제 run에서 뽑은 회귀 방지 자산이다. 파일 형식 그대로 두고 DB로 seed한다 */
export const FIXTURES_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "fixtures",
);

/** 전 step 완료 + 리포트 보유 */
export const COMPLETED_RUN_ID = "2026-07-01T09-00-00-000Z-ai-meeting-notes-fx01";
/** context-hunter만 완료 (updated_at이 최신이면 running, 오래되면 stalled) */
export const RUNNING_RUN_ID = "2026-07-03T14-00-00-000Z-plant-care-fx02";
/** cold-critic이 error (errorMessage 포함) */
export const ERROR_RUN_ID = "2026-07-05T20-00-00-000Z-lunch-pick-fx03";
/** interviewer가 waiting — 답변 대기 중 (questions 보유, interview:true) */
export const WAITING_RUN_ID = "2026-07-07T10-00-00-000Z-waiting-interview-fx04";

// ALL_RUN_IDS는 목록/정렬 테스트가 순서를 단언하므로 WAITING은 제외한다
export const ALL_RUN_IDS = [
  COMPLETED_RUN_ID,
  RUNNING_RUN_ID,
  ERROR_RUN_ID,
] as const;

function dbPath(): string {
  const injected = process.env.ANVIL_DB_PATH;
  if (injected === undefined) {
    throw new Error("makeTempDb()를 먼저 호출하라 (ANVIL_DB_PATH 미설정)");
  }
  return injected;
}

/** fixture를 이송기에 먹이기 위한 staging runs 디렉토리 (DB와 같은 tmp 디렉토리에 둔다) */
function stagingDir(): string {
  return path.join(path.dirname(dbPath()), "runs");
}

/** 저장소 바깥에서 DB를 들여다보거나 손상시키는 용도 — 요청 코드와 마찬가지로 별도 커넥션이다 */
function withRawDb<T>(fn: (db: DatabaseSync) => T): T {
  const db = new DatabaseSync(dbPath());
  try {
    return fn(db);
  } finally {
    db.close();
  }
}

/** OS 임시 디렉토리에 DB 경로를 잡고 ANVIL_DB_PATH로 주입한다 (파일 자체는 첫 openDb가 만든다) */
export function makeTempDb(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "anvil-web-db-"));
  const file = path.join(dir, "anvil.db");
  process.env.ANVIL_DB_PATH = file;
  fs.mkdirSync(stagingDir());
  return file;
}

export function cleanupTempDb(file: string): void {
  delete process.env.ANVIL_DB_PATH;
  fs.rmSync(path.dirname(file), { recursive: true, force: true });
}

/**
 * fixture run을 DB에 seed한다. 픽스처 JSON은 그대로 두고, 파일→DB 이송기(scripts/migrateRuns)를
 * 재사용한다 — 이송 경로가 곧 seed 경로라 둘이 갈라질 수 없고, 구 스키마 산출물도 원문 그대로 들어간다.
 */
export function seedFixtureRun(runId: string): void {
  fs.cpSync(path.join(FIXTURES_DIR, runId), path.join(stagingDir(), runId), {
    recursive: true,
  });

  // 이송기는 멱등하다 — 이미 들어간 run은 건너뛰므로 여러 번 불러도 안전하다
  const result = migrateRuns(stagingDir(), dbPath());
  if (result.failed.length > 0) {
    throw new Error(`fixture seed 실패: ${JSON.stringify(result.failed)}`);
  }

  // 이송기는 updated_at을 원본 파일의 mtime으로 넣는다(죽은 과거 run이 전부 running으로
  // 오판되지 않게). fixture 파일의 mtime은 체크아웃 시점이라 그대로 두면 전부 stalled가 된다 —
  // 방금 쓴 것으로 되돌린다. 과거로 돌리는 테스트는 touchUpdatedAt을 명시적으로 쓴다.
  touchUpdatedAt(runId, new Date().toISOString());
}

/** runs.updated_at을 직접 바꾼다 (구 ageStateFile의 mtime 조작을 대체한다 — stalled 판정 테스트용) */
export function touchUpdatedAt(runId: string, updatedAt: string): void {
  withRawDb((db) =>
    db
      .prepare("UPDATE runs SET updated_at = ? WHERE run_id = ?")
      .run(updatedAt, runId),
  );
}

/** 아티팩트 원문을 직접 써넣는다 — 구 스키마·깨진 JSON 주입용 (RunStore는 유효한 값만 쓴다) */
export function writeArtifact(
  runId: string,
  kind: string,
  content: string,
): void {
  withRawDb((db) =>
    db
      .prepare(
        `INSERT INTO artifacts (run_id, kind, content, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT (run_id, kind) DO UPDATE SET content = excluded.content`,
      )
      .run(runId, kind, content, new Date().toISOString()),
  );
}

export function deleteArtifact(runId: string, kind: string): void {
  withRawDb((db) =>
    db
      .prepare("DELETE FROM artifacts WHERE run_id = ? AND kind = ?")
      .run(runId, kind),
  );
}

/** 상태 행을 스키마 위반으로 만든다 (구 state.json 손상을 대체한다 — 상세 조회가 null이어야 한다) */
export function corruptRunState(runId: string): void {
  withRawDb((db) =>
    db.prepare("UPDATE steps SET status = 'bogus' WHERE run_id = ?").run(runId),
  );
}
