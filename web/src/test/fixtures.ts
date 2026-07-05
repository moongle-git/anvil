import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** fixture run 디렉토리 (이후 step의 테스트가 재사용한다) */
export const FIXTURES_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "fixtures",
);

/** 전 step 완료 + report.md 보유 */
export const COMPLETED_RUN_ID = "2026-07-01T09-00-00-000Z-ai-meeting-notes-fx01";
/** context-hunter만 완료 (mtime이 최신이면 running, 오래되면 stalled) */
export const RUNNING_RUN_ID = "2026-07-03T14-00-00-000Z-plant-care-fx02";
/** cold-critic이 error (errorMessage 포함) */
export const ERROR_RUN_ID = "2026-07-05T20-00-00-000Z-lunch-pick-fx03";

export const ALL_RUN_IDS = [
  COMPLETED_RUN_ID,
  RUNNING_RUN_ID,
  ERROR_RUN_ID,
] as const;

/** OS 임시 디렉토리를 만들고 ANVIL_RUNS_DIR로 주입한다 */
export function makeTempRunsDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "anvil-web-runs-"));
  process.env.ANVIL_RUNS_DIR = dir;
  return dir;
}

export function cleanupTempRunsDir(dir: string): void {
  delete process.env.ANVIL_RUNS_DIR;
  fs.rmSync(dir, { recursive: true, force: true });
}

/** fixture run을 임시 runs 디렉토리로 복사한다 (mtime은 복사 시점 = running) */
export function copyFixtureRun(runsDir: string, runId: string): void {
  fs.cpSync(path.join(FIXTURES_DIR, runId), path.join(runsDir, runId), {
    recursive: true,
  });
}

/** state.json의 mtime을 과거로 되돌린다 (stalled 판정 테스트용) */
export function ageStateFile(runsDir: string, runId: string, ageMs: number): void {
  const statePath = path.join(runsDir, runId, "state.json");
  const old = new Date(Date.now() - ageMs);
  fs.utimesSync(statePath, old, old);
}
