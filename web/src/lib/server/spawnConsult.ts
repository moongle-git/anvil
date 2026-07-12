import { spawn } from "node:child_process";
import { getRepoRoot } from "./runs";

/**
 * 파이프라인 실행 트리거 (ADR-007): 웹은 Gemini/YouTube를 직접 호출하지 않고
 * CLI를 detached child process로 spawn한다. 진행 상태는 DB(runs·steps) 폴링으로 조회한다.
 */
export function spawnConsult(
  runId: string,
  opts?: { spawnFn?: typeof spawn; cwd?: string },
): void {
  const spawnFn = opts?.spawnFn ?? spawn;
  const cwd = opts?.cwd ?? getRepoRoot();
  spawnFn("npm", ["run", "consult", "--", "--resume", runId], {
    cwd,
    detached: true,
    stdio: "ignore",
  }).unref();
}
