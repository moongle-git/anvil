import "dotenv/config";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { getDefaultDbPath } from "../lib/db.js";
import { RunStore } from "../lib/runStore.js";
import { PipelineStepError, runPipeline } from "../pipeline/orchestrator.js";
import { hackerNewsSource, naverSource, youtubeSource } from "../research/sources.js";
import type { ResearchSource } from "../research/types.js";
import { GeminiService } from "../services/gemini.js";
import { HackerNewsService } from "../services/hackerNews.js";
import { NaverService } from "../services/naver.js";
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
 * 등록된 소스 배열이 곧 레지스트리다 (ADR-012).
 *
 * 키가 없는 소스는 "수집 실패"가 아니라 **부재**다 — 배열에 넣지 않는다. 동작할 수 없는
 * 서비스 객체를 만들면 collectAll이 그것을 failures[]에 기록하고 LLM 프롬프트는 "네이버
 * 수집이 실패했다"고 적는데, 사실은 애초에 키가 없었던 것이다. 두 상황은 다르다.
 * 소스가 0개여도(collectAll([])) 합법이며 웹검색만으로 파이프라인은 완주한다.
 */
export function buildResearchSources(env: NodeJS.ProcessEnv): ResearchSource[] {
  const sources: ResearchSource[] = [];

  const youtubeKey = env.YOUTUBE_API_KEY;
  if (youtubeKey !== undefined && youtubeKey !== "") {
    sources.push(youtubeSource(new YoutubeService({ apiKey: youtubeKey })));
  } else {
    console.warn("YOUTUBE_API_KEY 미설정 — YouTube 수집을 건너뛴다.");
  }

  // Hacker News(Algolia)는 인증이 없다 — 항상 켠다
  sources.push(hackerNewsSource(new HackerNewsService({})));

  // 반쪽 설정(ID만 있고 SECRET이 없음)은 부재로 취급한다 — 반쪽으로 만든 서비스는 401로 죽는다
  const clientId = env.NAVER_CLIENT_ID;
  const clientSecret = env.NAVER_CLIENT_SECRET;
  if (
    clientId !== undefined &&
    clientId !== "" &&
    clientSecret !== undefined &&
    clientSecret !== ""
  ) {
    sources.push(naverSource(new NaverService({ clientId, clientSecret })));
  } else {
    console.warn(
      "NAVER_CLIENT_ID/NAVER_CLIENT_SECRET 미설정 — 네이버 수집을 건너뛴다.",
    );
  }

  return sources;
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

  const store = new RunStore(getDefaultDbPath());
  const deps = {
    store,
    gemini: new GeminiService({ apiKey: geminiKey }),
    sources: buildResearchSources(process.env),
  };

  try {
    const result = await runPipeline(deps, args);
    // 방어적 처리: CLI-direct run은 interview:false라 waiting에 도달하지 않는다.
    if (result.status === "waiting") {
      console.error(
        "사용자 답변 대기 중 — 웹 UI에서 질문에 답한 뒤 재개된다.",
      );
      return;
    }
    // 리포트는 더 이상 파일이 아니다 (ADR-014). 원문을 stdout으로 흘려 리다이렉트할 수 있게 하고,
    // 사람이 읽는 안내는 stderr로 분리한다.
    console.log(result.report);
    console.error(`리포트 저장 완료 — run: ${result.runId}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`파이프라인 실행이 실패했다: ${message}`);
    if (error instanceof PipelineStepError) {
      console.error(
        `이어서 실행하려면: npm run consult -- --resume ${error.runId}`,
      );
    }
    process.exitCode = 1;
  } finally {
    store.close();
  }
}

// 이 파일을 직접 실행할 때만 파이프라인을 돈다. buildResearchSources를 import하는 테스트가
// main()까지 실행하면 dotenv가 실은 .env 키로 실제 API를 때린다.
const entrypoint = process.argv[1];
if (entrypoint !== undefined && import.meta.url === pathToFileURL(entrypoint).href) {
  void main();
}
