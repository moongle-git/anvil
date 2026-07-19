import { describe, expect, it } from "vitest";
import {
  DIALECTIC_AXIS_LABELS,
  HORIZON_LABELS,
  MarketContextSchema,
  RECOMMENDATION_LABELS,
  REMEDY_STRATEGY_LABELS,
  REMEDY_VERDICT_LABELS,
  SIGNAL_TYPE_LABELS,
  SOURCE_LABELS,
  toPromptContext,
  type Criticism,
  type MarketContext,
  type ScoutOrigin,
  type Solution,
  type SourceCoverage,
  type Thesis,
  type Verdict,
} from "../types/index.js";
import { renderReport } from "./report.js";

const IDEA = "AI가 반려식물 상태를 진단하고 관리 일정을 챙겨주는 서비스";

/** urlContext가 실제로 읽어낸 원본 URL — 만료되지 않는 유일한 검색 인용이다 (ADR-013) */
const ORIGIN_CITATION = {
  uri: "https://getplanta.com/pricing",
  title: "Planta 요금제",
  domain: "getplanta.com",
  kind: "origin" as const,
};

/** groundingChunks의 vertexaisearch 리다이렉트 — 만료되면 404다 */
const REDIRECT_CITATION = {
  uri: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/aaa",
  title: "홈가드닝 시장 리포트 2026",
  domain: "statista.com",
  kind: "redirect" as const,
};

const REDIRECT_CITATION_NO_TITLE = {
  uri: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/bbb",
  domain: "getplanta.com",
  kind: "redirect" as const,
};

const context: MarketContext = {
  ideaTitle: "AI 반려식물 관리 서비스",
  briefing:
    "홈가드닝 시장은 성장 중이지만 무료 리마인더 앱이 이미 시장을 선점했다. 유료 전환은 진단 정확도에 달려 있다.",
  marketSizeIndicators: ["홈가드닝 시장 연 10% 성장"],
  competitorInsight:
    "리마인더 기능은 무료로 평준화됐고, 유료 경쟁은 사진 기반 진단 정확도에서 벌어진다.",
  voicesInsight:
    "유저는 물주기 타이밍보다 이미 시든 뒤에야 알아차리는 늦은 감지를 더 큰 고통으로 말한다.",
  trends: ["홈가드닝 시장 성장", "식물 집사 커뮤니티 확산"],
  competitors: [
    {
      name: "Planta",
      description: "식물 관리 앱",
      url: "https://getplanta.com",
      pricingHint: "월 4.99달러",
    },
    { name: "PictureThis", description: "식물 식별 앱" },
  ],
  communityVoices: [
    {
      source: "youtube",
      title: "식물 키우기 실패담",
      url: "https://youtube.com/watch?v=abc",
      text: "물주기 타이밍을 늘 놓쳐요",
      authorName: "user1",
      score: 12,
    },
    {
      source: "youtube",
      title: "반려식물 브이로그",
      url: "https://youtube.com/watch?v=def",
      text: "앱 알림은 결국 다 꺼버리게 되더라고요",
    },
    {
      source: "hackernews",
      title: "Show HN: Plant care reminders that actually work",
      url: "https://news.ycombinator.com/item?id=1234",
      text: "Reminders are useless. I need to know the plant is dying before it looks dead.",
      authorName: "hn_user",
      score: 120,
    },
    {
      source: "naver",
      title: "몬스테라 잎이 노랗게 변했어요",
      url: "https://cafe.naver.com/plant/1",
      text: "물을 준 지 3일밖에 안 됐는데 잎이 노래져요...",
      authorName: "식집사카페",
      extra: "검색 스니펫",
    },
  ],
  painPointEvidence: ["물주기 실패로 식물을 죽인 경험이 반복된다"],
  sources: ["https://example.com/trend"],
  researchCoverage: [],
  citations: [REDIRECT_CITATION, REDIRECT_CITATION_NO_TITLE, ORIGIN_CITATION],
};

const thesis: Thesis = {
  points: [
    {
      id: "t1",
      axis: "painPoint",
      claim: "식물을 죽인 경험은 반복되는 실질적 고통이다",
      rationale: "댓글 '물주기 타이밍을 늘 놓쳐요'가 반복 등장한다",
    },
    {
      id: "t2",
      axis: "bm",
      claim: "실패 방지에는 지불 의사가 생긴다",
      rationale: "Planta가 월 4.99달러 구독으로 유료 시장을 검증했다",
    },
    {
      id: "t3",
      axis: "copycat",
      claim: "가정별 생육 데이터는 대기업이 복제할 수 없는 해자다",
      rationale: "경쟁 서비스 어느 곳도 개별 환경 데이터를 축적하지 않는다",
    },
  ],
  revenueModel: "무료 진단으로 유입 후 생존 보장형 케어 구독으로 전환한다",
  growthLevers: ["케어 성공 사진 공유 바이럴", "화원 대상 진단 API 번들"],
  marketTailwinds: ["홈가드닝 시장 성장", "온디바이스 비전 모델 단가 하락"],
  bestCaseScenario: "2년 내 구독 전환율 8% 달성 시 국내 식물 케어 1위",
  winningThesis: "'실패 없는 케어'라는 명확한 가치가 유료 전환을 이끈다",
};

const criticism: Criticism = {
  points: [
    {
      id: "c1",
      axis: "painPoint",
      rebuts: "t1",
      claim: "페인포인트가 약하다",
      evidence: "댓글 '물주기 타이밍을 늘 놓쳐요'는 불편이지 지불 동기가 아니다",
      severity: "major",
      riskScore: 50,
      riskKeyword: "약한 지불 동기",
    },
    {
      id: "c2",
      axis: "bm",
      rebuts: "t2",
      claim: "지불 의사가 낮다",
      evidence: "Planta가 월 4.99달러에 동일 기능을 제공한다",
      severity: "fatal",
      riskScore: 85,
      riskKeyword: "무료 대체재",
    },
    {
      id: "c3",
      axis: "copycat",
      rebuts: "t3",
      claim: "진입장벽이 없다",
      evidence: "PictureThis가 기능 추가로 즉시 대응 가능하다",
      severity: "minor",
      riskScore: 25,
      riskKeyword: "해자 부재",
    },
  ],
  verdict: "현재 형태로는 실패 확률이 높다",
};

const solution: Solution = {
  minimalInput: "사진 한 장으로 진단을 시작한다",
  agenticWorkflow: "에이전트가 관리 일정을 자동 생성하고 백그라운드에서 갱신한다",
  dataFlywheel: "가정별 생육 환경·실패 이력 데이터를 축적한다",
  monetization: "식물 생존 보장형 구독 모델",
  revisedConcept: "제로 UI 식물 집사 — fatal 비판(지불 의사)에 보장형 과금으로 대응한다",
  synthesis:
    "낙관의 성장 동력과 반론의 지불 의사 한계를 종합하면 '생존 보장'이 유일한 해자다",
  // c2(유일한 fatal)를 덮는다 — solutionSchemaFor가 통과시키는 원장의 최소 형태다 (ADR-017)
  remedies: [
    {
      respondsTo: "c2",
      strategy: "bypass",
      remedy: "무료 대체재와 같은 기능이 아니라 '죽으면 환불'이라는 결과를 판다",
    },
  ],
};

const verdict: Verdict = {
  survivalScore: 58,
  recommendation: "pivot",
  headline: "리마인더 앱으로는 죽고, 생존 보장 구독으로는 산다",
  rationale:
    "反의 fatal 비판(무료 대체재)은 合이 생존 보장형 과금으로 우회했으나, 해자 부재는 방어되지 않았다",
  residualRisks: [
    {
      keyword: "해자 부재",
      severity: "major",
      note: "PictureThis가 동일 기능을 추가하면 차별점이 사라진다",
    },
  ],
  conditions: ["출시 6개월 내 유료 전환율 5% 확보"],
  remedyAudits: [
    {
      criticismId: "c2",
      assessment: "solid",
      note: "결과 보장은 무료 리마인더가 흉내 낼 수 없는 약속이다",
    },
  ],
};

/** 첫 번째 <details> 블록(1절 원시 근거)의 경계 */
function firstDetailsRange(report: string): { open: number; close: number } {
  const open = report.indexOf("<details>");
  const close = report.indexOf("</details>");
  expect(open).toBeGreaterThan(-1);
  expect(close).toBeGreaterThan(open);
  return { open, close };
}

describe("renderReport", () => {
  const report = renderReport(IDEA, context, thesis, criticism, solution, verdict);

  it("5단계 서사의 최상위 섹션이 순서대로 등장한다 (ADR-008)", () => {
    const headings = [
      `# [컨설팅 리포트] ${context.ideaTitle}`,
      "## 1. 시장 맥락 (Context)",
      "## 2. 낙관적 가설 (正 / Thesis)",
      "## 3. 냉정한 비판 (反 / Antithesis)",
      "## 4. 인사이트 및 재설계 (合 / Synthesis)",
      "## 5. 최종 판정 (Verdict)",
    ];
    let cursor = -1;
    for (const heading of headings) {
      const index = report.indexOf(heading);
      expect(index, `누락된 섹션: ${heading}`).toBeGreaterThan(cursor);
      cursor = index;
    }
  });

  it("결론(최종 판정)이 反의 소결론보다 뒤에 온다 (ADR-008 / ADR-010)", () => {
    expect(report.indexOf(criticism.verdict)).toBeLessThan(
      report.indexOf(verdict.headline),
    );
  });

  it("입력 아이디어 원문과 경고 블록을 포함한다", () => {
    expect(report).toContain(`> 입력 아이디어: ${IDEA}`);
    expect(report).toContain(
      "> [경고] 본 아이디어가 실패할 확률이 높은 구조적 이유를 나열합니다.",
    );
  });

  describe("1. 시장 맥락 — Summary는 본문, 원시 근거는 <details>", () => {
    it("briefing·competitorInsight·voicesInsight는 <details> 밖 본문에 있다", () => {
      const { open } = firstDetailsRange(report);
      for (const summary of [
        context.briefing,
        context.competitorInsight,
        context.voicesInsight,
      ]) {
        const index = report.indexOf(summary);
        expect(index).toBeGreaterThan(-1);
        expect(index).toBeLessThan(open);
      }
    });

    it("경쟁사·유저 목소리·트렌드·출처·검색 인용 원문은 <details> 안에 있다", () => {
      const { open, close } = firstDetailsRange(report);
      const raw = [
        context.competitors[0].name,
        context.competitors[0].description,
        context.communityVoices[0].text,
        context.communityVoices[2].text,
        context.communityVoices[3].text,
        context.trends[0],
        context.painPointEvidence[0],
        context.sources[0],
        ORIGIN_CITATION.uri,
      ];
      for (const value of raw) {
        const index = report.indexOf(value);
        expect(index, `누락된 원시 근거: ${value}`).toBeGreaterThan(open);
        expect(index).toBeLessThan(close);
      }
    });

    it("<summary>에 원시 근거 건수와 소스별 내역을 표기한다", () => {
      expect(report).toContain(
        `원시 근거 — 경쟁 서비스 ${context.competitors.length}개` +
          ` · 유저 목소리 ${context.communityVoices.length}건` +
          `(${SOURCE_LABELS.youtube} 2 · ${SOURCE_LABELS.hackernews} 1 · ${SOURCE_LABELS.naver} 1)` +
          ` · 트렌드 ${context.trends.length}건` +
          ` · 미검증 출처 ${context.sources.length}개` +
          ` · 검색 인용 ${context.citations.length}개`,
      );
    });

    it("<summary>에서 0건인 항목은 생략한다", () => {
      const rendered = renderReport(
        IDEA,
        { ...context, citations: [], trends: [] },
        thesis,
        criticism,
        solution,
        verdict,
      );
      const summary = rendered.slice(
        rendered.indexOf("<summary>"),
        rendered.indexOf("</summary>"),
      );
      expect(summary).not.toContain("트렌드");
      expect(summary).not.toContain("검색 인용");
      expect(summary).toContain(`유저 목소리 ${context.communityVoices.length}건`);
    });

    // ── 자료조사 커버리지 (ADR-013): 수집되지 않은 소스를 침묵으로 숨기지 않는다 ──

    describe("자료조사 커버리지", () => {
      const COVERAGE: SourceCoverage[] = [
        { source: "youtube", status: "collected", count: 12 },
        { source: "hackernews", status: "collected", count: 0 },
        { source: "naver", status: "unconfigured", count: 0 },
      ];

      function renderWith(overrides: Partial<MarketContext>): string {
        return renderReport(
          IDEA,
          { ...context, researchCoverage: COVERAGE, ...overrides },
          thesis,
          criticism,
          solution,
          verdict,
        );
      }

      const covered = renderWith({});

      it("커버리지를 근거(<details>)보다 먼저 — 시장 맥락 섹션 상단에 렌더링한다", () => {
        const heading = covered.indexOf("### 자료조사 커버리지");
        expect(heading).toBeGreaterThan(covered.indexOf("## 1. 시장 맥락"));
        expect(heading).toBeLessThan(covered.indexOf("<details>"));
      });

      it("키가 없어 조사조차 안 한 소스를 '미설정'으로 명시한다", () => {
        expect(covered).toContain(
          `${SOURCE_LABELS.naver} — 미설정으로 수집하지 않음`,
        );
      });

      it("'조사했으나 0건'과 '미설정'을 서로 다른 문구로 구분한다", () => {
        // 전자는 시장 신호이고 후자는 우리 설정 문제다 — 뭉개면 근거 부재가 숨는다
        expect(covered).toContain(
          `${SOURCE_LABELS.hackernews} — 0건 (검색됐으나 결과 없음)`,
        );
        expect(covered).not.toContain(`${SOURCE_LABELS.naver} — 0건`);
        expect(covered).not.toContain(
          `${SOURCE_LABELS.hackernews} — 미설정으로 수집하지 않음`,
        );
      });

      it("수집 실패는 사유(error)와 함께 보여준다", () => {
        const rendered = renderWith({
          researchCoverage: [
            {
              source: "naver",
              status: "failed",
              count: 0,
              error: "quota exceeded",
            },
          ],
        });
        expect(rendered).toContain(
          `${SOURCE_LABELS.naver} — 수집 실패: quota exceeded`,
        );
      });

      it("citations가 0건이면 인용이 없다는 사실을 명시한다", () => {
        const rendered = renderWith({ citations: [] });
        expect(rendered).toContain(
          "웹검색 — 인용 없음 (grounding이 인용을 반환하지 않았다)",
        );
      });

      it("researchCoverage가 비면(구 run) 커버리지 블록을 통째로 생략한다", () => {
        // 수집 기록이 없는 run에 커버리지를 지어내지 않는다
        expect(report).not.toContain("### 자료조사 커버리지");
        expect(report).not.toContain("미설정으로 수집하지 않음");
      });

      it("<summary>의 소스별 내역이 0건·미설정 소스를 더 이상 숨기지 않는다", () => {
        const rendered = renderWith({
          communityVoices: context.communityVoices.filter(
            (voice) => voice.source === "youtube",
          ),
        });
        expect(rendered).toContain(
          `(${SOURCE_LABELS.youtube} 2 · ${SOURCE_LABELS.hackernews} 0 · ${SOURCE_LABELS.naver} 미설정)`,
        );
      });
    });

    it("marketSizeIndicators가 있으면 소제목과 지표를 렌더링한다", () => {
      expect(report).toContain("### 시장 규모 지표");
      expect(report).toContain(context.marketSizeIndicators[0]);
    });

    it("marketSizeIndicators가 비면 소제목 자체를 출력하지 않는다", () => {
      const rendered = renderReport(
        IDEA,
        { ...context, marketSizeIndicators: [] },
        thesis,
        criticism,
        solution,
        verdict,
      );
      expect(rendered).not.toContain("시장 규모 지표");
    });

    it("communityVoices가 비면 <details> 안에 수집 실패 안내를 넣는다", () => {
      const rendered = renderReport(
        IDEA,
        { ...context, communityVoices: [] },
        thesis,
        criticism,
        solution,
        verdict,
      );
      const { open, close } = firstDetailsRange(rendered);
      const index = rendered.indexOf("수집된 유저 목소리 없음");
      expect(index).toBeGreaterThan(open);
      expect(index).toBeLessThan(close);
    });

    it("댓글 원문의 줄바꿈이 인용 블록을 깨뜨리지 않는다", () => {
      const rendered = renderReport(
        IDEA,
        {
          ...context,
          communityVoices: [
            { ...context.communityVoices[0], text: "첫 줄\n둘째 줄" },
          ],
        },
        thesis,
        criticism,
        solution,
        verdict,
      );
      expect(rendered).toContain('> "첫 줄\n> 둘째 줄"');
    });

    it("유저 목소리를 소스별 소제목 아래로 그룹핑한다", () => {
      const { open, close } = firstDetailsRange(report);
      const section = report.slice(open, close);

      for (const source of ["youtube", "hackernews", "naver"] as const) {
        expect(section).toContain(`##### ${SOURCE_LABELS[source]}`);
      }
      // 목소리는 자기 소스 소제목 아래에 온다
      const naverHeading = section.indexOf(`##### ${SOURCE_LABELS.naver}`);
      expect(section.indexOf("몬스테라 잎이 노랗게 변했어요")).toBeGreaterThan(
        naverHeading,
      );
    });

    it("목소리가 없는 소스는 소제목째 생략한다", () => {
      const rendered = renderReport(
        IDEA,
        {
          ...context,
          communityVoices: context.communityVoices.filter(
            (voice) => voice.source === "youtube",
          ),
        },
        thesis,
        criticism,
        solution,
        verdict,
      );
      expect(rendered).toContain(`##### ${SOURCE_LABELS.youtube}`);
      expect(rendered).not.toContain(`##### ${SOURCE_LABELS.hackernews}`);
      expect(rendered).not.toContain(`##### ${SOURCE_LABELS.naver}`);
    });

    it("인용 출처 줄에 소스 라벨·인기도·extra를 싣고 원문은 축자로 남긴다", () => {
      const hn = context.communityVoices[2];
      const naver = context.communityVoices[3];

      expect(report).toContain(
        `> "${hn.text}"\n> — [${SOURCE_LABELS.hackernews}] ${hn.title} ([출처](${hn.url}), 좋아요 ${hn.score})`,
      );
      // score가 없으면 생략하고, extra가 있으면 출처 줄에 덧붙인다
      expect(report).toContain(
        `> "${naver.text}"\n> — [${SOURCE_LABELS.naver}] ${naver.title} ([출처](${naver.url}), ${naver.extra})`,
      );
    });

    // ── 링크 박탈 (ADR-013): 클릭 가능한 링크는 코드가 API 응답에서 주입한 것뿐이다 ──

    it("communityVoices의 출처는 링크로 남는다 — 코드가 수집 API에서 주입한 사실이다", () => {
      for (const voice of context.communityVoices) {
        expect(report).toContain(`[출처](${voice.url})`);
      }
    });

    it("sources를 인라인 코드로 감싸 마크다운 자동 링크를 막는다", () => {
      const [source] = context.sources;
      expect(report).toContain(`*   \`${source}\``);
      // 벌거벗은 URL은 대부분의 뷰어에서 자동 링크가 된다 — 그 자리에 남기지 않는다
      expect(report).not.toContain(`*   ${source}`);
      expect(report).not.toContain(`](${source})`);
    });

    it("출처 소제목과 도입부에 미검증임을 밝힌다", () => {
      expect(report).toContain("#### 출처 (LLM 자기보고 · 미검증)");
      expect(report).toContain(
        "> 아래 항목은 모델이 자기 기억으로 적어낸 것이라 검증되지 않았다. 링크를 걸지 않는다.",
      );
    });

    // ADR-016의 프롬프트 다이어트가 하류 프롬프트에서 sources를 뺐다. 저장 아티팩트는 건드리지 않았다 —
    // 여기가 그 경계의 안전벨트다. toPromptContext를 저장·렌더 경로에 잘못 끼워 넣으면 이 테스트가 잡는다.
    it("★ 저장된 context 아티팩트의 sources는 리포트에 전부 렌더된다 (ADR-013 상보성)", () => {
      // loadStepOutput이 돌려주는 것과 같은 형태 — DB의 artifacts.content를 zod가 파싱한 결과다
      const stored = MarketContextSchema.parse({
        ...context,
        sources: [
          "https://example.com/plant-market-2026",
          "https://example.com/planta-review",
          "https://example.com/greenery-teardown",
        ],
      });

      const rendered = renderReport(
        IDEA,
        stored,
        thesis,
        criticism,
        solution,
        verdict,
      );

      for (const source of stored.sources) {
        expect(rendered, `리포트에서 사라진 출처: ${source}`).toContain(
          `*   \`${source}\``,
        );
      }
      expect(rendered).toContain(`미검증 출처 ${stored.sources.length}개`);

      // 프롬프트 사본은 sources를 벗지만, 리포트가 받는 아티팩트는 벗지 않는다
      expect(toPromptContext(stored)).not.toHaveProperty("sources");
      expect(stored.sources).toHaveLength(3);
    });

    it("백틱이 든 source도 코드 스팬을 깨뜨리지 않는다", () => {
      const rendered = renderReport(
        IDEA,
        { ...context, sources: ["https://example.com/`weird`"] },
        thesis,
        criticism,
        solution,
        verdict,
      );
      expect(rendered).toContain("*   `` https://example.com/`weird` ``");
    });

    it("경쟁사 URL을 링크가 아니라 인라인 코드 텍스트로 렌더링한다", () => {
      const [competitor] = context.competitors;
      expect(report).toContain(`\`${competitor.url}\``);
      expect(report).not.toContain(`[링크](${competitor.url})`);
      expect(report).not.toContain("| [링크]");
      // 표 헤더도 클릭 가능성을 약속하지 않는다
      expect(report).toContain("| 이름 | 설명 | 가격 힌트 | URL (미검증) |");
    });

    it("URL이 없는 경쟁사는 —로 표기한다", () => {
      const withoutUrl = context.competitors[1];
      expect(withoutUrl.url).toBeUndefined();
      expect(report).toContain(`| ${withoutUrl.name} | ${withoutUrl.description} | — | — |`);
    });

    it("citations를 '출처'와 분리된 '검색 인용' 소절로 렌더링한다 (ADR-012)", () => {
      const { open, close } = firstDetailsRange(report);

      const sourcesAt = report.indexOf("#### 출처");
      const citationsAt = report.indexOf("#### 검색 인용");
      expect(sourcesAt).toBeGreaterThan(open);
      expect(citationsAt).toBeGreaterThan(sourcesAt);
      expect(citationsAt).toBeLessThan(close);
    });

    it("origin 인용은 링크로 남는다 — urlContext가 실제로 읽어낸 원본이다", () => {
      expect(report).toContain(
        `[${ORIGIN_CITATION.title}](${ORIGIN_CITATION.uri})`,
      );
    });

    it("redirect 인용은 링크가 아니라 만료 고지가 붙은 텍스트다", () => {
      expect(report).toContain(
        `${REDIRECT_CITATION.title} (${REDIRECT_CITATION.domain}) — 만료 가능한 검색 리다이렉트`,
      );
      // 만료되면 404가 되는 URL은 href로도, 자동 링크되는 벌거벗은 텍스트로도 남기지 않는다
      for (const redirect of [REDIRECT_CITATION, REDIRECT_CITATION_NO_TITLE]) {
        expect(report).not.toContain(`](${redirect.uri})`);
        expect(report).not.toContain(`*   ${redirect.uri}`);
      }
    });

    it("origin과 redirect를 소분류 제목으로 구분해 독자가 신뢰도를 판단하게 한다", () => {
      const originAt = report.indexOf("##### 원본");
      const redirectAt = report.indexOf("##### 검색 리다이렉트");
      expect(originAt).toBeGreaterThan(report.indexOf("#### 검색 인용"));
      expect(redirectAt).toBeGreaterThan(originAt);
    });

    it("title도 domain도 없는 redirect 인용은 uri를 인라인 코드로만 남긴다", () => {
      const uri = "https://example.com/grounding-api-redirect/ccc";
      const rendered = renderReport(
        IDEA,
        { ...context, citations: [{ uri, kind: "redirect" as const }] },
        thesis,
        criticism,
        solution,
        verdict,
      );
      expect(rendered).toContain(`*   \`${uri}\` — 만료 가능한 검색 리다이렉트`);
      expect(rendered).not.toContain(`[${uri}](${uri})`);
    });

    it("title도 domain도 없는 origin 인용은 링크 텍스트가 uri로 폴백된다", () => {
      const uri = "https://example.com/pricing";
      const rendered = renderReport(
        IDEA,
        { ...context, citations: [{ uri, kind: "origin" as const }] },
        thesis,
        criticism,
        solution,
        verdict,
      );
      expect(rendered).toContain(`[${uri}](${uri})`);
    });

    it("한 종류만 있으면 그 소분류 제목만 출력한다", () => {
      const rendered = renderReport(
        IDEA,
        { ...context, citations: [REDIRECT_CITATION] },
        thesis,
        criticism,
        solution,
        verdict,
      );
      expect(rendered).toContain("##### 검색 리다이렉트");
      expect(rendered).not.toContain("##### 원본");
    });

    it("citations가 비면 '검색 인용' 소제목 자체를 출력하지 않는다", () => {
      const rendered = renderReport(
        IDEA,
        { ...context, citations: [] },
        thesis,
        criticism,
        solution,
        verdict,
      );
      expect(rendered).not.toContain("검색 인용");
      expect(rendered).toContain("#### 출처");
    });
  });

  describe("2. 正 — 낙관적 가설", () => {
    it("서사 필드가 모두 본문에 포함된다", () => {
      expect(report).toContain(thesis.winningThesis);
      expect(report).toContain(thesis.revenueModel);
      expect(report).toContain(thesis.bestCaseScenario);
      for (const value of [...thesis.growthLevers, ...thesis.marketTailwinds]) {
        expect(report).toContain(value);
      }
    });

    it("points를 축 라벨 아래에 렌더링한다", () => {
      expect(report).toContain("### 축별 낙관 주장");
      for (const point of thesis.points) {
        expect(report).toContain(point.claim);
        expect(report).toContain(point.rationale);
      }
    });
  });

  describe("3. 反 — 냉정한 비판", () => {
    it("축 라벨은 DIALECTIC_AXIS_LABELS에서 오고 축 순서대로 그룹핑된다", () => {
      // 2절에도 `### 수익 모델`(revenueModel)이 있으므로 3절 본문으로 범위를 좁힌다
      const section = report.slice(
        report.indexOf("## 3."),
        report.indexOf("## 4."),
      );
      const positions = (["painPoint", "bm", "copycat"] as const).map((axis) =>
        section.indexOf(`\n### ${DIALECTIC_AXIS_LABELS[axis]}\n`),
      );
      for (const position of positions) {
        expect(position).toBeGreaterThan(-1);
      }
      expect(positions[0]).toBeLessThan(positions[1]);
      expect(positions[1]).toBeLessThan(positions[2]);
    });

    it("각 point의 severity·riskScore·riskKeyword·claim을 렌더링한다", () => {
      for (const point of criticism.points) {
        expect(report).toContain(
          `**[${point.severity.toUpperCase()} · ${point.riskScore}/100 · ${point.riskKeyword}]** ${point.claim}`,
        );
      }
    });

    it("evidence는 <details> 안에 접어 넣는다", () => {
      for (const point of criticism.points) {
        expect(report).toContain(point.evidence);
      }
      expect(report).toContain("<summary>근거</summary>");
    });

    it("rebuts가 유효한 id를 가리키면 대응하는 正의 claim을 함께 렌더링한다", () => {
      const point = criticism.points[0];
      const [target] = thesis.points.filter((t) => t.id === point.rebuts);
      expect(target).toBeDefined();

      const claimAt = report.indexOf(point.claim);
      const nearby = report.slice(claimAt, claimAt + 300);
      expect(nearby).toContain("반박 대상");
      expect(nearby).toContain(target.claim);
    });

    it("rebuts가 존재하지 않는 id를 가리켜도 throw하지 않고 조용히 무시한다", () => {
      const broken: Criticism = {
        ...criticism,
        points: criticism.points.map((p, i) =>
          i === 0 ? { ...p, rebuts: "t999" } : p,
        ),
      };
      let rendered = "";
      expect(() => {
        rendered = renderReport(
          IDEA,
          context,
          thesis,
          broken,
          solution,
          verdict,
        );
      }).not.toThrow();
      expect(rendered).toContain(broken.points[0].claim);
      expect(rendered).not.toContain("t999");
    });

    it("反의 소결론을 최종 판정과 구분해 표기한다", () => {
      expect(report).toContain(`**反의 소결론:** ${criticism.verdict}`);
    });
  });

  describe("4. 合 — 인사이트 및 재설계", () => {
    it("Solution의 모든 필드가 본문에 포함된다", () => {
      const { remedies, ...narrative } = solution;
      for (const value of Object.values(narrative)) {
        expect(report).toContain(value);
      }
      // 원장은 문자열이 아니라 구조라 따로 본다 — 형태는 아래 "결함↔해결책 원장" describe가 확인한다
      for (const remedy of remedies) {
        expect(report).toContain(remedy.remedy);
      }
    });

    it("synthesis가 undefined여도 throw하지 않고 해당 블록만 생략한다", () => {
      const withoutSynthesis: Solution = { ...solution, synthesis: undefined };
      let rendered = "";
      expect(() => {
        rendered = renderReport(
          IDEA,
          context,
          thesis,
          criticism,
          withoutSynthesis,
          verdict,
        );
      }).not.toThrow();
      expect(rendered).not.toContain("**종합 통찰:**");
      expect(rendered).toContain(solution.revisedConcept);
    });

    it("monetization은 合의 하위 절(④)이지 최상위 섹션이 아니다", () => {
      expect(report).toContain("### ④ 지속 가능한 비즈니스 모델 (Monetization Model)");
      const topLevel = report
        .split("\n")
        .filter((line) => line.startsWith("## "));
      expect(topLevel).toHaveLength(5);
      for (const heading of topLevel) {
        expect(heading).not.toContain("비즈니스 모델");
      }
    });

    it("monetization 본문이 최종 판정보다 앞에 온다", () => {
      expect(report.indexOf(solution.monetization)).toBeLessThan(
        report.indexOf("## 5. 최종 판정 (Verdict)"),
      );
    });
  });

  describe("5. 최종 판정", () => {
    it("headline·점수·권고 라벨·rationale을 렌더링한다", () => {
      expect(report).toContain(`**${verdict.headline}**`);
      expect(report).toContain(
        `생존 점수 ${verdict.survivalScore}/100 · 판정: ${RECOMMENDATION_LABELS[verdict.recommendation]}`,
      );
      expect(report).toContain(verdict.rationale);
    });

    it("잔존 리스크와 생존 조건을 렌더링한다", () => {
      expect(report).toContain("### 잔존 리스크");
      const risk = verdict.residualRisks[0];
      expect(report).toContain(
        `**[${risk.severity.toUpperCase()}]** ${risk.keyword} — ${risk.note}`,
      );
      expect(report).toContain("### 생존 조건");
      expect(report).toContain(`1. ${verdict.conditions[0]}`);
    });
  });

  // ── 결함↔해결책 원장 (ADR-017): 이 리포트의 핵심 산출물이 revisedConcept 줄글에 묻혀 있었다 ──

  describe("결함↔해결책 원장", () => {
    /** fatal 2건 — c3(원래 minor)를 fatal로 올려 침묵·재주장 양태를 함께 본다 */
    const twoFatals: Criticism = {
      ...criticism,
      points: criticism.points.map((point) =>
        point.id === "c3" ? { ...point, severity: "fatal" as const } : point,
      ),
    };

    const twoRemedies: Solution = {
      ...solution,
      remedies: [
        ...solution.remedies,
        {
          respondsTo: "c3",
          strategy: "defend",
          remedy: "가정별 생육 로그를 축적해 복제 불가능한 진단 정확도를 만든다",
        },
      ],
    };

    const twoAudits: Verdict = {
      ...verdict,
      remedyAudits: [
        ...verdict.remedyAudits,
        {
          criticismId: "c3",
          assessment: "restated",
          note: "'복제 불가능'은 해자 부재에 수식어만 덧붙인 재주장이다",
        },
      ],
    };

    function render(
      overrides: {
        criticism?: Criticism;
        solution?: Solution;
        verdict?: Verdict;
      } = {},
    ): string {
      return renderReport(
        IDEA,
        context,
        thesis,
        overrides.criticism ?? criticism,
        overrides.solution ?? solution,
        overrides.verdict ?? verdict,
      );
    }

    function sectionOf(rendered: string, from: string, to?: string): string {
      const start = rendered.indexOf(from);
      expect(start).toBeGreaterThan(-1);
      return to === undefined
        ? rendered.slice(start)
        : rendered.slice(start, rendered.indexOf(to));
    }

    describe("4절 — 해결책만, 감사는 오지 않는다", () => {
      const fourth = sectionOf(report, "## 4.", "## 5.");

      it("전략 라벨과 해결책 본문을 결함별로 렌더링한다", () => {
        const [remedy] = solution.remedies;
        expect(fourth).toContain(
          `*   **[${REMEDY_STRATEGY_LABELS.bypass}] 무료 대체재** — 지불 의사가 낮다`,
        );
        expect(fourth).toContain(`    *   ${remedy.remedy}`);
      });

      it("★ 감사 결과가 렌더되지 않는다 (ADR-008)", () => {
        // 4절에 "재주장" 칩이 뜨면 독자는 5절을 읽기 전에 결론을 안다 —
        // 그 순간 正/反 대립은 읽을 이유가 없는 장식이 된다
        const rendered = render({
          criticism: twoFatals,
          solution: twoRemedies,
          verdict: twoAudits,
        });
        const section = sectionOf(rendered, "## 4.", "## 5.");

        for (const label of Object.values(REMEDY_VERDICT_LABELS)) {
          expect(section, `4절에 샌 감사 라벨: ${label}`).not.toContain(label);
        }
        for (const audit of twoAudits.remedyAudits) {
          expect(section).not.toContain(audit.note);
        }
      });

      it("해결책을 검증된 사실이 아니라 재설계의 자기보고로 표기한다 (ADR-013)", () => {
        expect(fourth).toContain(
          "### 치명적 결함에 대한 해결책 (재설계의 주장 · 미검증)",
        );
        expect(fourth).toContain(
          "> 아래는 재설계가 스스로 낸 대응이지 검증된 사실이 아니다." +
            " 유효한지는 5절 최종 판정이 항목별로 감사한다.",
        );
      });

      it("침묵한 fatal을 실패로 낙인찍지 않고 사실로만 적는다", () => {
        // 침묵은 코드가 증명할 수 있지만, 그것을 실패라 부르는 것은 5절의 판단이다
        const section = sectionOf(
          render({ criticism: twoFatals }),
          "## 4.",
          "## 5.",
        );
        expect(section).toContain("*   **[해결책 없음] 해자 부재**");
        expect(section).toContain("    *   재설계는 이 결함에 대해 아무 말도 하지 않았다.");
      });
    });

    describe("5절 — 요약 줄 + 3열 표", () => {
      it("요약 줄과 3열 표를 렌더링한다", () => {
        const rendered = render({
          criticism: twoFatals,
          solution: twoRemedies,
          verdict: twoAudits,
        });
        expect(rendered).toContain("### 결함↔해결책 원장");
        expect(rendered).toContain("| 비판 | 재설계의 해결책 | 판정의 감사 |");
        expect(rendered).toContain(
          `| **무료 대체재** 지불 의사가 낮다` +
            ` | **[${REMEDY_STRATEGY_LABELS.bypass}]** ${twoRemedies.remedies[0].remedy}` +
            ` | **[${REMEDY_VERDICT_LABELS.solid}]** ${twoAudits.remedyAudits[0].note} |`,
        );
      });

      it("★ 요약 줄의 숫자가 실제 원장과 일치한다", () => {
        const rendered = render({
          criticism: twoFatals,
          solution: twoRemedies,
          verdict: twoAudits,
        });
        expect(rendered).toContain(
          `비판이 제기한 치명적 결함 2건 → 해결책 2건` +
            ` (${REMEDY_VERDICT_LABELS.solid} 1 · ${REMEDY_VERDICT_LABELS.restated} 1)`,
        );
      });

      it("요약 줄이 침묵을 세지 않는다 — 결함 2건에 해결책 1건", () => {
        const rendered = render({ criticism: twoFatals });
        expect(rendered).toContain(
          `비판이 제기한 치명적 결함 2건 → 해결책 1건 (${REMEDY_VERDICT_LABELS.solid} 1)`,
        );
      });

      it("★ 원장이 잔존 리스크보다 앞에 온다 — 부록이 아니라 판정의 근거다", () => {
        const fifth = sectionOf(report, "## 5. 최종 판정 (Verdict)");
        const ledgerAt = fifth.indexOf("### 결함↔해결책 원장");
        expect(ledgerAt).toBeGreaterThan(fifth.indexOf(verdict.rationale));
        expect(ledgerAt).toBeLessThan(fifth.indexOf("### 잔존 리스크"));
        expect(fifth.indexOf("### 잔존 리스크")).toBeLessThan(
          fifth.indexOf("### 생존 조건"),
        );
      });

      it("침묵한 fatal을 '해결책 없음'으로 표시한다", () => {
        const rendered = render({ criticism: twoFatals });
        expect(rendered).toContain(
          `| **해자 부재** 진입장벽이 없다 | 해결책 없음 |`,
        );
      });

      it("셀 안의 줄바꿈과 |가 표를 깨뜨리지 않는다", () => {
        const rendered = render({
          solution: {
            ...solution,
            remedies: [
              { ...solution.remedies[0], remedy: "첫 줄\n둘째 | 줄" },
            ],
          },
        });
        expect(rendered).toContain(
          `**[${REMEDY_STRATEGY_LABELS.bypass}]** 첫 줄 둘째 \\| 줄 |`,
        );
      });
    });

    it("fatal이 아닌 비판은 원장에 오르지 않는다", () => {
      // 전건 커버리지를 강제받는 것은 fatal뿐이다 (ADR-017 / PRD 5절 규격)
      const rendered = render({
        solution: {
          ...solution,
          remedies: [
            ...solution.remedies,
            {
              respondsTo: "c1",
              strategy: "defend",
              remedy: "major 비판에 대한 선택적 해결책",
            },
          ],
        },
      });
      expect(rendered).toContain("### 결함↔해결책 원장");
      expect(rendered).not.toContain("major 비판에 대한 선택적 해결책");
      expect(rendered).toContain("비판이 제기한 치명적 결함 1건 → 해결책 1건");
    });

    it("★ 원장 없는 구 solution·verdict는 블록 자체를 생략한다 — 빈 표를 그리지 않는다", () => {
      // 구 run은 원장 계약 이전에 저장됐을 뿐이다. fatal마다 "해결책 없음"을 찍으면
      // 있지도 않은 침묵을 지어내는 것이다 (coverageSection과 같은 태도 — ADR-013)
      const rendered = render({
        solution: { ...solution, remedies: [] },
        verdict: { ...verdict, remedyAudits: [] },
      });
      expect(rendered).not.toContain("결함↔해결책 원장");
      expect(rendered).not.toContain("치명적 결함에 대한 해결책");
      expect(rendered).not.toContain("해결책 없음");
      expect(rendered).not.toContain("0건");
      // 나머지 5절은 그대로다
      expect(rendered).toContain("### 잔존 리스크");
      expect(rendered).toContain(verdict.rationale);
    });

    it("존재하지 않는 id를 참조하는 해결책이 섞여도 throw하지 않고 조용히 드롭한다", () => {
      let rendered = "";
      expect(() => {
        rendered = render({
          solution: {
            ...solution,
            remedies: [
              { respondsTo: "c999", strategy: "defend", remedy: "유령 비판에 대한 해결책" },
            ],
          },
        });
      }).not.toThrow();

      expect(rendered).not.toContain("c999");
      expect(rendered).not.toContain("유령 비판에 대한 해결책");
      // 드롭된 결과 c2는 침묵이 된다 — 렌더러는 검증기가 아니다
      expect(rendered).toContain("*   **[해결책 없음] 무료 대체재**");
    });
  });

  // ── 스카우트 머리말 (phase 10): 주제를 사람이 고르지 않았다는 사실이 리포트 안에 남아야 한다 ──

  describe("스카우트 머리말", () => {
    /** 각 신호가 서로 다른 kind의 인용을 물고 있어야 출처 렌더링 규칙을 한 번에 본다 */
    const scoutOrigin: ScoutOrigin = {
      scope: "국내 스마트 농업",
      searchedAt: "2026-07-19T09:00:00.000Z",
      opportunity: {
        id: "O1",
        title: "실내 원예 생육 데이터 SaaS",
        whatItIs: "가정 화분의 생육 로그를 모아 화원·종묘사에 파는 서비스",
        whyNow: "센서 단가가 임계선을 넘었고 원예 구독 시장이 재편되는 중이다",
        whoPays: "화원 체인과 종묘사",
        horizon: "mid",
        signals: [
          {
            signalType: "funding",
            statement:
              "가정 원예 IoT 스타트업 Sprout가 시리즈B로 4,200만 달러를 조달했다",
            observedAt: "2026-02-11",
            citation: ORIGIN_CITATION,
            figures: [{ value: "4,200만 달러", citation: ORIGIN_CITATION }],
          },
          {
            signalType: "regulation",
            statement: "EU 식물 검역 규정 개정으로 생육 이력 기록이 의무화된다",
            observedAt: "2026-04-02",
            effectiveAt: "2027-01-01",
            citation: REDIRECT_CITATION,
            figures: [],
          },
        ],
        counterSignal: {
          signalType: "incumbent",
          statement: "대형 원예 체인이 자체 센서를 무상 배포하기 시작했다",
          observedAt: "2026-05-20",
          citation: REDIRECT_CITATION_NO_TITLE,
          figures: [],
        },
      },
    };

    const scouted = renderReport(
      IDEA,
      context,
      thesis,
      criticism,
      solution,
      verdict,
      scoutOrigin,
    );

    /** 머리말이 차지하는 구간 — 제목 다음, 1절 앞 */
    const preamble = scouted.slice(0, scouted.indexOf("## 1. 시장 맥락"));

    it("★ scoutOrigin이 없으면 출력이 지금과 한 글자도 다르지 않다", () => {
      // 직접 입력 모드는 이 phase가 존재하지 않는 것과 같아야 한다
      expect(
        renderReport(IDEA, context, thesis, criticism, solution, verdict, undefined),
      ).toBe(report);
      expect(report).not.toContain("자동 탐색");
    });

    it("★ 머리말이 1절보다 앞에 온다 — 논증을 읽기 전에 주제의 출처를 안다", () => {
      const heading = scouted.indexOf("### 이 주제의 출처 (자동 탐색)");
      expect(heading).toBeGreaterThan(-1);
      expect(heading).toBeLessThan(scouted.indexOf("## 1. 시장 맥락"));
      // 부록이 아니다 — 리포트 끝이 아니라 앞에 있다
      expect(heading).toBeLessThan(scouted.indexOf("## 5. 최종 판정"));
    });

    it("★ 5단계 서사의 섹션 제목과 순서가 그대로다", () => {
      const headings = [
        "## 1. 시장 맥락 (Context)",
        "## 2. 낙관적 가설 (正 / Thesis)",
        "## 3. 냉정한 비판 (反 / Antithesis)",
        "## 4. 인사이트 및 재설계 (合 / Synthesis)",
        "## 5. 최종 판정 (Verdict)",
      ];
      let cursor = -1;
      for (const heading of headings) {
        const index = scouted.indexOf(heading);
        expect(index, `누락된 섹션: ${heading}`).toBeGreaterThan(cursor);
        cursor = index;
      }
    });

    it("★ 새 번호 섹션(## 6. 등)이 늘지 않는다 — 순서는 협상 불가다 (PRD)", () => {
      const topLevel = scouted
        .split("\n")
        .filter((line) => line.startsWith("## "));
      expect(topLevel).toHaveLength(5);
    });

    it("탐색 범위와 후보의 whyNow·whoPays·horizon을 밝힌다", () => {
      expect(preamble).toContain(`**탐색 범위:** ${scoutOrigin.scope}`);
      expect(preamble).toContain(`**왜 지금인가:** ${scoutOrigin.opportunity.whyNow}`);
      expect(preamble).toContain(`**누가 돈을 내나:** ${scoutOrigin.opportunity.whoPays}`);
      expect(preamble).toContain(`**시계:** ${HORIZON_LABELS.mid}`);
    });

    it("신호의 종류·statement·observedAt을 렌더링한다", () => {
      const [funding, regulation] = scoutOrigin.opportunity.signals;
      expect(preamble).toContain(
        `**[${SIGNAL_TYPE_LABELS.funding}]** ${funding.statement}`,
      );
      expect(preamble).toContain(`관측 ${funding.observedAt}`);
      expect(preamble).toContain(
        `**[${SIGNAL_TYPE_LABELS.regulation}]** ${regulation.statement}`,
      );
      expect(preamble).toContain(`관측 ${regulation.observedAt}`);
    });

    it("effectiveAt이 있는 신호만 시행일을 덧붙인다", () => {
      expect(preamble).toContain("관측 2026-04-02 · 시행 2027-01-01");
      expect(preamble).toContain("관측 2026-02-11)");
    });

    it("★ counterSignal을 별도 소제목으로 반드시 렌더링한다", () => {
      // 유리한 신호만 남기면 리포트가 자기 홍보물이 된다
      const counter = scoutOrigin.opportunity.counterSignal;
      const at = preamble.indexOf("#### 반대 증거");
      expect(at).toBeGreaterThan(-1);
      expect(preamble.indexOf(counter.statement)).toBeGreaterThan(at);
      expect(preamble).toContain(
        `**[${SIGNAL_TYPE_LABELS.incumbent}]** ${counter.statement}`,
      );
    });

    it("★ 출처의 domain을 노출한다 — 통신사인지 블로그인지는 사람이 판단한다", () => {
      // origin은 링크라 citationItem이 domain을 붙이지 않는다. 머리말에서는 드러낸다
      expect(preamble).toContain(
        `[${ORIGIN_CITATION.title}](${ORIGIN_CITATION.uri}) (${ORIGIN_CITATION.domain})`,
      );
      expect(preamble).toContain(REDIRECT_CITATION.domain);
      expect(preamble).toContain(REDIRECT_CITATION_NO_TITLE.domain);
    });

    it("redirect 인용은 1절과 똑같이 링크를 박탈하고 만료를 고지한다 (ADR-013)", () => {
      expect(preamble).toContain(
        `${REDIRECT_CITATION.title} (${REDIRECT_CITATION.domain}) — 만료 가능한 검색 리다이렉트`,
      );
      for (const redirect of [REDIRECT_CITATION, REDIRECT_CITATION_NO_TITLE]) {
        expect(preamble).not.toContain(`](${redirect.uri})`);
      }
    });

    it("★ 머리말에 판정·점수·결론이 새지 않는다 (ADR-008)", () => {
      expect(preamble).not.toContain(verdict.headline);
      expect(preamble).not.toContain(String(verdict.survivalScore));
      expect(preamble).not.toContain(RECOMMENDATION_LABELS[verdict.recommendation]);
      expect(preamble).not.toContain(criticism.verdict);
    });

    it("순수 함수다 — 같은 입력이면 같은 출력", () => {
      expect(
        renderReport(IDEA, context, thesis, criticism, solution, verdict, scoutOrigin),
      ).toBe(scouted);
    });
  });

  it("순수 함수다 — 같은 입력이면 같은 출력", () => {
    expect(
      renderReport(IDEA, context, thesis, criticism, solution, verdict),
    ).toBe(report);
  });
});
