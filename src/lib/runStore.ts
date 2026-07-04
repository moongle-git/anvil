import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { z } from "zod";
import {
  PIPELINE_STEPS,
  RunStateSchema,
  type PipelineStepName,
  type RunState,
} from "../types/index.js";

export const STEP_OUTPUT_FILES: Record<PipelineStepName, string> = {
  "context-hunter": "context.json",
  "cold-critic": "criticism.json",
  "solution-designer": "solution.json",
};

const STATE_FILE = "state.json";
const REPORT_FILE = "report.md";

function slugify(idea: string): string {
  return idea
    .toLowerCase()
    .replace(/[^a-z0-9가-힣]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 30);
}

function atomicWriteFileSync(filePath: string, content: string): void {
  const tmpPath = `${filePath}.${crypto.randomBytes(6).toString("hex")}.tmp`;
  fs.writeFileSync(tmpPath, content, "utf-8");
  fs.renameSync(tmpPath, filePath);
}

export class RunStore {
  constructor(private readonly baseDir: string) {}

  private runDir(runId: string): string {
    return path.join(this.baseDir, runId);
  }

  createRun(idea: string): RunState {
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const suffix = crypto.randomBytes(3).toString("hex");
    const slug = slugify(idea);
    const runId = [timestamp, slug, suffix].filter(Boolean).join("-");

    const state: RunState = {
      runId,
      idea,
      createdAt: new Date().toISOString(),
      steps: PIPELINE_STEPS.map((name) => ({
        name,
        status: "pending" as const,
      })),
    };

    fs.mkdirSync(this.runDir(runId), { recursive: true });
    this.saveRun(state);
    return state;
  }

  loadRun(runId: string): RunState {
    const statePath = path.join(this.runDir(runId), STATE_FILE);
    if (!fs.existsSync(statePath)) {
      throw new Error(`Run not found: ${runId} (missing ${statePath})`);
    }
    return RunStateSchema.parse(JSON.parse(fs.readFileSync(statePath, "utf-8")));
  }

  saveRun(state: RunState): void {
    const dir = this.runDir(state.runId);
    fs.mkdirSync(dir, { recursive: true });
    atomicWriteFileSync(
      path.join(dir, STATE_FILE),
      JSON.stringify(state, null, 2),
    );
  }

  saveStepOutput(runId: string, step: PipelineStepName, data: unknown): void {
    atomicWriteFileSync(
      path.join(this.runDir(runId), STEP_OUTPUT_FILES[step]),
      JSON.stringify(data, null, 2),
    );
  }

  loadStepOutput<T>(
    runId: string,
    step: PipelineStepName,
    schema: z.ZodType<T>,
  ): T | null {
    const filePath = path.join(this.runDir(runId), STEP_OUTPUT_FILES[step]);
    if (!fs.existsSync(filePath)) {
      return null;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    } catch {
      return null;
    }
    const result = schema.safeParse(parsed);
    return result.success ? result.data : null;
  }

  saveReport(runId: string, markdown: string): string {
    const reportPath = path.resolve(this.runDir(runId), REPORT_FILE);
    atomicWriteFileSync(reportPath, markdown);
    return reportPath;
  }
}
