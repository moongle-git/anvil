import "dotenv/config";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { GROUNDING_REQUEST_USD, type CallUsage } from "../lib/cost.js";
import { getDefaultDbPath } from "../lib/db.js";
import { RunStore, type RunUsageSummary } from "../lib/runStore.js";
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

// ── 비용 요약 (ADR-016) ──────────────────────────────────────────────

/** CJK는 터미널에서 2칸을 먹는다 — 문자 수로 패딩하면 표의 열이 어긋난다 */
const WIDE_CHAR = /[ᄀ-ᅟ⺀-꓏가-힣豈-﫿＀-｠]/;

function displayWidth(text: string): number {
  let width = 0;
  for (const char of text) {
    width += WIDE_CHAR.test(char) ? 2 : 1;
  }
  return width;
}

function padEnd(text: string, width: number): string {
  return text + " ".repeat(Math.max(0, width - displayWidth(text)));
}

function padStart(text: string, width: number): string {
  return " ".repeat(Math.max(0, width - displayWidth(text))) + text;
}

const tokens = (count: number): string => count.toLocaleString("en-US");
const usd = (cost: number): string => `$${cost.toFixed(4)}`;

const COLUMNS = [22, 6, 11, 10, 11, 11] as const;

function row(cells: readonly [string, string, string, string, string, string]): string {
  return cells
    .map((cell, i) => (i === 0 ? padEnd(cell, COLUMNS[i]) : padStart(cell, COLUMNS[i])))
    .join("");
}

/**
 * run 하나의 비용 장부를 사람이 읽는 표로 만든다. **stderr로 나가야 한다** —
 * stdout은 리포트 마크다운 전용이라 요약을 섞으면 리다이렉트한 report.md가 오염된다.
 *
 * 숫자를 던져놓기만 하면 판단할 수 없다. thinking 비중이 맨 앞에 오는 이유는 그것이
 * 이 phase의 근거이고, 사용자가 그 숫자를 보고 thinkingBudget을 정하기 때문이다.
 */
export function formatUsageSummary(summary: RunUsageSummary): string {
  if (summary.totalCalls === 0) {
    return "비용 요약: Gemini 호출이 없었다 (usage 기록 0건).";
  }

  const lines = [
    "── 비용 요약 (추정) ─────────────────────────────────────────────────────",
    row(["에이전트", "호출", "입력", "출력", "thinking", "USD"]),
  ];

  for (const label of summary.byLabel) {
    lines.push(
      row([
        label.label,
        String(label.calls),
        tokens(label.promptTokens),
        tokens(label.outputTokens),
        tokens(label.thoughtsTokens),
        usd(label.costUsd),
      ]),
    );
  }

  lines.push(
    "─".repeat(40),
    row([
      "합계",
      String(summary.totalCalls),
      tokens(summary.promptTokens),
      tokens(summary.outputTokens),
      tokens(summary.thoughtsTokens),
      usd(summary.totalCostUsd),
    ]),
    "",
    // 이 한 줄이 이 phase 전체의 근거다 — thinking은 출력 요금으로 과금되는 가장 비싼 토큰이다
    `thinking 비중  ${(summary.thoughtsRatio * 100).toFixed(1)}%  (${tokens(
      summary.thoughtsTokens,
    )} / 과금 출력 ${tokens(summary.outputTokens + summary.thoughtsTokens)} 토큰)`,
    `총 토큰        ${tokens(summary.totalTokens)}  (캐시 히트 ${tokens(
      summary.cachedTokens,
    )} 토큰)`,
    `grounded 호출  ${summary.groundedCalls}회  → 정액 ${usd(
      summary.groundedCalls * GROUNDING_REQUEST_USD,
    )} (Google Search 1,500건/일 무료 한도 안이면 실제 청구는 0)`,
  );

  lines.push(
    summary.retryCalls === 0
      ? "재시도 호출    0회"
      : `재시도 호출    ${summary.retryCalls}회  ← 낭비다. 재시도는 프롬프트 전문을 다시 보낸다`,
    "",
    "※ 위 금액은 하드코딩된 단가표로 계산한 추정치이며 실제 청구서가 아니다 — 진짜 청구서는 Google Cloud 콘솔에 있다.",
  );

  return lines.join("\n");
}

// ── 실행 ────────────────────────────────────────────────────────────

export interface ConsultDeps {
  store: RunStore;
  /**
   * onUsage를 주입받아 서비스를 만든다. GeminiService에 runId도 RunStore도 넘기지 않는다 —
   * 서비스는 "얼마 썼다"만 알리고, 그것을 어디에 적을지는 배선하는 cli/가 정한다 (ADR-016 결정 3).
   */
  createGemini: (onUsage: (usage: CallUsage) => void) => GeminiService;
  sources: readonly ResearchSource[];
}

/** 출력의 두 갈래. 리포트만 stdout이고 나머지는 전부 stderr다 */
export interface ConsultOutput {
  report: (text: string) => void;
  info: (text: string) => void;
}

/**
 * 컨설팅 1회 실행. 성공하면 true.
 *
 * runId를 **파이프라인보다 먼저** 확정하는 이유: 첫 Gemini 호출은 runPipeline 안에서
 * 일어나는데, onUsage 콜백은 그 usage를 어느 run에 적을지 그 전에 알아야 한다.
 * 웹이 이미 쓰는 패턴이다 — createRun 선생성 후 resume으로 넘긴다 (ADR-007).
 */
export async function consult(
  deps: ConsultDeps,
  args: { idea: string; resumeRunId?: string },
  out: ConsultOutput,
): Promise<boolean> {
  const { store } = deps;
  const runId = args.resumeRunId ?? store.createRun(args.idea).runId;
  const gemini = deps.createGemini((usage) => {
    store.saveUsage(runId, usage);
  });

  try {
    const result = await runPipeline(
      { store, gemini, sources: deps.sources, log: out.info },
      { idea: args.idea, resumeRunId: runId },
    );
    // 방어적 처리: CLI-direct run은 interview:false라 waiting에 도달하지 않는다.
    if (result.status === "waiting") {
      out.info("사용자 답변 대기 중 — 웹 UI에서 질문에 답한 뒤 재개된다.");
      return true;
    }
    // 리포트는 더 이상 파일이 아니다 (ADR-014). 원문을 stdout으로 흘려 리다이렉트할 수 있게 하고,
    // 사람이 읽는 안내는 stderr로 분리한다.
    out.report(result.report ?? "");
    out.info(`리포트 저장 완료 — run: ${runId}`);
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    out.info(`파이프라인 실행이 실패했다: ${message}`);
    if (error instanceof PipelineStepError) {
      out.info(`이어서 실행하려면: npm run consult -- --resume ${error.runId}`);
    }
    return false;
  } finally {
    // 실패한 run도 과금됐다 — 오히려 그때 비용을 아는 것이 더 중요하다 (ADR-016)
    out.info(formatUsageSummary(store.loadRunUsage(runId)));
  }
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
  try {
    const ok = await consult(
      {
        store,
        createGemini: (onUsage) =>
          // 일시적 오류(503·429) 재시도는 조용히 넘어가면 "왜 이 step이 오래 걸렸나"를
          // 나중에 설명할 수 없다. 진행 로그와 같은 stderr로 보낸다.
          new GeminiService({
            apiKey: geminiKey,
            onUsage,
            log: (message) => console.error(message),
          }),
        sources: buildResearchSources(process.env),
      },
      args,
      {
        report: (text) => console.log(text),
        info: (text) => console.error(text),
      },
    );
    if (!ok) {
      process.exitCode = 1;
    }
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
