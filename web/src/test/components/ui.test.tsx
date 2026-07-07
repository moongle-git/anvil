import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CriticismSeverity } from "@anvil/types";
import type { RunDisplayStatus } from "@anvil/runStore";
import {
  Badge,
  Button,
  Card,
  Collapsible,
  EmptyState,
  ErrorState,
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

// 타입 소스의 모든 enum 값. 컴포넌트가 특정 값만 처리하고 나머지를 빠뜨리면
// exhaustive 테스트가 잡아낸다 (라벨 매핑은 후속 step이 의존하는 계약).
const ALL_SEVERITIES: CriticismSeverity[] = ["fatal", "major", "minor"];
const ALL_STATUSES: RunDisplayStatus[] = [
  "completed",
  "error",
  "running",
  "stalled",
];

describe("Badge (tone 기반 시맨틱 프리미티브)", () => {
  it("tone을 data-tone으로 노출한다 (스타일이 아닌 의미를 계약으로)", () => {
    render(<Badge tone="danger">위험</Badge>);
    expect(screen.getByText("위험").getAttribute("data-tone")).toBe("danger");
  });

  it("추가 속성(className·data-*)을 span에 전달한다", () => {
    render(
      <Badge tone="neutral" className="ml-2" data-testid="price">
        무료
      </Badge>,
    );
    const badge = screen.getByTestId("price");
    expect(badge.className).toContain("ml-2");
  });
});

describe("SeverityBadge", () => {
  it("모든 severity가 한국어 라벨을 렌더링한다 (exhaustive)", () => {
    for (const severity of ALL_SEVERITIES) {
      render(<SeverityBadge severity={severity} />);
      expect(screen.getByText(SEVERITY_LABELS[severity])).toBeDefined();
      cleanup();
    }
  });

  it("SEVERITY_LABELS는 severity 3종을 정확히 매핑한다 (단일 소스)", () => {
    expect(SEVERITY_LABELS).toEqual({
      fatal: "치명적",
      major: "중대",
      minor: "경미",
    });
    // 타입 소스와 키가 완전히 일치하는지 (누락/추가 없음)
    expect(Object.keys(SEVERITY_LABELS).sort()).toEqual(
      [...ALL_SEVERITIES].sort(),
    );
  });

  it.each([
    ["fatal", "danger"],
    ["major", "warning"],
    ["minor", "neutral"],
  ] as const)(
    "%s는 '%s' 톤으로 의미를 표현한다 (Tailwind 클래스가 아닌 tone 계약 검증)",
    (severity, tone) => {
      render(<SeverityBadge severity={severity} />);
      expect(screen.getByText(SEVERITY_LABELS[severity]).getAttribute("data-tone")).toBe(tone);
    },
  );

  it("data-severity로 조회 가능하다 (리포트 뷰가 뱃지를 찾는 안정적 훅)", () => {
    render(<SeverityBadge severity="fatal" />);
    expect(document.querySelector('[data-severity="fatal"]')).not.toBeNull();
  });
});

describe("RunStatusBadge", () => {
  it("모든 run 상태가 한국어 라벨을 렌더링한다 (exhaustive)", () => {
    for (const status of ALL_STATUSES) {
      render(<RunStatusBadge status={status} />);
      expect(screen.getByText(RUN_STATUS_LABELS[status])).toBeDefined();
      cleanup();
    }
  });

  it("RUN_STATUS_LABELS는 상태 4종을 정확히 매핑한다 (단일 소스)", () => {
    expect(RUN_STATUS_LABELS).toEqual({
      completed: "완료",
      error: "실패",
      running: "진행중",
      stalled: "중단됨",
    });
    expect(Object.keys(RUN_STATUS_LABELS).sort()).toEqual(
      [...ALL_STATUSES].sort(),
    );
  });

  it.each([
    ["completed", "success"],
    ["error", "danger"],
    ["running", "info"],
    ["stalled", "neutral"],
  ] as const)(
    "%s는 '%s' 톤으로 의미를 표현한다",
    (status, tone) => {
      render(<RunStatusBadge status={status} />);
      expect(screen.getByText(RUN_STATUS_LABELS[status]).getAttribute("data-tone")).toBe(tone);
    },
  );
});

describe("Button", () => {
  it("기본 type은 button이다 (폼 안에서 암묵적 submit 방지)", () => {
    render(<Button>확인</Button>);
    expect(screen.getByRole("button").getAttribute("type")).toBe("button");
  });

  it("type을 override할 수 있다", () => {
    render(<Button type="submit">저장</Button>);
    expect(screen.getByRole("button").getAttribute("type")).toBe("submit");
  });

  it("기본 variant는 primary이고 data-variant로 노출된다", () => {
    render(<Button>저장</Button>);
    expect(screen.getByRole("button").getAttribute("data-variant")).toBe(
      "primary",
    );
  });

  it.each(["primary", "secondary", "text"] as const)(
    "variant '%s'를 data-variant로 노출한다",
    (variant) => {
      render(<Button variant={variant}>버튼</Button>);
      expect(screen.getByRole("button").getAttribute("data-variant")).toBe(
        variant,
      );
    },
  );

  it("클릭 핸들러를 호출한다", () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>클릭</Button>);
    fireEvent.click(screen.getByRole("button"));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("disabled면 클릭 핸들러가 호출되지 않는다", () => {
    const onClick = vi.fn();
    render(
      <Button onClick={onClick} disabled>
        클릭
      </Button>,
    );
    fireEvent.click(screen.getByRole("button"));
    expect(onClick).not.toHaveBeenCalled();
  });

  it("전달한 className을 기본 스타일에 병합한다", () => {
    render(<Button className="w-full">확인</Button>);
    expect(screen.getByRole("button").className).toContain("w-full");
  });
});

describe("Card", () => {
  it("children과 임의의 속성(aria-*)을 전달한다", () => {
    render(
      <Card aria-label="리포트 카드">
        <p>본문</p>
      </Card>,
    );
    expect(screen.getByLabelText("리포트 카드")).toBeDefined();
    expect(screen.getByText("본문")).toBeDefined();
  });
});

describe("TextAreaField", () => {
  it("라벨과 textarea가 접근성 있게 연결된다", () => {
    render(<TextAreaField label="아이디어" placeholder="아이디어를 입력하세요" />);
    const textarea = screen.getByLabelText("아이디어");
    expect(textarea.tagName).toBe("TEXTAREA");
    expect(textarea.getAttribute("placeholder")).toBe("아이디어를 입력하세요");
  });

  it("제어 컴포넌트로 동작한다 (value·onChange 전달)", () => {
    function Harness() {
      const [value, setValue] = useState("");
      return (
        <TextAreaField
          label="아이디어"
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
      );
    }
    render(<Harness />);
    const textarea = screen.getByLabelText("아이디어") as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "AI 회의록" } });
    expect(textarea.value).toBe("AI 회의록");
  });

  it("명시적 id를 라벨 연결에 사용한다", () => {
    render(<TextAreaField id="idea-input" label="아이디어" />);
    const textarea = screen.getByLabelText("아이디어");
    expect(textarea.id).toBe("idea-input");
  });
});

describe("Collapsible", () => {
  it("기본은 접혀 있고 summary와 내용을 렌더링한다", () => {
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
    expect(screen.getByText("출처 목록").closest("details")?.open).toBe(true);
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

describe("PageShell", () => {
  it("로고 'anvil'이 홈(/)으로 링크되고 children을 렌더링한다", () => {
    render(
      <PageShell>
        <p>페이지 내용</p>
      </PageShell>,
    );
    const logo = screen.getByRole("link", { name: "anvil" });
    expect(logo.getAttribute("href")).toBe("/");
    expect(screen.getByText("페이지 내용")).toBeDefined();
  });

  it("banner·main 랜드마크를 제공한다 (접근성)", () => {
    render(
      <PageShell>
        <p>내용</p>
      </PageShell>,
    );
    expect(screen.getByRole("banner")).toBeDefined();
    expect(screen.getByRole("main")).toBeDefined();
  });
});

describe("ErrorState", () => {
  it("메시지와 '다시 시도' 버튼을 렌더링하고 클릭 시 onRetry를 호출한다", () => {
    const onRetry = vi.fn();
    render(<ErrorState message="네트워크 오류" onRetry={onRetry} />);
    expect(screen.getByRole("alert").textContent).toContain("네트워크 오류");
    fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it("onRetry가 없으면 버튼을 렌더링하지 않는다", () => {
    render(<ErrorState message="오류" />);
    expect(screen.queryByRole("button", { name: "다시 시도" })).toBeNull();
  });
});

describe("SectionHeading", () => {
  it("id 앵커를 가진 2단계 제목을 렌더링한다 (목차 네비 타겟)", () => {
    render(<SectionHeading id="market-context">시장 맥락</SectionHeading>);
    const heading = screen.getByRole("heading", { level: 2, name: "시장 맥락" });
    expect(heading.id).toBe("market-context");
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
    expect(screen.getByText("아직 실행된 컨설팅이 없습니다")).toBeDefined();
    expect(
      screen.getByText("아이디어를 입력해 첫 컨설팅을 시작해 보세요."),
    ).toBeDefined();
    expect(screen.getByRole("button", { name: "컨설팅 시작" })).toBeDefined();
  });

  it("설명·액션 없이 제목만으로도 렌더링된다", () => {
    render(<EmptyState title="결과 없음" />);
    expect(screen.getByRole("heading", { name: "결과 없음" })).toBeDefined();
    expect(screen.queryByRole("button")).toBeNull();
  });
});
