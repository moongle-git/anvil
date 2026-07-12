import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ARTIFACT_KINDS, getDefaultDbPath, openDb } from "./db.js";

/** usage 이전의 스키마. "기존 data/anvil.db를 열어도 살아남는가"를 검증하려면 v1을 직접 지어야 한다 */
const V1_DDL = `
CREATE TABLE IF NOT EXISTS runs (
  run_id       TEXT PRIMARY KEY,
  idea         TEXT NOT NULL,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL,
  completed_at TEXT,
  interview    INTEGER NOT NULL DEFAULT 0,
  rerun_of     TEXT REFERENCES runs(run_id) ON DELETE SET NULL
);
CREATE TABLE IF NOT EXISTS steps (
  run_id        TEXT NOT NULL REFERENCES runs(run_id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  ordinal       INTEGER NOT NULL,
  status        TEXT NOT NULL,
  started_at    TEXT,
  completed_at  TEXT,
  failed_at     TEXT,
  error_message TEXT,
  PRIMARY KEY (run_id, name)
);
CREATE TABLE IF NOT EXISTS artifacts (
  run_id     TEXT NOT NULL REFERENCES runs(run_id) ON DELETE CASCADE,
  kind       TEXT NOT NULL,
  content    TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (run_id, kind)
);
CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS idx_runs_created_at ON runs(created_at DESC);
`;

let tmpDir: string;
let open: DatabaseSync[];

/** 열린 커넥션은 전부 afterEach에서 닫는다 — 닫지 않으면 WAL 파일이 남고 rm이 실패할 수 있다 */
function track(db: DatabaseSync): DatabaseSync {
  open.push(db);
  return db;
}

function pragma(db: DatabaseSync, name: string): unknown {
  const row = db.prepare(`PRAGMA ${name}`).get();
  return row === undefined ? undefined : Object.values(row)[0];
}

function tableNames(db: DatabaseSync): string[] {
  const rows = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
    .all() as { name: string }[];
  return rows.map((row) => row.name);
}

function insertRun(db: DatabaseSync, runId: string, rerunOf?: string): void {
  db.prepare(
    `INSERT INTO runs (run_id, idea, created_at, updated_at, interview, rerun_of)
     VALUES (?, ?, ?, ?, 0, ?)`,
  ).run(
    runId,
    `아이디어 ${runId}`,
    "2026-07-12T00:00:00.000Z",
    "2026-07-12T00:00:00.000Z",
    rerunOf ?? null,
  );
}

function insertStep(db: DatabaseSync, runId: string, name: string): void {
  db.prepare(
    `INSERT INTO steps (run_id, name, ordinal, status) VALUES (?, ?, 0, 'pending')`,
  ).run(runId, name);
}

function insertArtifact(db: DatabaseSync, runId: string, kind: string): void {
  db.prepare(
    `INSERT INTO artifacts (run_id, kind, content, updated_at) VALUES (?, ?, '{}', ?)`,
  ).run(runId, kind, "2026-07-12T00:00:00.000Z");
}

function insertUsage(db: DatabaseSync, runId: string, label: string): void {
  db.prepare(
    `INSERT INTO usage (run_id, label, model, grounded, attempt, prompt_tokens,
                        cached_tokens, output_tokens, thoughts_tokens, total_tokens,
                        cost_usd, created_at)
     VALUES (?, ?, 'gemini-2.5-flash', 0, 1, 100, 0, 50, 20, 170, 0.001, ?)`,
  ).run(runId, label, "2026-07-12T00:00:00.000Z");
}

function countRows(db: DatabaseSync, table: string, runId: string): number {
  const row = db
    .prepare(`SELECT count(*) AS n FROM ${table} WHERE run_id = ?`)
    .get(runId) as { n: number };
  return row.n;
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "anvil-db-test-"));
  open = [];
});

afterEach(() => {
  for (const db of open) {
    if (db.isOpen) {
      db.close();
    }
  }
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("openDb", () => {
  describe("스키마", () => {
    it("도메인 테이블 3개 + 관측 테이블 usage + schema_version을 만든다", () => {
      const db = track(openDb(":memory:"));

      expect(tableNames(db)).toEqual(
        expect.arrayContaining([
          "runs",
          "steps",
          "artifacts",
          "usage",
          "schema_version",
        ]),
      );
    });

    it("created_at 인덱스를 만든다 — 목록은 최신순 조회다", () => {
      const db = track(openDb(":memory:"));

      const indexes = db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'index'")
        .all() as { name: string }[];

      expect(indexes.map((row) => row.name)).toContain("idx_runs_created_at");
    });

    it("usage의 run_id 인덱스를 만든다 — run별 비용 집계다 (ADR-016)", () => {
      const db = track(openDb(":memory:"));

      const indexes = db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'index'")
        .all() as { name: string }[];

      expect(indexes.map((row) => row.name)).toContain("idx_usage_run_id");
    });

    it("usage에 PK가 없다 — 같은 (run_id, label)에 재시도 행이 여러 개 생기는 게 정상이다", () => {
      const db = track(openDb(":memory:"));
      insertRun(db, "run-1");

      // PK나 UNIQUE가 있으면 두 번째 INSERT가 깨진다. 재시도 비용은 장부에서 사라지면 안 된다
      insertUsage(db, "run-1", "thesis");
      insertUsage(db, "run-1", "thesis");

      expect(countRows(db, "usage", "run-1")).toBe(2);
      const columns = db.prepare("PRAGMA table_info(usage)").all() as {
        pk: number;
      }[];
      expect(columns.every((column) => column.pk === 0)).toBe(true);
    });

    it("schema_version에 2를 기록한다 — usage 테이블이 추가됐다 (ADR-016)", () => {
      const db = track(openDb(":memory:"));

      const rows = db.prepare("SELECT version FROM schema_version").all();

      expect(rows).toEqual([{ version: 2 }]);
    });

    it("에이전트 산출물을 컬럼으로 쪼개지 않는다 — artifacts는 content 한 덩어리다 (ADR-014)", () => {
      const db = track(openDb(":memory:"));

      const columns = db.prepare("PRAGMA table_info(artifacts)").all() as {
        name: string;
      }[];

      expect(columns.map((column) => column.name)).toEqual([
        "run_id",
        "kind",
        "content",
        "updated_at",
      ]);
    });
  });

  describe("PRAGMA", () => {
    it("foreign_keys가 켜져 있다 — SQLite의 기본값은 OFF다", () => {
      const db = track(openDb(":memory:"));

      expect(pragma(db, "foreign_keys")).toBe(1);
    });

    it("busy_timeout이 5000ms다 — 잠금 경합 시 즉시 죽지 않는다", () => {
      const db = track(openDb(":memory:"));

      expect(pragma(db, "busy_timeout")).toBe(5000);
    });

    it("파일 DB는 WAL 모드로 열린다 (ADR-014)", () => {
      const db = track(openDb(path.join(tmpDir, "anvil.db")));

      expect(pragma(db, "journal_mode")).toBe("wal");
    });

    it(":memory:는 WAL을 지원하지 않지만 에러가 아니다", () => {
      const db = track(openDb(":memory:"));

      expect(pragma(db, "journal_mode")).toBe("memory");
    });
  });

  describe("멱등성", () => {
    it("같은 파일을 두 번 열어도 에러 없이 열리고 기존 데이터가 보존된다", () => {
      const dbPath = path.join(tmpDir, "anvil.db");

      const first = openDb(dbPath);
      insertRun(first, "run-1");
      first.close();

      const second = track(openDb(dbPath));

      expect(countRows(second, "runs", "run-1")).toBe(1);
      expect(
        second.prepare("SELECT version FROM schema_version").all(),
      ).toEqual([{ version: 2 }]);
    });

    // usage 추가는 IF NOT EXISTS 증분이라 변환할 기존 데이터가 없다 — 마이그레이션 러너를 두지
    // 않는 근거다 (ADR-014). 그 대신 이 테스트가 "기존 DB를 열어도 데이터가 살아 있다"를 지킨다.
    it("v1 DB를 열면 usage 테이블만 더해지고 version이 2가 된다 — 기존 데이터는 보존된다", () => {
      const dbPath = path.join(tmpDir, "anvil.db");
      const v1 = new DatabaseSync(dbPath);
      v1.exec("PRAGMA foreign_keys = ON");
      v1.exec(V1_DDL);
      v1.prepare("INSERT INTO schema_version (version) VALUES (1)").run();
      insertRun(v1, "old-run");
      insertArtifact(v1, "old-run", "report");
      v1.close();

      const upgraded = track(openDb(dbPath));

      expect(countRows(upgraded, "runs", "old-run")).toBe(1);
      expect(countRows(upgraded, "artifacts", "old-run")).toBe(1);
      expect(tableNames(upgraded)).toContain("usage");
      expect(
        upgraded.prepare("SELECT version FROM schema_version").all(),
      ).toEqual([{ version: 2 }]);
    });

    it("상위 디렉토리가 없으면 만든다", () => {
      const dbPath = path.join(tmpDir, "nested", "deeper", "anvil.db");

      track(openDb(dbPath));

      expect(fs.existsSync(dbPath)).toBe(true);
    });
  });

  describe("외래키 제약", () => {
    it("존재하지 않는 run_id로 steps에 INSERT하면 실패한다", () => {
      const db = track(openDb(":memory:"));

      expect(() => insertStep(db, "ghost", "thesis")).toThrow(
        /FOREIGN KEY constraint failed/i,
      );
    });

    it("존재하지 않는 run_id로 artifacts에 INSERT하면 실패한다", () => {
      const db = track(openDb(":memory:"));

      expect(() => insertArtifact(db, "ghost", "report")).toThrow(
        /FOREIGN KEY constraint failed/i,
      );
    });

    it("존재하지 않는 run_id로 usage에 INSERT하면 실패한다", () => {
      const db = track(openDb(":memory:"));

      expect(() => insertUsage(db, "ghost", "thesis")).toThrow(
        /FOREIGN KEY constraint failed/i,
      );
    });

    it("run을 지우면 steps·artifacts·usage가 CASCADE로 함께 사라진다 (ADR-015)", () => {
      const db = track(openDb(":memory:"));
      insertRun(db, "run-1");
      insertStep(db, "run-1", "context-hunter");
      insertStep(db, "run-1", "thesis");
      insertArtifact(db, "run-1", "context");
      insertArtifact(db, "run-1", "report");
      insertUsage(db, "run-1", "thesis");
      insertUsage(db, "run-1", "cold-critic");

      db.prepare("DELETE FROM runs WHERE run_id = ?").run("run-1");

      expect(countRows(db, "steps", "run-1")).toBe(0);
      expect(countRows(db, "artifacts", "run-1")).toBe(0);
      expect(countRows(db, "usage", "run-1")).toBe(0);
    });

    it("원본 run을 지워도 재실행 run은 살아남고 rerun_of만 NULL이 된다 (ADR-015)", () => {
      const db = track(openDb(":memory:"));
      insertRun(db, "original");
      insertRun(db, "fork", "original");

      db.prepare("DELETE FROM runs WHERE run_id = ?").run("original");

      const row = db
        .prepare("SELECT run_id, rerun_of FROM runs WHERE run_id = ?")
        .get("fork");

      expect(row).toEqual({ run_id: "fork", rerun_of: null });
    });
  });

  describe("동시 접근 (WAL — ADR-014의 근거)", () => {
    it("한 커넥션이 쓰는 동안 다른 커넥션이 읽어도 실패하지 않고, 커밋된 데이터가 보인다", () => {
      const dbPath = path.join(tmpDir, "anvil.db");
      const writer = track(openDb(dbPath)); // CLI 프로세스
      const reader = track(openDb(dbPath)); // Next 서버

      insertRun(writer, "committed");

      // 쓰기 트랜잭션이 열려 있는 동안에도 읽기는 막히지 않는다
      writer.exec("BEGIN IMMEDIATE");
      insertRun(writer, "in-flight");

      expect(countRows(reader, "runs", "committed")).toBe(1);
      expect(countRows(reader, "runs", "in-flight")).toBe(0);

      writer.exec("COMMIT");

      expect(countRows(reader, "runs", "in-flight")).toBe(1);
    });
  });
});

describe("getDefaultDbPath", () => {
  const original = process.env.ANVIL_DB_PATH;

  afterEach(() => {
    if (original === undefined) {
      delete process.env.ANVIL_DB_PATH;
    } else {
      process.env.ANVIL_DB_PATH = original;
    }
  });

  it("ANVIL_DB_PATH를 존중한다", () => {
    process.env.ANVIL_DB_PATH = "/tmp/custom/anvil.db";

    expect(getDefaultDbPath()).toBe("/tmp/custom/anvil.db");
  });

  it("기본값은 data/anvil.db다", () => {
    delete process.env.ANVIL_DB_PATH;

    expect(getDefaultDbPath()).toBe(
      path.resolve(process.cwd(), "data", "anvil.db"),
    );
  });
});

describe("ARTIFACT_KINDS", () => {
  it("artifacts.kind의 9개 값을 한곳에서 소유한다", () => {
    expect([...ARTIFACT_KINDS]).toEqual([
      "questions",
      "answers",
      "research",
      "context",
      "thesis",
      "criticism",
      "solution",
      "verdict",
      "report",
    ]);
  });
});
