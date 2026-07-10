import type {
  CompetitorService,
  Criticism,
  CriticismPoint,
  DialecticAxis,
  MarketContext,
  Solution,
  Thesis,
  YoutubeVoice,
} from "../types/index.js";

function competitorLine(competitor: CompetitorService): string {
  const extras = [
    competitor.url,
    competitor.pricingHint === undefined
      ? undefined
      : `가격: ${competitor.pricingHint}`,
  ]
    .filter((v) => v !== undefined)
    .join(" · ");
  const base = `    *   [경쟁] **${competitor.name}** — ${competitor.description}`;
  return extras === "" ? base : `${base} (${extras})`;
}

function voiceBlock(voice: YoutubeVoice): string {
  // 댓글 원문에 줄바꿈이 있어도 인용 블록이 끊기지 않게 한다
  const comment = voice.comment.replace(/\n/g, "\n> ");
  const likes =
    voice.likeCount === undefined ? "" : `, 좋아요 ${voice.likeCount}`;
  return `> "${comment}"\n> — ${voice.videoTitle} (${voice.videoUrl}${likes})`;
}

function criticismLines(
  points: CriticismPoint[],
  axis: DialecticAxis,
): string[] {
  return points
    .filter((p) => p.axis === axis)
    .map(
      (p) =>
        `    *   **[${p.severity.toUpperCase()}]** ${p.claim} — 근거: ${p.evidence}`,
    );
}

/**
 * 정반합(正反合) 구조의 마크다운 컨설팅 리포트를 렌더링하는 순수 함수.
 * 1. 시장 맥락 → 2. 낙관적 논제(正) → 3. 냉정한 반론(反) → 4. 종합과 재설계(合) → 5. 비즈니스 모델.
 */
export function renderReport(
  idea: string,
  context: MarketContext,
  thesis: Thesis,
  criticism: Criticism,
  solution: Solution,
): string {
  const lines: string[] = [];

  lines.push(`# [컨설팅 리포트] ${context.ideaTitle}`, "");
  lines.push(`> 입력 아이디어: ${idea}`, "");

  lines.push("## 1. 실시간 시장 맥락 (Market Context)", "");
  lines.push("*   **수집된 유사/경쟁 서비스 현황:**");
  lines.push(...context.trends.map((t) => `    *   [트렌드] ${t}`));
  lines.push(...context.competitors.map(competitorLine));
  lines.push(...context.sources.map((s) => `    *   [출처] ${s}`));
  lines.push("*   **YouTube/커뮤니티 내 타겟 유저의 실제 목소리:**");
  lines.push(
    ...context.painPointEvidence.map((e) => `    *   [페인포인트 근거] ${e}`),
  );
  lines.push("");
  if (context.youtubeVoices.length === 0) {
    lines.push("> (수집된 YouTube 목소리 없음)", "");
  } else {
    for (const voice of context.youtubeVoices) {
      lines.push(voiceBlock(voice), "");
    }
  }

  lines.push("## 2. 낙관적 논제 (Thesis / 正)", "");
  lines.push(
    "> 이 사업이 왜 크게 성공할 수 있는가 — 수익 모델을 적극 긍정하는 관점.",
    "",
  );
  lines.push(`**수익 모델:** ${thesis.revenueModel}`, "");
  lines.push("*   **성장 지렛대 (Growth Levers):**");
  lines.push(...thesis.growthLevers.map((g) => `    *   ${g}`));
  lines.push("*   **시장 순풍 (Market Tailwinds):**");
  lines.push(...thesis.marketTailwinds.map((t) => `    *   ${t}`));
  lines.push("", `**최상 시나리오:** ${thesis.bestCaseScenario}`, "");
  lines.push(`**핵심 논지:** ${thesis.winningThesis}`, "");

  lines.push("## 3. 냉정한 반론 (Antithesis / 反)", "");
  lines.push(
    "> [경고] 본 아이디어가 실패할 확률이 높은 구조적 이유를 나열합니다.",
    "",
  );
  lines.push("*   **페인포인트의 허구성:**");
  lines.push(...criticismLines(criticism.points, "painPoint"));
  lines.push("*   **수익 모델(BM)의 취약성:**");
  lines.push(...criticismLines(criticism.points, "bm"));
  lines.push("*   **카피캣 리스크:**");
  lines.push(...criticismLines(criticism.points, "copycat"));
  lines.push("", `**최종 평결:** ${criticism.verdict}`, "");

  lines.push("## 4. 종합과 재설계 (Synthesis / 合)", "");
  if (solution.synthesis !== undefined) {
    lines.push(`**종합 통찰:** ${solution.synthesis}`, "");
  }
  lines.push(`**재설계된 컨셉:** ${solution.revisedConcept}`, "");
  lines.push("### ① 데이터 수집 및 최소 입력 구조 (Minimal Input)", "");
  lines.push(solution.minimalInput, "");
  lines.push("### ② 에이전틱 워크플로우 (Agentic Workflow)", "");
  lines.push(solution.agenticWorkflow, "");
  lines.push("### ③ 독점적 데이터 플라이휠 (Data Flywheel)", "");
  lines.push(solution.dataFlywheel, "");

  lines.push("## 5. 지속 가능한 비즈니스 모델 (Monetization Model)", "");
  lines.push(solution.monetization, "");

  return lines.join("\n");
}
