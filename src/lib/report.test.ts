import { describe, expect, it } from "vitest";
import type { Criticism, MarketContext, Solution } from "../types/index.js";
import { renderReport } from "./report.js";

const IDEA = "AI가 반려식물 상태를 진단하고 관리 일정을 챙겨주는 서비스";

const context: MarketContext = {
  ideaTitle: "AI 반려식물 관리 서비스",
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

const criticism: Criticism = {
  painPointReality: [
    {
      claim: "페인포인트가 약하다",
      evidence: "댓글 '물주기 타이밍을 늘 놓쳐요'는 불편이지 지불 동기가 아니다",
      severity: "major",
    },
  ],
  bmWeakness: [
    {
      claim: "지불 의사가 낮다",
      evidence: "Planta가 월 4.99달러에 동일 기능을 제공한다",
      severity: "fatal",
    },
  ],
  copycatRisk: [
    {
      claim: "진입장벽이 없다",
      evidence: "PictureThis가 기능 추가로 즉시 대응 가능하다",
      severity: "minor",
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
};

describe("renderReport", () => {
  const report = renderReport(IDEA, context, criticism, solution);

  it("PRD 리포트 규격의 섹션 제목이 순서대로 모두 존재한다", () => {
    const headings = [
      `# [컨설팅 리포트] ${context.ideaTitle}`,
      "## 1. 실시간 시장 맥락 (Market Context)",
      "## 2. 냉정한 현실 인식 및 비판 (Cold Criticism)",
      "## 3. AI 네이티브 관점의 해결책 (Solution Architecture)",
      "### ① 데이터 수집 및 최소 입력 구조 (Minimal Input)",
      "### ② 에이전틱 워크플로우 (Agentic Workflow)",
      "### ③ 독점적 데이터 플라이휠 (Data Flywheel)",
      "## 4. 지속 가능한 비즈니스 모델 (Monetization Model)",
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

  it("Solution의 5개 필드가 모두 본문에 포함된다", () => {
    for (const value of Object.values(solution)) {
      expect(report).toContain(value);
    }
  });

  it("순수 함수다 — 같은 입력이면 같은 출력", () => {
    expect(renderReport(IDEA, context, criticism, solution)).toBe(report);
  });

  it("youtubeVoices가 비어 있으면 수집 실패 안내를 렌더링한다", () => {
    const empty = renderReport(
      IDEA,
      { ...context, youtubeVoices: [] },
      criticism,
      solution,
    );
    expect(empty).toContain("수집된 YouTube 목소리 없음");
  });

  it("고정 입력 → 고정 출력 (스냅샷)", () => {
    expect(report).toMatchSnapshot();
  });
});
