import "dotenv/config";
import path from "node:path";
import { parseArgs } from "node:util";
import { RunStore } from "../lib/runStore.js";
import { PipelineStepError, runPipeline } from "../pipeline/orchestrator.js";
import { GeminiService } from "../services/gemini.js";
import { YoutubeService } from "../services/youtube.js";

const USAGE = '사용법: npm run consult -- "아이디어 텍스트" [--resume <run-id>]';

function parseCliArgs(argv: string[]): { idea: string; resumeRunId?: string } {
  const { values, positionals } = parseArgs({
    args: argv,
    options: { resume: { type: "string" } },
    allowPositionals: true,
  });

  const idea = positionals.join(" ").trim();
  if (idea === "" && values.resume === undefined) {
    throw new Error("아이디어 텍스트 또는 --resume <run-id>가 필요하다");
  }
  return { idea, resumeRunId: values.resume };
}

/**
 * YOUTUBE_API_KEY가 없으면 네트워크 호출 없이 즉시 실패하는 fetchFn을 주입한다.
 * contextHunter가 이 실패를 흡수하고 웹검색만으로 진행한다 (실패 내성).
 */
function buildYoutubeService(apiKey: string | undefined): YoutubeService {
  if (apiKey !== undefined && apiKey !== "") {
    return new YoutubeService({ apiKey });
  }
  return new YoutubeService({
    apiKey: "",
    fetchFn: () =>
      Promise.reject(
        new Error("YOUTUBE_API_KEY가 설정되지 않아 YouTube 수집을 건너뛴다"),
      ),
  });
}

async function main(): Promise<void> {
  let args: { idea: string; resumeRunId?: string };
  try {
    args = parseCliArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    console.error(USAGE);
    process.exitCode = 1;
    return;
  }

  const geminiKey = process.env.GEMINI_API_KEY;
  if (geminiKey === undefined || geminiKey === "") {
    console.error(
      "GEMINI_API_KEY가 설정되지 않았다. https://aistudio.google.com/apikey 에서 키를 발급받아 .env에 추가하라.",
    );
    process.exitCode = 1;
    return;
  }

  const youtubeKey = process.env.YOUTUBE_API_KEY;
  if (youtubeKey === undefined || youtubeKey === "") {
    console.warn(
      "YOUTUBE_API_KEY가 설정되지 않았다 — YouTube 수집 없이 웹검색만으로 진행한다.",
    );
  }

  const deps = {
    store: new RunStore(path.resolve(process.cwd(), "runs")),
    gemini: new GeminiService({ apiKey: geminiKey }),
    youtube: buildYoutubeService(youtubeKey),
  };

  try {
    const result = await runPipeline(deps, args);
    console.log(result.reportPath);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`파이프라인 실행이 실패했다: ${message}`);
    if (error instanceof PipelineStepError) {
      console.error(
        `이어서 실행하려면: npm run consult -- --resume ${error.runId}`,
      );
    }
    process.exitCode = 1;
  }
}

void main();
