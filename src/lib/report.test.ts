import { describe, expect, it } from "vitest";
import type {
  Criticism,
  MarketContext,
  Solution,
  Thesis,
} from "../types/index.js";
import { renderReport } from "./report.js";

const IDEA = "AI가 반려식물 상태를 진단하고 관리 일정을 챙겨주는 서비스";

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
  youtubeVoices: [
    {
      videoTitle: "식물 키우기 실패담",
      videoUrl: "https://youtube.com/watch?v=abc",
      comment: "물주기 타이밍을 늘 놓쳐요",
      authorName: "user1",
      likeCount: 12,
    },
    {
      videoTitle: "반려식물 브이로그",
      videoUrl: "https://youtube.com/watch?v=def",
      comment: "앱 알림은 결국 다 꺼버리게 되더라고요",
    },
  ],
  painPointEvidence: ["물주기 실패로 식물을 죽인 경험이 반복된다"],
  sources: ["https://example.com/trend"],
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
};

describe("renderReport", () => {
  const report = renderReport(IDEA, context, thesis, criticism, solution);

  it("정반합 리포트 규격의 섹션 제목이 순서대로 모두 존재한다", () => {
    const headings = [
      `# [컨설팅 리포트] ${context.ideaTitle}`,
      "## 1. 실시간 시장 맥락 (Market Context)",
      "## 2. 낙관적 논제 (Thesis / 正)",
      "## 3. 냉정한 반론 (Antithesis / 反)",
      "## 4. 종합과 재설계 (Synthesis / 合)",
      "### ① 데이터 수집 및 최소 입력 구조 (Minimal Input)",
      "### ② 에이전틱 워크플로우 (Agentic Workflow)",
      "### ③ 독점적 데이터 플라이휠 (Data Flywheel)",
      "## 5. 지속 가능한 비즈니스 모델 (Monetization Model)",
    ];
    let cursor = -1;
    for (const heading of headings) {
      const index = report.indexOf(heading);
      expect(index, `누락된 섹션: ${heading}`).toBeGreaterThan(cursor);
      cursor = index;
    }
  });

  it("PRD 규격의 고정 문구(경고 블록, 3축 비판 라벨)를 그대로 포함한다", () => {
    expect(report).toContain(
      "> [경고] 본 아이디어가 실패할 확률이 높은 구조적 이유를 나열합니다.",
    );
    expect(report).toContain("**수집된 유사/경쟁 서비스 현황:**");
    expect(report).toContain("**YouTube/커뮤니티 내 타겟 유저의 실제 목소리:**");
    expect(report).toContain("**페인포인트의 허구성:**");
    expect(report).toContain("**수익 모델(BM)의 취약성:**");
    expect(report).toContain("**카피캣 리스크:**");
  });

  it("youtubeVoices를 인용 블록으로 렌더링한다", () => {
    expect(report).toContain('> "물주기 타이밍을 늘 놓쳐요"');
    expect(report).toContain("식물 키우기 실패담");
    expect(report).toContain('> "앱 알림은 결국 다 꺼버리게 되더라고요"');
  });

  it("CriticismPoint를 severity 표시와 함께 렌더링한다", () => {
    expect(report).toContain("[FATAL]");
    expect(report).toContain("[MAJOR]");
    expect(report).toContain("[MINOR]");
    expect(report).toContain(criticism.verdict);
  });

  it("Thesis(正)의 필드가 모두 본문에 포함된다", () => {
    expect(report).toContain(thesis.revenueModel);
    expect(report).toContain(thesis.bestCaseScenario);
    expect(report).toContain(thesis.winningThesis);
    for (const lever of thesis.growthLevers) {
      expect(report).toContain(lever);
    }
    for (const tailwind of thesis.marketTailwinds) {
      expect(report).toContain(tailwind);
    }
  });

  it("Solution의 필드(synthesis 포함)가 모두 본문에 포함된다", () => {
    for (const value of Object.values(solution)) {
      expect(report).toContain(value);
    }
  });

  it("synthesis가 없으면 종합 통찰 문구 없이도 렌더링된다 (구 solution 하위호환)", () => {
    const { synthesis, ...withoutSynthesis } = solution;
    void synthesis;
    const rendered = renderReport(
      IDEA,
      context,
      thesis,
      criticism,
      withoutSynthesis,
    );
    expect(rendered).not.toContain("**종합 통찰:**");
    expect(rendered).toContain("## 4. 종합과 재설계 (Synthesis / 合)");
    expect(rendered).toContain(solution.revisedConcept);
  });

  it("순수 함수다 — 같은 입력이면 같은 출력", () => {
    expect(renderReport(IDEA, context, thesis, criticism, solution)).toBe(
      report,
    );
  });

  it("youtubeVoices가 비어 있으면 수집 실패 안내를 렌더링한다", () => {
    const empty = renderReport(
      IDEA,
      { ...context, youtubeVoices: [] },
      thesis,
      criticism,
      solution,
    );
    expect(empty).toContain("수집된 YouTube 목소리 없음");
  });

  it("고정 입력 → 고정 출력 (스냅샷)", () => {
    expect(report).toMatchSnapshot();
  });
});
