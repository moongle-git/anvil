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
 * 스키마 버전은 기록만 한다. 마이그레이션 러너는 만들지 않는다 (ADR-014) —
 * v2(usage 테이블 추가)는 IF NOT EXISTS 증분이라 변환할 기존 데이터가 없다.
 * 기존 DB는 테이블만 더해지고 행은 그대로 살아 있다.
 */
const SCHEMA_VERSION = 2;

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

-- 산출물이 아니라 사건 로그다 (ADR-016). Gemini 호출 1회 = 1행이며, 검증에 실패한 시도도
-- 과금되므로 행으로 남는다. 그래서 PK가 없다 — 같은 (run_id, label)에 재시도 행이 여러 개
-- 생기는 것이 정상이고, (run_id, label, attempt)조차 resume 시 attempt가 1부터 재시작해 충돌한다.
CREATE TABLE IF NOT EXISTS usage (
  run_id          TEXT NOT NULL REFERENCES runs(run_id) ON DELETE CASCADE,
  label           TEXT NOT NULL,             -- 에이전트 이름 (thesis, cold-critic, …)
  model           TEXT NOT NULL,
  grounded        INTEGER NOT NULL,          -- 0|1. 토큰과 별개로 요청당 정액 과금된다
  attempt         INTEGER NOT NULL,          -- 1부터. 재시도한 시도도 과금되므로 행이 여러 개다
  prompt_tokens   INTEGER NOT NULL,
  cached_tokens   INTEGER NOT NULL,          -- prompt_tokens에 이미 포함된 값이다 (중복 아님)
  output_tokens   INTEGER NOT NULL,
  thoughts_tokens INTEGER NOT NULL,          -- thinking. 출력 요금으로 과금된다 (ADR-016)
  total_tokens    INTEGER NOT NULL,
  cost_usd        REAL NOT NULL,             -- 추정치다. 청구서가 아니다
  created_at      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL);

CREATE INDEX IF NOT EXISTS idx_runs_created_at ON runs(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_usage_run_id ON usage(run_id);
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

  // 빈 DB면 시딩하고, 이미 있으면 갱신한다. 상수만 올리고 INSERT만 하면 기존 DB는 옛 번호로
  // 남아 같은 스키마에 두 버전 번호가 생긴다 — 그걸 맞출 마이그레이션 러너는 없다 (ADR-014).
  const seeded = db
    .prepare("SELECT count(*) AS count FROM schema_version")
    .get() as { count: number };
  if (seeded.count === 0) {
    db.prepare("INSERT INTO schema_version (version) VALUES (?)").run(
      SCHEMA_VERSION,
    );
  } else {
    db.prepare("UPDATE schema_version SET version = ?").run(SCHEMA_VERSION);
  }

  return db;
}
