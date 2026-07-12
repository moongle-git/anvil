import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

/**
 * artifacts.kind — 저장 가능한 산출물의 전체 목록 (ADR-014).
 * DB는 바이트를 보관하고 의미는 zod가 소유하므로, 여기서 아는 것은 "무엇이 들어 있는가"뿐이다.
 * content는 JSON 직렬화 문자열이고, "report"만 마크다운 원문이다.
 */
export const ARTIFACT_KINDS = [
  "questions",
  "answers",
  "research",
  "context",
  "thesis",
  "criticism",
  "solution",
  "verdict",
  "report",
] as const;
export type ArtifactKind = (typeof ARTIFACT_KINDS)[number];

/**
 * 스키마 버전은 기록만 한다. 마이그레이션 러너는 만들지 않는다 —
 * 스키마 v2가 실제로 필요해질 때 이 값을 근거로 짓는다 (ADR-014).
 */
const SCHEMA_VERSION = 1;

const DDL = `
CREATE TABLE IF NOT EXISTS runs (
  run_id       TEXT PRIMARY KEY,
  idea         TEXT NOT NULL,
  created_at   TEXT NOT NULL,               -- ISO 8601
  updated_at   TEXT NOT NULL,               -- ISO 8601. 모든 쓰기가 갱신한다 (stalled 판정의 유일한 근거)
  completed_at TEXT,
  interview    INTEGER NOT NULL DEFAULT 0,  -- 0|1
  rerun_of     TEXT REFERENCES runs(run_id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS steps (
  run_id        TEXT NOT NULL REFERENCES runs(run_id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  ordinal       INTEGER NOT NULL,           -- PIPELINE_STEPS 순서. 조회 시 정렬 기준
  status        TEXT NOT NULL,              -- pending|completed|error|waiting
  started_at    TEXT,
  completed_at  TEXT,
  failed_at     TEXT,
  error_message TEXT,
  PRIMARY KEY (run_id, name)
);

CREATE TABLE IF NOT EXISTS artifacts (
  run_id     TEXT NOT NULL REFERENCES runs(run_id) ON DELETE CASCADE,
  kind       TEXT NOT NULL,                 -- questions|answers|research|context|thesis|criticism|solution|verdict|report
  content    TEXT NOT NULL,                 -- JSON 직렬화 문자열. kind='report'만 마크다운 원문
  updated_at TEXT NOT NULL,
  PRIMARY KEY (run_id, kind)
);

CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL);

CREATE INDEX IF NOT EXISTS idx_runs_created_at ON runs(created_at DESC);
`;

/** ANVIL_DB_PATH ?? <repo-root>/data/anvil.db */
export function getDefaultDbPath(): string {
  return (
    process.env.ANVIL_DB_PATH ?? path.resolve(process.cwd(), "data", "anvil.db")
  );
}

/**
 * 스키마를 보장한 DB 커넥션을 연다. 여러 번 열어도 안전하다(DDL은 IF NOT EXISTS).
 * dbPath는 ":memory:"도 허용한다(테스트).
 *
 * PRAGMA 3종은 전부 데이터 무결성의 핵심이다 (ADR-014):
 * - journal_mode = WAL  : CLI(쓰기)와 Next 서버(읽기)가 같은 파일에 동시 접근한다
 * - busy_timeout = 5000 : 잠금 경합 시 즉시 SQLITE_BUSY로 죽지 않고 기다린다
 * - foreign_keys = ON   : SQLite의 기본값은 OFF다. 꺼져 있으면 ON DELETE CASCADE가
 *                         에러 없이 조용히 무시되어, 삭제가 고아 행을 남기며 성공한 것처럼 보인다
 */
export function openDb(dbPath: string): DatabaseSync {
  if (dbPath !== ":memory:") {
    fs.mkdirSync(path.dirname(path.resolve(dbPath)), { recursive: true });
  }

  const db = new DatabaseSync(dbPath);

  // WAL은 :memory:에 적용되지 않고 SQLite가 "memory"를 반환한다 — 에러가 아니다
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA busy_timeout = 5000");
  db.exec("PRAGMA foreign_keys = ON");

  db.exec(DDL);

  const seeded = db
    .prepare("SELECT count(*) AS count FROM schema_version")
    .get() as { count: number };
  if (seeded.count === 0) {
    db.prepare("INSERT INTO schema_version (version) VALUES (?)").run(
      SCHEMA_VERSION,
    );
  }

  return db;
}
