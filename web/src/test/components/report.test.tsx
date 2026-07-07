import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ReportView } from "@/components/report/ReportView";
import { completedDetail } from "@/test/clientFixtures";

afterEach(cleanup);

describe("ReportView", () => {
  it("헤더, verdict, severity 집계, 다운로드 링크를 렌더링한다", () => {
    render(<ReportView detail={completedDetail()} />);

    expect(screen.getByRole("heading", { name: "AI 회의록 요약 서비스" })).toBeDefined();
    expect(screen.getByText("치명적 1")).toBeDefined();
    expect(screen.getByText("중대 1")).toBeDefined();
    expect(screen.getByText("경미 1")).toBeDefined();
    expect(
      screen.getAllByText(
        "요약 단독 기능은 실패 확률이 높고 실행 추적 워크플로우로 전환해야 한다.",
      ).length,
    ).toBeGreaterThan(0);
    expect(screen.getByRole("link", { name: "report.md 다운로드" })).toBeDefined();
  });

  it("시장 맥락에서 경쟁 서비스 8개를 먼저 보이고 더보기로 확장한다", () => {
    render(<ReportView detail={completedDetail()} />);

    expect(screen.getByText("경쟁사 8")).toBeDefined();
    expect(screen.queryByText("경쟁사 9")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "더보기" }));
    expect(screen.getByText("경쟁사 9")).toBeDefined();
  });

  it("비판과 솔루션 섹션을 구조화해 렌더링한다", () => {
    render(<ReportView detail={completedDetail()} />);

    expect(screen.getByRole("heading", { name: "② 냉정한 비판" })).toBeDefined();
    expect(screen.getByText("단독 구독 BM이 취약하다")).toBeDefined();
    expect(screen.getByRole("heading", { name: "③ AI 네이티브 재설계" })).toBeDefined();
    expect(screen.getByText("결정-실행 추적 에이전트로 재정의한다.")).toBeDefined();
    expect(screen.getByRole("heading", { name: "④ 비즈니스 모델" })).toBeDefined();
    expect(screen.getByText("팀 플랜과 온프레미스 라이선스로 과금한다.")).toBeDefined();
  });
});
