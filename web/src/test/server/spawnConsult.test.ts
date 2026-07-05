// @vitest-environment node
import type { spawn } from "node:child_process";
import { afterEach, describe, expect, it, vi } from "vitest";
import { spawnConsult } from "@/lib/server/spawnConsult";

function makeSpawnFn() {
  const unref = vi.fn();
  const spawnFn = vi.fn().mockReturnValue({ unref });
  return { spawnFn: spawnFn as unknown as typeof spawn, calls: spawnFn, unref };
}

describe("spawnConsult (ADR-007)", () => {
  afterEach(() => {
    delete process.env.ANVIL_REPO_ROOT;
  });

  it("npm run consult -- --resume {runId}를 detached + stdio ignore로 spawn한다", () => {
    const { spawnFn, calls } = makeSpawnFn();

    spawnConsult("run-42", { spawnFn, cwd: "/repo-root" });

    expect(calls).toHaveBeenCalledExactlyOnceWith(
      "npm",
      ["run", "consult", "--", "--resume", "run-42"],
      { cwd: "/repo-root", detached: true, stdio: "ignore" },
    );
  });

  it("부모 프로세스와 분리되도록 unref한다", () => {
    const { spawnFn, unref } = makeSpawnFn();

    spawnConsult("run-42", { spawnFn, cwd: "/repo-root" });

    expect(unref).toHaveBeenCalledOnce();
  });

  it("cwd 기본값은 getRepoRoot()다", () => {
    process.env.ANVIL_REPO_ROOT = "/injected-repo-root";
    const { spawnFn, calls } = makeSpawnFn();

    spawnConsult("run-42", { spawnFn });

    expect(calls).toHaveBeenCalledWith(
      "npm",
      ["run", "consult", "--", "--resume", "run-42"],
      expect.objectContaining({ cwd: "/injected-repo-root" }),
    );
  });
});
