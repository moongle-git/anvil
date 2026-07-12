import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDb } from "../src/lib/db.js";
import { RunStore, deriveRunStatus } from "../src/lib/runStore.js";
import { CriticismSchema, MarketContextSchema } from "../src/types/index.js";
import { migrateRuns } from "./migrateRuns.js";

interface StateFixture {
  runId: string;
  idea?: string;
  createdAt?: string;
  steps?: unknown[];
  completedAt?: string;
  interview?: boolean;
}

const completedSteps = [
  {
    name: "context-hunter",
    status: "completed",
    startedAt: "2026-07-05T10:28:03.140Z",
    completedAt: "2026-07-05T10:29:41.954Z",
  },
  {
    name: "cold-critic",
    status: "completed",
    startedAt: "2026-07-05T10:29:41.954Z",
    completedAt: "2026-07-05T10:30:00.575Z",
  },
  {
    name: "solution-designer",
    status: "pending",
  },
];

const validContext = {
  ideaTitle: "AI 반려식물 관리 서비스",
  briefing: "홈가드닝 시장은 성장 중이나 무료 리마인더 앱이 이미 선점했다.",
  marketSizeIndicators: ["홈가드닝 시장 연 10% 성장"],
  competitorInsight: "리마인더는 평준화됐다.",
  voicesInsight: "유저는 늦은 감지를 고통으로 말한다.",
  trends: ["홈가드닝 성장"],
  competitors: [{ name: "Planta", description: "식물 관리 앱" }],
  communityVoices: [],
  painPointEvidence: ["물주기 실패"],
  sources: ["https://example.com/trend"],
  citations: [],
  researchCoverage: [],
};

// ADR-011 평탄화 이전의 구 criticism — 지금의 zod 스키마로는 검증에 실패한다
const legacyCriticism = {
  painPointReality: ["페인포인트가 약하다"],
  bmWeakness: ["지불 의사가 낮다"],
  copycatRisk: ["대기업이 하루면 복제한다"],
  verdict: "생존 가능성 낮음",
};

describe("migrateRuns", () => {
  let tmpDir: string;
  let runsDir: string;
  let dbPath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "anvil-migrate-"));
    runsDir = path.join(tmpDir, "runs");
    dbPath = path.join(tmpDir, "data", "anvil.db");
    fs.mkdirSync(runsDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  /** 가짜 run 디렉토리를 만든다. files의 값은 문자열 그대로 기록된다(깨진 JSON도 허용). */
  function writeRun(
    runId: string,
    state: StateFixture | string | null,
    files: Record<string, string> = {},
  ): string {
    const dir = path.join(runsDir, runId);
    fs.mkdirSync(dir, { recursive: true });
    if (state !== null) {
      const content =
        typeof state === "string"
          ? state
          : JSON.stringify(
              {
                idea: "AI 반려식물 관리 서비스",
                createdAt: "2026-07-05T10:28:03.140Z",
                steps: completedSteps,
                ...state,
              },
              null,
              2,
            );
      fs.writeFileSync(path.join(dir, "state.json"), content);
    }
    for (const [name, content] of Object.entries(files)) {
      fs.writeFileSync(path.join(dir, name), content);
    }
    return dir;
  }

  function countRows(table: "runs" | "steps" | "artifacts"): number {
    const db = openDb(dbPath);
    try {
      const row = db
        .prepare(`SELECT count(*) AS count FROM ${table}`)
        .get() as { count: number };
      return row.count;
    } finally {
      db.close();
    }
  }

  it("정상 run을 runs·steps·artifacts에 전부 이송한다", () => {
    writeRun("run-a", { runId: "run-a", completedAt: "2026-07-05T10:30:30.546Z" }, {
      "context.json": JSON.stringify(validContext),
      "report.md": "# 리포트\n본문",
    });

    const result = migrateRuns(runsDir, dbPath);

    expect(result.imported).toEqual(["run-a"]);
    expect(result.skipped).toEqual([]);
    expect(result.failed).toEqual([]);

    const store = new RunStore(dbPath);
    try {
      const state = store.loadRun("run-a");
      expect(state.runId).toBe("run-a");
      expect(state.idea).toBe("AI 반려식물 관리 서비스");
      expect(state.createdAt).toBe("2026-07-05T10:28:03.140Z");
      expect(state.completedAt).toBe("2026-07-05T10:30:30.546Z");
      expect(state.steps).toHaveLength(3);
      expect(state.steps[0]).toMatchObject({
        name: "context-hunter",
        status: "completed",
        startedAt: "2026-07-05T10:28:03.140Z",
        completedAt: "2026-07-05T10:29:41.954Z",
      });
      expect(state.steps[2]).toMatchObject({
        name: "solution-designer",
        status: "pending",
      });
      expect(
        store.loadStepOutput("run-a", "context-hunter", MarketContextSchema),
      ).toMatchObject({ ideaTitle: "AI 반려식물 관리 서비스" });
    } finally {
      store.close();
    }
  });

  it("state.json의 interview 플래그를 보존하고, rerun_of는 NULL이다", () => {
    writeRun("run-interview", { runId: "run-interview", interview: true });
    writeRun("run-plain", { runId: "run-plain" });

    migrateRuns(runsDir, dbPath);

    const db = openDb(dbPath);
    try {
      const rows = db
        .prepare("SELECT run_id, interview, rerun_of FROM runs ORDER BY run_id")
        .all() as unknown as {
        run_id: string;
        interview: number;
        rerun_of: string | null;
      }[];
      expect(rows).toEqual([
        { run_id: "run-interview", interview: 1, rerun_of: null },
        { run_id: "run-plain", interview: 0, rerun_of: null },
      ]);
    } finally {
      db.close();
    }
  });

  it("이송된 run에는 없는 파일의 아티팩트가 생기지 않는다", () => {
    // 구 run에는 research.json·questions.json이 없다
    writeRun("run-old", { runId: "run-old" }, {
      "context.json": JSON.stringify(validContext),
    });

    migrateRuns(runsDir, dbPath);

    const db = openDb(dbPath);
    try {
      const kinds = db
        .prepare("SELECT kind FROM artifacts WHERE run_id = ? ORDER BY kind")
        .all("run-old") as unknown as { kind: string }[];
      expect(kinds.map((row) => row.kind)).toEqual(["context"]);
    } finally {
      db.close();
    }
  });

  describe("멱등성", () => {
    it("두 번 이송하면 두 번째는 전부 skipped이고 행 수가 늘지 않는다", () => {
      writeRun("run-a", { runId: "run-a" }, {
        "context.json": JSON.stringify(validContext),
        "report.md": "# 리포트",
      });

      const first = migrateRuns(runsDir, dbPath);
      expect(first.imported).toEqual(["run-a"]);

      const counts = {
        runs: countRows("runs"),
        steps: countRows("steps"),
        artifacts: countRows("artifacts"),
      };

      const second = migrateRuns(runsDir, dbPath);
      expect(second.imported).toEqual([]);
      expect(second.skipped).toEqual(["run-a"]);
      expect(second.failed).toEqual([]);

      expect(countRows("runs")).toBe(counts.runs);
      expect(countRows("steps")).toBe(counts.steps);
      expect(countRows("artifacts")).toBe(counts.artifacts);
    });

    it("이미 이송한 run을 덮어쓰지 않는다 — 이송 후 바뀐 DB 상태가 유지된다", () => {
      writeRun("run-a", { runId: "run-a" }, {
        "report.md": "# 원본 리포트",
      });
      migrateRuns(runsDir, dbPath);

      // 이송 후 사용자가 그 run을 재실행해 리포트가 갱신됐다고 하자
      const store = new RunStore(dbPath);
      try {
        store.saveReport("run-a", "# 재실행된 리포트");
      } finally {
        store.close();
      }

      const result = migrateRuns(runsDir, dbPath);
      expect(result.skipped).toEqual(["run-a"]);

      const reread = new RunStore(dbPath);
      try {
        expect(reread.loadReport("run-a")).toBe("# 재실행된 리포트");
      } finally {
        reread.close();
      }
    });

    it("이송 후 삭제한 run은 다시 이송된다 — 스크립트는 DB 상태만 본다", () => {
      writeRun("run-a", { runId: "run-a" });
      migrateRuns(runsDir, dbPath);

      const store = new RunStore(dbPath);
      try {
        expect(store.deleteRun("run-a")).toBe(true);
      } finally {
        store.close();
      }

      expect(migrateRuns(runsDir, dbPath).imported).toEqual(["run-a"]);
    });
  });

  describe("손상 run 격리 (fail-soft)", () => {
    it("state.json이 없는 디렉토리는 failed에 들어가고 나머지는 이송된다", () => {
      writeRun("run-broken", null, { "context.json": "{}" });
      writeRun("run-ok", { runId: "run-ok" });

      const result = migrateRuns(runsDir, dbPath);

      expect(result.imported).toEqual(["run-ok"]);
      expect(result.failed).toHaveLength(1);
      expect(result.failed[0]?.runId).toBe("run-broken");
      expect(result.failed[0]?.reason).toContain("state.json");
      expect(countRows("runs")).toBe(1);
    });

    it("state.json이 깨진 JSON이면 failed에 들어가고 나머지는 이송된다", () => {
      writeRun("run-broken", "{ 이건 JSON이 아니다");
      writeRun("run-ok", { runId: "run-ok" });

      const result = migrateRuns(runsDir, dbPath);

      expect(result.imported).toEqual(["run-ok"]);
      expect(result.failed).toHaveLength(1);
      expect(result.failed[0]?.runId).toBe("run-broken");
      expect(countRows("runs")).toBe(1);
    });

    it("state.json이 스키마 검증에 실패하면 failed에 들어가고 나머지는 이송된다", () => {
      // runId가 빈 문자열 — RunStateSchema의 min(1) 위반
      writeRun("run-broken", JSON.stringify({ runId: "", idea: "x", createdAt: "nope", steps: [] }));
      writeRun("run-ok", { runId: "run-ok" });

      const result = migrateRuns(runsDir, dbPath);

      expect(result.imported).toEqual(["run-ok"]);
      expect(result.failed).toHaveLength(1);
      expect(result.failed[0]?.runId).toBe("run-broken");
      expect(countRows("runs")).toBe(1);
    });

    it("실패한 run의 부분 데이터가 남지 않는다", () => {
      writeRun("run-broken", null, { "report.md": "# 고아 리포트" });
      migrateRuns(runsDir, dbPath);

      expect(countRows("runs")).toBe(0);
      expect(countRows("steps")).toBe(0);
      expect(countRows("artifacts")).toBe(0);
    });
  });

  describe("아티팩트는 검증하지 않고 원문 그대로 이송한다", () => {
    it("구 스키마 criticism도 원문 그대로 들어가고, 읽기 시점에 null이 된다", () => {
      const raw = JSON.stringify(legacyCriticism, null, 2);
      writeRun("run-legacy", { runId: "run-legacy" }, { "criticism.json": raw });

      const result = migrateRuns(runsDir, dbPath);
      expect(result.imported).toEqual(["run-legacy"]);

      const db = openDb(dbPath);
      try {
        const row = db
          .prepare("SELECT content FROM artifacts WHERE run_id = ? AND kind = 'criticism'")
          .get("run-legacy") as { content: string } | undefined;
        expect(row?.content).toBe(raw);
      } finally {
        db.close();
      }

      const store = new RunStore(dbPath);
      try {
        expect(
          store.loadStepOutput("run-legacy", "cold-critic", CriticismSchema),
        ).toBeNull();
      } finally {
        store.close();
      }
    });

    it("JSON으로 파싱조차 안 되는 아티팩트도 원문 그대로 들어간다", () => {
      const raw = "{ 이건 JSON이 아니다";
      writeRun("run-corrupt", { runId: "run-corrupt" }, { "criticism.json": raw });

      expect(migrateRuns(runsDir, dbPath).imported).toEqual(["run-corrupt"]);

      const db = openDb(dbPath);
      try {
        const row = db
          .prepare("SELECT content FROM artifacts WHERE run_id = ? AND kind = 'criticism'")
          .get("run-corrupt") as { content: string } | undefined;
        expect(row?.content).toBe(raw);
      } finally {
        db.close();
      }

      const store = new RunStore(dbPath);
      try {
        expect(
          store.loadStepOutput("run-corrupt", "cold-critic", CriticismSchema),
        ).toBeNull();
      } finally {
        store.close();
      }
    });

    it("report.md는 마크다운 원문 그대로 읽힌다", () => {
      const markdown = "# [컨설팅 리포트] 제목\n\n## 1. 시장 맥락\n본문\n";
      writeRun("run-a", { runId: "run-a" }, { "report.md": markdown });

      migrateRuns(runsDir, dbPath);

      const store = new RunStore(dbPath);
      try {
        expect(store.loadReport("run-a")).toBe(markdown);
      } finally {
        store.close();
      }
    });
  });

  describe("updated_at", () => {
    it("원본 state.json의 mtime을 쓴다 — 과거 미완료 run은 running이 아니라 stalled다", () => {
      const dir = writeRun("run-stale", { runId: "run-stale" }); // completedAt 없음
      const longAgo = new Date("2026-07-05T10:30:30.546Z");
      fs.utimesSync(path.join(dir, "state.json"), longAgo, longAgo);

      migrateRuns(runsDir, dbPath);

      const store = new RunStore(dbPath);
      try {
        const record = store.loadRunRecord("run-stale");
        expect(record).not.toBeNull();
        expect(record?.updatedAtMs).toBe(longAgo.getTime());
        // Date.now()를 썼다면 running으로 판정됐을 것이다
        expect(deriveRunStatus(record!.state, record!.updatedAtMs)).toBe("stalled");
      } finally {
        store.close();
      }
    });
  });

  it("runs 디렉토리가 없으면 빈 결과를 낸다", () => {
    const result = migrateRuns(path.join(tmpDir, "없는-디렉토리"), dbPath);
    expect(result).toEqual({ imported: [], skipped: [], failed: [] });
  });
});
