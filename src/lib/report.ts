import {
  DIALECTIC_AXES,
  DIALECTIC_AXIS_LABELS,
  fatalLedger,
  HORIZON_LABELS,
  RECOMMENDATION_LABELS,
  REMEDY_STRATEGY_LABELS,
  REMEDY_VERDICT_LABELS,
  REMEDY_VERDICTS,
  RESEARCH_SOURCE_IDS,
  SIGNAL_TYPE_LABELS,
  SOURCE_LABELS,
} from "../types/index.js";
import type {
  Citation,
  CommunityVoice,
  CompetitorService,
  Criticism,
  CriticismPoint,
  DialecticAxis,
  LedgerEntry,
  MarketContext,
  ResidualRisk,
  ResolvedCapitalSignal,
  ScoutOrigin,
  Solution,
  SourceCoverage,
  Thesis,
  ThesisPoint,
  Verdict,
} from "../types/index.js";

/** 마크다운 표의 셀 구분자(|)와 줄바꿈이 표를 깨뜨리지 않게 한다 */
function tableCell(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\n/g, " ");
}

/**
 * 벌거벗은 URL은 대부분의 마크다운 뷰어에서 자동 링크가 된다.
 * 검증되지 않은 URL에 href가 붙는 것은 거짓 신호이므로 코드 스팬으로 자동 링크를 차단한다 (ADR-013).
 */
function inlineCode(value: string): string {
  // 코드 스팬은 줄바꿈을 넘지 못한다
  const oneLine = value.replace(/\n/g, " ");
  // 값 안의 백틱보다 긴 울타리를 쓰고, 값이 백틱으로 시작·끝나면 공백을 덧대야 코드 스팬이 성립한다
  const runs = oneLine.match(/`+/g) ?? [];
  const fence = "`".repeat(
    runs.reduce((longest, run) => Math.max(longest, run.length), 0) + 1,
  );
  const pad = oneLine.startsWith("`") || oneLine.endsWith("`") ? " " : "";
  return `${fence}${pad}${oneLine}${pad}${fence}`;
}

function competitorRow(competitor: CompetitorService): string {
  // LLM이 타이핑한 URL이라 실측 60%가 죽어 있다 — 링크를 걸지 않고 텍스트로만 남긴다 (ADR-013)
  const url =
    competitor.url === undefined
      ? "—"
      : inlineCode(tableCell(competitor.url));
  const pricing =
    competitor.pricingHint === undefined
      ? "—"
      : tableCell(competitor.pricingHint);
  return `| ${tableCell(competitor.name)} | ${tableCell(competitor.description)} | ${pricing} | ${url} |`;
}

/**
 * 출처 줄에 소스 라벨을 박는다 — 같은 인용도 어느 커뮤니티에서 왔는지에 따라 무게가 다르다.
 * url은 코드가 수집 API 응답에서 주입한 permalink라 링크로 남긴다 (ADR-013).
 */
function voiceBlock(voice: CommunityVoice): string {
  // 댓글 원문에 줄바꿈이 있어도 인용 블록이 끊기지 않게 한다
  const text = voice.text.replace(/\n/g, "\n> ");
  const meta = [`[출처](${voice.url})`];
  if (voice.score !== undefined) meta.push(`좋아요 ${voice.score}`);
  if (voice.extra !== undefined) meta.push(voice.extra);
  return `> "${text}"\n> — [${SOURCE_LABELS[voice.source]}] ${voice.title} (${meta.join(", ")})`;
}

/**
 * origin은 urlContext가 실제로 읽어낸 원본 URL이라 링크로 남기고,
 * redirect는 만료되면 404가 되는 vertexaisearch URL이라 링크를 박탈한다 (ADR-013).
 */
function citationItem(citation: Citation): string {
  if (citation.kind === "origin") {
    return `[${citation.title ?? citation.domain ?? citation.uri}](${citation.uri})`;
  }
  const label = citation.title ?? citation.domain ?? inlineCode(citation.uri);
  const domain =
    citation.domain !== undefined && citation.domain !== label
      ? ` (${citation.domain})`
      : "";
  return `${label}${domain} — 만료 가능한 검색 리다이렉트`;
}

/** 가장 강한 인용과 반드시 깨질 인용을 한 목록에 섞지 않는다 — 독자가 무엇을 믿을지 판단해야 한다 */
function citationSection(citations: readonly Citation[]): string[] {
  const origins = citations.filter((citation) => citation.kind === "origin");
  const redirects = citations.filter((citation) => citation.kind === "redirect");
  const lines = ["#### 검색 인용", ""];

  if (origins.length > 0) {
    lines.push(
      "##### 원본 (직접 읽어낸 페이지)",
      "",
      ...bullets(origins.map(citationItem)),
      "",
    );
  }
  if (redirects.length > 0) {
    lines.push(
      "##### 검색 리다이렉트 (만료 가능 · 링크 없음)",
      "",
      ...bullets(redirects.map(citationItem)),
      "",
    );
  }
  return lines;
}

/**
 * 머리말의 출처 줄. citationItem의 규약(origin은 링크, redirect는 링크 박탈 + 만료 고지)을
 * 그대로 쓰되 origin에도 domain을 덧붙인다 — citationItem은 링크 텍스트가 제목이면 domain을
 * 감추는데, 출처가 통신사인지 개인 블로그인지는 신호의 무게를 가르는 정보다.
 * 코드가 도메인으로 걸러내지는 않는다. 판단은 읽는 사람의 몫이고, 코드가 대신 정하면
 * 조용히 편향이 박힌다.
 */
function scoutCitation(citation: Citation): string {
  const rendered = citationItem(citation);
  return citation.kind === "origin" && citation.domain !== undefined
    ? `${rendered} (${citation.domain})`
    : rendered;
}

/**
 * 신호 한 줄. 날짜를 빠뜨리지 않는 것이 핵심이다 — observedAt이 이 주제가 모델의 사전지식이
 * 아니라 검색된 사실에서 나왔다는 유일한 증거다 (opportunity.ts).
 */
function scoutSignalLine(signal: ResolvedCapitalSignal): string {
  const dates = [`관측 ${signal.observedAt}`];
  if (signal.effectiveAt !== undefined) {
    dates.push(`시행 ${signal.effectiveAt}`);
  }
  return (
    `*   **[${SIGNAL_TYPE_LABELS[signal.signalType]}]** ${signal.statement}` +
    ` (${dates.join(" · ")}) — 출처: ${scoutCitation(signal.citation)}`
  );
}

/**
 * 스카우트 모드의 머리말 — 1절 앞에 오는 머리말이지 새 섹션이 아니다.
 *
 * 번호 섹션(`## 6.`)으로 만들지 않는 이유는 5단계 서사의 순서가 협상 불가이기 때문이고(PRD),
 * 부록으로 뒤에 붙이지 않는 이유는 독자가 1절을 읽기 전에 "이 주제가 어디서 왔는가"를 알아야
 * 하기 때문이다 — 다 읽고 나서 알면 앞의 논증을 다시 읽어야 한다.
 *
 * 담기는 것은 **출처이지 판정이 아니다.** 점수·권고·결론은 5절에만 온다 (ADR-008).
 * 그래서 이 함수는 verdict를 인자로 받지 않는다 — remedySection과 같은 규율이다.
 */
function scoutOriginSection(origin: ScoutOrigin): string[] {
  const { opportunity } = origin;
  return [
    "### 이 주제의 출처 (자동 탐색)",
    "",
    "> 이 주제는 사람이 고른 것이 아니라 자본 신호 탐색이 후보로 올린 것이다." +
      " 아래는 그 근거이며, 유효한지에 대한 판정은 5절에 있다.",
    "",
    ...bullets([
      `**탐색 범위:** ${origin.scope}`,
      `**탐색 시점:** ${origin.searchedAt}`,
      `**왜 지금인가:** ${opportunity.whyNow}`,
      `**누가 돈을 내나:** ${opportunity.whoPays}`,
      `**시계:** ${HORIZON_LABELS[opportunity.horizon]}`,
    ]),
    "",
    "#### 근거 신호",
    "",
    ...opportunity.signals.map(scoutSignalLine),
    "",
    // 유리한 신호만 남기면 리포트가 자기 홍보물이 된다. 반대 증거는 후보 스키마가 필수로
    // 요구한 것이므로(opportunity.ts), 렌더링에서 조용히 빠지면 그 강제가 무의미해진다
    "#### 반대 증거",
    "",
    scoutSignalLine(opportunity.counterSignal),
    "",
  ];
}

/**
 * 세 상태를 절대 뭉개지 않는다 (ADR-013): "조사했는데 0건"은 시장 신호이고,
 * "키가 없어 조사조차 안 했다"는 우리 설정 문제다. 같은 문구로 쓰면 리포트가 근거 부재를 숨긴다.
 */
function coverageLine(coverage: SourceCoverage): string {
  const label = SOURCE_LABELS[coverage.source];
  switch (coverage.status) {
    case "collected":
      return coverage.count === 0
        ? `${label} — 0건 (검색됐으나 결과 없음)`
        : `${label} — ${coverage.count}건`;
    case "unconfigured":
      return `${label} — 미설정으로 수집하지 않음`;
    case "failed":
      return `${label} — 수집 실패: ${coverage.error ?? "원인 미상"}`;
  }
}

/**
 * 근거를 보여주기 전에 근거의 범위부터 밝힌다 (ADR-013).
 * researchCoverage가 비면 구 run(수집 기록 이전)이므로 블록째 생략한다 — 모르는 것을 지어내지 않는다.
 */
function coverageSection(context: MarketContext): string[] {
  if (context.researchCoverage.length === 0) return [];

  const items = context.researchCoverage.map(coverageLine);
  // grounding이 인용을 하나도 안 돌려준 채로 8/8 run이 조용히 지나갔다 — 침묵하지 않는다
  items.push(
    context.citations.length === 0
      ? "웹검색 — 인용 없음 (grounding이 인용을 반환하지 않았다)"
      : `웹검색 — 인용 ${context.citations.length}건`,
  );
  return ["### 자료조사 커버리지", "", ...bullets(items), ""];
}

/**
 * 소스별 수집 편중이 <summary> 한 줄에 드러나야 한다 — HN 0건은 근거 편향이다.
 * 0건 소스를 목록에서 지우면 독자는 그 소스가 빠졌다는 사실 자체를 알 수 없다.
 */
function voiceBreakdown(
  voices: readonly CommunityVoice[],
  coverage: readonly SourceCoverage[],
): string {
  const parts = RESEARCH_SOURCE_IDS.map((source) => {
    const label = SOURCE_LABELS[source];
    const status = coverage.find((entry) => entry.source === source)?.status;
    if (status === "unconfigured") return `${label} 미설정`;
    if (status === "failed") return `${label} 수집 실패`;
    const count = voices.filter((voice) => voice.source === source).length;
    return `${label} ${count}`;
  });
  return `(${parts.join(" · ")})`;
}

/** 접힌 근거의 건수 표기. 0인 항목은 뺀다 (UI_GUIDE 정보 밀도) */
function evidenceSummary(context: MarketContext): string {
  const parts: string[] = [];
  if (context.competitors.length > 0) {
    parts.push(`경쟁 서비스 ${context.competitors.length}개`);
  }
  if (context.communityVoices.length > 0) {
    parts.push(
      `유저 목소리 ${context.communityVoices.length}건${voiceBreakdown(context.communityVoices, context.researchCoverage)}`,
    );
  }
  if (context.trends.length > 0) {
    parts.push(`트렌드 ${context.trends.length}건`);
  }
  if (context.sources.length > 0) {
    // 접기 전에도 신뢰도가 드러나야 한다 — "출처 N개"는 검증됐다는 오해를 부른다 (ADR-013)
    parts.push(`미검증 출처 ${context.sources.length}개`);
  }
  if (context.citations.length > 0) {
    parts.push(`검색 인용 ${context.citations.length}개`);
  }
  return parts.length > 0 ? `원시 근거 — ${parts.join(" · ")}` : "원시 근거";
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
  const lines: string[] = [
    "<details>",
    `<summary>${evidenceSummary(context)}</summary>`,
    "",
  ];

  lines.push("#### 경쟁 서비스", "");
  if (context.competitors.length === 0) {
    lines.push("수집된 경쟁 서비스 없음", "");
  } else {
    lines.push(
      "| 이름 | 설명 | 가격 힌트 | URL (미검증) |",
      "| --- | --- | --- | --- |",
    );
    lines.push(...context.competitors.map(competitorRow), "");
  }

  lines.push("#### 유저 목소리", "");
  if (context.communityVoices.length === 0) {
    lines.push("수집된 유저 목소리 없음", "");
  } else {
    for (const source of RESEARCH_SOURCE_IDS) {
      const voices = context.communityVoices.filter(
        (voice) => voice.source === source,
      );
      if (voices.length === 0) continue;
      lines.push(`##### ${SOURCE_LABELS[source]}`, "");
      lines.push(...voices.flatMap((voice) => [voiceBlock(voice), ""]));
    }
  }

  lines.push("#### 트렌드", "", ...bullets(context.trends), "");
  lines.push(
    "#### 페인포인트 근거",
    "",
    ...bullets(context.painPointEvidence),
    "",
  );
  lines.push(
    "#### 출처 (LLM 자기보고 · 미검증)",
    "",
    "> 아래 항목은 모델이 자기 기억으로 적어낸 것이라 검증되지 않았다. 링크를 걸지 않는다.",
    "",
    ...bullets(context.sources.map(inlineCode)),
    "",
  );
  // sources(LLM 자기보고)와 citations(코드가 grounding에서 추출)는 실패 모드가 상보적이라
  // 한 목록으로 합치지 않는다 — 무엇을 믿을지는 독자가 판단한다 (ADR-012)
  if (context.citations.length > 0) {
    lines.push(...citationSection(context.citations));
  }
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

  // rebuts가 끊어진 참조를 가리키면 조용히 무시한다. solution.remedies·verdict.remedyAudits와
  // 달리 rebuts에는 교차 검증이 없다 — 실측상 dangling이 참조 16건 중 0건이라 ADR-017이
  // 근거 부족을 이유로 검증을 사양했다(측정하지 않고 최적화하지 않는다). 렌더러는 검증기가 아니다.
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

function remedyBullet(entry: LedgerEntry): string[] {
  const { point, remedy } = entry;
  const head = remedy === undefined ? "해결책 없음" : REMEDY_STRATEGY_LABELS[remedy.strategy];
  const body =
    remedy === undefined
      ? // 침묵은 두 문서 간의 집합 뺄셈이라 코드가 증명할 수 있는 사실이다. 그러나 그것을
        // 실패라 부르는 것은 판단이고, 판단은 5절의 몫이다 (ADR-008 / ADR-017)
        "재설계는 이 결함에 대해 아무 말도 하지 않았다."
      : remedy.remedy;
  return [`*   **[${head}] ${point.riskKeyword}** — ${point.claim}`, `    *   ${body}`];
}

/**
 * 4절의 해결책 블록. 감사 결과는 여기 오지 않는다 — "재주장" 칩이 4절에 뜨면 독자가 5절 전에
 * 결론을 알게 되고, 그 순간 正/反 대립은 읽을 이유가 없는 장식이 된다 (ADR-008).
 * 그래서 이 함수는 verdict를 인자로 받지 않는다: 넘길 수 없는 것은 새어 나갈 수도 없다.
 */
function remedySection(criticism: Criticism, solution: Solution): string[] {
  const entries = fatalLedger(criticism, solution);
  if (entries.length === 0) return [];
  return [
    "### 치명적 결함에 대한 해결책 (재설계의 주장 · 미검증)",
    "",
    "> 아래는 재설계가 스스로 낸 대응이지 검증된 사실이 아니다. 유효한지는 5절 최종 판정이 항목별로 감사한다.",
    "",
    ...entries.flatMap(remedyBullet),
    "",
  ];
}

function ledgerRow(entry: LedgerEntry): string {
  const { point, remedy, audit } = entry;
  const criticism = `**${tableCell(point.riskKeyword)}** ${tableCell(point.claim)}`;
  const solution =
    remedy === undefined
      ? "해결책 없음"
      : `**[${REMEDY_STRATEGY_LABELS[remedy.strategy]}]** ${tableCell(remedy.remedy)}`;
  // 감사가 없는 것은 판정이 이 항목을 봐주고 넘어간 것이 아니라 원장 이전에 저장된 run이라는 뜻이다
  const verdict =
    audit === undefined
      ? "—"
      : `**[${REMEDY_VERDICT_LABELS[audit.assessment]}]** ${tableCell(audit.note)}`;
  return `| ${criticism} | ${solution} | ${verdict} |`;
}

/** 요약 줄의 숫자는 전부 원장에서 파생된다 — 따로 세면 표와 어긋나는 두 번째 진실이 생긴다 */
function ledgerSummary(entries: readonly LedgerEntry[]): string {
  const remedied = entries.filter((entry) => entry.remedy !== undefined).length;
  const audited = REMEDY_VERDICTS.map((assessment) => ({
    assessment,
    count: entries.filter((entry) => entry.audit?.assessment === assessment).length,
  }))
    .filter(({ count }) => count > 0)
    .map(({ assessment, count }) => `${REMEDY_VERDICT_LABELS[assessment]} ${count}`);
  const breakdown = audited.length > 0 ? ` (${audited.join(" · ")})` : "";
  return `비판이 제기한 치명적 결함 ${entries.length}건 → 해결책 ${remedied}건${breakdown}`;
}

/**
 * 5절의 원장 — 잔존 리스크 앞에 온다. 결함↔해결책 쌍은 부록이 아니라 판정의 근거다 (PRD).
 * 감사 결과가 처음이자 유일하게 등장하는 곳이 여기다.
 */
function ledgerSection(
  criticism: Criticism,
  solution: Solution,
  verdict: Verdict,
): string[] {
  const entries = fatalLedger(criticism, solution, verdict);
  if (entries.length === 0) return [];
  return [
    "### 결함↔해결책 원장",
    "",
    ledgerSummary(entries),
    "",
    "| 비판 | 재설계의 해결책 | 판정의 감사 |",
    "| --- | --- | --- |",
    ...entries.map(ledgerRow),
    "",
  ];
}

/**
 * 5단계 순차 논증 구조의 마크다운 컨설팅 리포트를 렌더링하는 순수 함수 (ADR-008).
 * 1. 시장 맥락 → 2. 낙관적 가설(正) → 3. 냉정한 비판(反) → 4. 인사이트 및 재설계(合) → 5. 최종 판정.
 * 결론은 마지막에 단 하나만 온다: 수익화는 合의 하위 절이고, 최종 판정은 verdict 에이전트의 몫이다 (ADR-010).
 *
 * scoutOrigin은 스카우트 모드에서만 넘어온다. 선택적인 것은 편의가 아니라 계약이다 —
 * 직접 입력 모드의 report.md는 이 인자가 생기기 전과 바이트 단위로 같아야 한다.
 */
export function renderReport(
  idea: string,
  context: MarketContext,
  thesis: Thesis,
  criticism: Criticism,
  solution: Solution,
  verdict: Verdict,
  scoutOrigin?: ScoutOrigin,
): string {
  const lines: string[] = [];

  lines.push(`# [컨설팅 리포트] ${context.ideaTitle}`, "");
  lines.push(`> 입력 아이디어: ${idea}`, "");
  // 논증보다 먼저 온다 — "이 주제가 왜 여기 있는가"를 모르면 뒤의 5단계를 다시 읽어야 한다
  if (scoutOrigin !== undefined) {
    lines.push(...scoutOriginSection(scoutOrigin));
  }

  // ── 1. 시장 맥락 ──
  lines.push("## 1. 시장 맥락 (Context)", "");
  // 근거의 범위를 먼저 알리고 그 다음에 근거를 보여준다 (ADR-013)
  lines.push(...coverageSection(context));
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
  // 결함↔해결책 쌍이 이 리포트의 핵심 산출물인데 그동안 revisedConcept 줄글에 묻혀 있었다 (ADR-017)
  lines.push(...remedySection(criticism, solution));
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
  // 잔존 리스크 앞이다 — 무엇을 solid라 불렀는지가 곧 점수의 근거다
  lines.push(...ledgerSection(criticism, solution, verdict));
  lines.push("### 잔존 리스크", "");
  lines.push(...verdict.residualRisks.map(residualRiskLine), "");
  lines.push("### 생존 조건", "");
  lines.push(
    ...verdict.conditions.map((condition, i) => `${i + 1}. ${condition}`),
    "",
  );

  return lines.join("\n");
}
