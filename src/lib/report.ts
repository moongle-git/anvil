import {
  DIALECTIC_AXES,
  DIALECTIC_AXIS_LABELS,
  RECOMMENDATION_LABELS,
} from "../types/index.js";
import type {
  CommunityVoice,
  CompetitorService,
  Criticism,
  CriticismPoint,
  DialecticAxis,
  MarketContext,
  ResidualRisk,
  Solution,
  Thesis,
  ThesisPoint,
  Verdict,
} from "../types/index.js";

/** 마크다운 표의 셀 구분자(|)와 줄바꿈이 표를 깨뜨리지 않게 한다 */
function tableCell(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\n/g, " ");
}

function competitorRow(competitor: CompetitorService): string {
  const link =
    competitor.url === undefined ? "—" : `[링크](${competitor.url})`;
  const pricing =
    competitor.pricingHint === undefined
      ? "—"
      : tableCell(competitor.pricingHint);
  return `| ${tableCell(competitor.name)} | ${tableCell(competitor.description)} | ${pricing} | ${link} |`;
}

function voiceBlock(voice: CommunityVoice): string {
  // 댓글 원문에 줄바꿈이 있어도 인용 블록이 끊기지 않게 한다
  const text = voice.text.replace(/\n/g, "\n> ");
  const score = voice.score === undefined ? "" : `, 좋아요 ${voice.score}`;
  return `> "${text}"\n> — ${voice.title} (${voice.url}${score})`;
}

function bullets(items: readonly string[]): string[] {
  return items.map((item) => `*   ${item}`);
}

function byAxis<T extends { axis: DialecticAxis }>(
  points: readonly T[],
  axis: DialecticAxis,
): T[] {
  return points.filter((point) => point.axis === axis);
}

/** 1절 원시 근거 — 정제된 인사이트만 본문에 두고 원문은 접는다 (PRD 컴포넌트 매핑) */
function rawEvidenceDetails(context: MarketContext): string[] {
  const summary =
    `원시 근거 — 경쟁 서비스 ${context.competitors.length}개` +
    ` · 유저 목소리 ${context.communityVoices.length}건` +
    ` · 트렌드 ${context.trends.length}건` +
    ` · 출처 ${context.sources.length}개`;

  const lines: string[] = ["<details>", `<summary>${summary}</summary>`, ""];

  lines.push("#### 경쟁 서비스", "");
  if (context.competitors.length === 0) {
    lines.push("수집된 경쟁 서비스 없음", "");
  } else {
    lines.push("| 이름 | 설명 | 가격 힌트 | 링크 |", "| --- | --- | --- | --- |");
    lines.push(...context.competitors.map(competitorRow), "");
  }

  lines.push("#### 유저 목소리", "");
  if (context.communityVoices.length === 0) {
    lines.push("수집된 유저 목소리 없음", "");
  } else {
    for (const voice of context.communityVoices) {
      lines.push(voiceBlock(voice), "");
    }
  }

  lines.push("#### 트렌드", "", ...bullets(context.trends), "");
  lines.push(
    "#### 페인포인트 근거",
    "",
    ...bullets(context.painPointEvidence),
    "",
  );
  lines.push("#### 출처", "", ...bullets(context.sources), "");
  lines.push("</details>", "");

  return lines;
}

function thesisPointLines(point: ThesisPoint): string[] {
  return [`*   **${point.claim}**`, `    *   근거: ${point.rationale}`];
}

function criticismPointLines(
  point: CriticismPoint,
  thesisPoints: readonly ThesisPoint[],
): string[] {
  const badge = `**[${point.severity.toUpperCase()} · ${point.riskScore}/100 · ${point.riskKeyword}]**`;
  const lines = [`${badge} ${point.claim}`, ""];

  // rebuts가 끊어진 참조를 가리키면 조용히 무시한다 — 스키마가 교차 참조를 검증하지 않는다
  const rebutted = thesisPoints.find((t) => t.id === point.rebuts);
  if (rebutted !== undefined) {
    lines.push(`↳ 반박 대상: 正 "${rebutted.claim}"`, "");
  }

  lines.push(
    "<details>",
    "<summary>근거</summary>",
    "",
    point.evidence,
    "",
    "</details>",
    "",
  );
  return lines;
}

function residualRiskLine(risk: ResidualRisk): string {
  return `*   **[${risk.severity.toUpperCase()}]** ${risk.keyword} — ${risk.note}`;
}

/**
 * 5단계 순차 논증 구조의 마크다운 컨설팅 리포트를 렌더링하는 순수 함수 (ADR-008).
 * 1. 시장 맥락 → 2. 낙관적 가설(正) → 3. 냉정한 비판(反) → 4. 인사이트 및 재설계(合) → 5. 최종 판정.
 * 결론은 마지막에 단 하나만 온다: 수익화는 合의 하위 절이고, 최종 판정은 verdict 에이전트의 몫이다 (ADR-010).
 */
export function renderReport(
  idea: string,
  context: MarketContext,
  thesis: Thesis,
  criticism: Criticism,
  solution: Solution,
  verdict: Verdict,
): string {
  const lines: string[] = [];

  lines.push(`# [컨설팅 리포트] ${context.ideaTitle}`, "");
  lines.push(`> 입력 아이디어: ${idea}`, "");

  // ── 1. 시장 맥락 ──
  lines.push("## 1. 시장 맥락 (Context)", "");
  lines.push(context.briefing, "");
  if (context.marketSizeIndicators.length > 0) {
    lines.push("### 시장 규모 지표", "");
    lines.push(...bullets(context.marketSizeIndicators), "");
  }
  lines.push("### 경쟁 구도", "", context.competitorInsight, "");
  lines.push("### 타겟 유저의 목소리", "", context.voicesInsight, "");
  lines.push(...rawEvidenceDetails(context));

  // ── 2. 正 ──
  lines.push("## 2. 낙관적 가설 (正 / Thesis)", "");
  lines.push(
    "> 이 사업이 왜 크게 성공할 수 있는가 — 수익 모델을 적극 긍정하는 관점.",
    "",
  );
  lines.push(thesis.winningThesis, "");
  lines.push("### 수익 모델", "", thesis.revenueModel, "");
  lines.push("### 성장 지렛대", "", ...bullets(thesis.growthLevers), "");
  lines.push("### 시장 순풍", "", ...bullets(thesis.marketTailwinds), "");
  lines.push("### 최상 시나리오", "", thesis.bestCaseScenario, "");
  lines.push("### 축별 낙관 주장", "");
  for (const axis of DIALECTIC_AXES) {
    const points = byAxis(thesis.points, axis);
    if (points.length === 0) continue;
    lines.push(`#### ${DIALECTIC_AXIS_LABELS[axis]}`, "");
    lines.push(...points.flatMap(thesisPointLines), "");
  }

  // ── 3. 反 ──
  lines.push("## 3. 냉정한 비판 (反 / Antithesis)", "");
  lines.push(
    "> [경고] 본 아이디어가 실패할 확률이 높은 구조적 이유를 나열합니다.",
    "",
  );
  for (const axis of DIALECTIC_AXES) {
    const points = byAxis(criticism.points, axis);
    if (points.length === 0) continue;
    lines.push(`### ${DIALECTIC_AXIS_LABELS[axis]}`, "");
    lines.push(
      ...points.flatMap((point) => criticismPointLines(point, thesis.points)),
    );
  }
  // 反의 소결론이지 최종 판정이 아니다 (ADR-010)
  lines.push(`**反의 소결론:** ${criticism.verdict}`, "");

  // ── 4. 合 ──
  lines.push("## 4. 인사이트 및 재설계 (合 / Synthesis)", "");
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
  lines.push("### ④ 지속 가능한 비즈니스 모델 (Monetization Model)", "");
  lines.push(solution.monetization, "");

  // ── 5. 최종 판정 ──
  lines.push("## 5. 최종 판정 (Verdict)", "");
  lines.push(`**${verdict.headline}**`, "");
  lines.push(
    `생존 점수 ${verdict.survivalScore}/100 · 판정: ${RECOMMENDATION_LABELS[verdict.recommendation]}`,
    "",
  );
  lines.push(verdict.rationale, "");
  lines.push("### 잔존 리스크", "");
  lines.push(...verdict.residualRisks.map(residualRiskLine), "");
  lines.push("### 생존 조건", "");
  lines.push(
    ...verdict.conditions.map((condition, i) => `${i + 1}. ${condition}`),
    "",
  );

  return lines.join("\n");
}
