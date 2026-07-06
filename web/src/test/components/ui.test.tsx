import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  Button,
  Collapsible,
  EmptyState,
  PageShell,
  RUN_STATUS_LABELS,
  RunStatusBadge,
  SectionHeading,
  SeverityBadge,
  SEVERITY_LABELS,
  TextAreaField,
} from "@/components/ui";

// vitest globals가 꺼져 있어 Testing Library auto-cleanup이 등록되지 않는다
afterEach(cleanup);

describe("SeverityBadge", () => {
  it.each([
    ["fatal", "치명적"],
    ["major", "중대"],
    ["minor", "경미"],
  ] as const)("%s → 라벨 '%s'를 렌더링한다", (severity, label) => {
    render(<SeverityBadge severity={severity} />);
    expect(screen.getByText(label)).toBeDefined();
  });

  it("라벨 매핑 상수를 export한다 (이후 step 재사용)", () => {
    expect(SEVERITY_LABELS).toEqual({
      fatal: "치명적",
      major: "중대",
      minor: "경미",
    });
  });

  it("fatal은 옅은 배경+진한 텍스트 조합을 쓴다 (UI_GUIDE)", () => {
    render(<SeverityBadge severity="fatal" />);
    const badge = screen.getByText("치명적");
    expect(badge.className).toContain("bg-red-50");
    expect(badge.className).toContain("text-red-700");
  });
});

describe("RunStatusBadge", () => {
  it.each([
    ["completed", "완료"],
    ["error", "실패"],
    ["running", "진행중"],
    ["stalled", "중단됨"],
  ] as const)("%s → 라벨 '%s'를 렌더링한다", (status, label) => {
    render(<RunStatusBadge status={status} />);
    expect(screen.getByText(label)).toBeDefined();
  });

  it("라벨 매핑 상수를 export한다 (이후 step 재사용)", () => {
    expect(RUN_STATUS_LABELS).toEqual({
      completed: "완료",
      error: "실패",
      running: "진행중",
      stalled: "중단됨",
    });
  });
});

describe("Button", () => {
  it("기본 variant는 primary다", () => {
    render(<Button>저장</Button>);
    const button = screen.getByRole("button", { name: "저장" });
    expect(button.className).toContain("bg-neutral-900");
    expect(button.className).toContain("text-white");
  });

  it("secondary variant는 흰 배경 + 테두리다", () => {
    render(<Button variant="secondary">취소</Button>);
    const button = screen.getByRole("button", { name: "취소" });
    expect(button.className).toContain("bg-white");
    expect(button.className).toContain("border-neutral-300");
  });

  it("text variant는 밑줄 hover 스타일이다", () => {
    render(<Button variant="text">더보기</Button>);
    const button = screen.getByRole("button", { name: "더보기" });
    expect(button.className).toContain("hover:underline");
    expect(button.className).not.toContain("bg-neutral-900");
  });

  it("기본 type은 button이다 (폼 암묵 submit 방지)", () => {
    render(<Button>확인</Button>);
    expect(screen.getByRole("button").getAttribute("type")).toBe("button");
  });
});

describe("Collapsible", () => {
  it("summary 텍스트와 내용을 렌더링하고, 기본은 접혀 있다", () => {
    render(<Collapsible summary="근거 보기">상세 근거 내용</Collapsible>);
    expect(screen.getByText("근거 보기")).toBeDefined();
    const details = screen.getByText("상세 근거 내용").closest("details");
    expect(details?.open).toBe(false);
  });

  it("defaultOpen이면 펼쳐진 상태로 렌더링한다", () => {
    render(
      <Collapsible summary="출처" defaultOpen>
        출처 목록
      </Collapsible>,
    );
    const details = screen.getByText("출처 목록").closest("details");
    expect(details?.open).toBe(true);
  });

  it("summary 클릭으로 접힘/펼침이 토글된다", () => {
    render(<Collapsible summary="근거 보기">상세 근거 내용</Collapsible>);
    const details = screen.getByText("상세 근거 내용").closest("details");
    fireEvent.click(screen.getByText("근거 보기"));
    expect(details?.open).toBe(true);
    fireEvent.click(screen.getByText("근거 보기"));
    expect(details?.open).toBe(false);
  });
});

describe("TextAreaField", () => {
  it("라벨과 textarea가 연결된다", () => {
    render(<TextAreaField label="아이디어" placeholder="아이디어를 입력하세요" />);
    const textarea = screen.getByLabelText("아이디어");
    expect(textarea.tagName).toBe("TEXTAREA");
  });
});

describe("PageShell", () => {
  it("로고 텍스트 'anvil'이 홈(/)으로 링크되고 children을 렌더링한다", () => {
    render(
      <PageShell>
        <p>페이지 내용</p>
      </PageShell>,
    );
    const logo = screen.getByRole("link", { name: "anvil" });
    expect(logo.getAttribute("href")).toBe("/");
    expect(screen.getByText("페이지 내용")).toBeDefined();
  });
});

describe("EmptyState", () => {
  it("제목·설명·액션 슬롯을 렌더링한다", () => {
    render(
      <EmptyState
        title="아직 실행된 컨설팅이 없습니다"
        description="아이디어를 입력해 첫 컨설팅을 시작해 보세요."
        action={<Button>컨설팅 시작</Button>}
      />,
    );
    expect(
      screen.getByText("아직 실행된 컨설팅이 없습니다"),
    ).toBeDefined();
    expect(
      screen.getByText("아이디어를 입력해 첫 컨설팅을 시작해 보세요."),
    ).toBeDefined();
    expect(screen.getByRole("button", { name: "컨설팅 시작" })).toBeDefined();
  });
});

describe("SectionHeading", () => {
  it("id 앵커를 가진 섹션 제목을 렌더링한다 (목차 네비용)", () => {
    render(<SectionHeading id="market-context">시장 맥락</SectionHeading>);
    const heading = screen.getByRole("heading", { name: "시장 맥락" });
    expect(heading.id).toBe("market-context");
  });
});
