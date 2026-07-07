import { render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup } from "@testing-library/react";
import { renderRichText } from "@/lib/richText";

afterEach(cleanup);

describe("renderRichText", () => {
  it("개행 기준으로 문단(<p>)을 분리한다", () => {
    const { container } = render(
      <div>{renderRichText("첫 문단\n\n둘째 문단\n셋째 문단")}</div>,
    );
    const paragraphs = container.querySelectorAll("p");
    expect(paragraphs.length).toBe(3);
    expect(paragraphs[0].textContent).toBe("첫 문단");
    expect(paragraphs[2].textContent).toBe("셋째 문단");
  });

  it("**볼드**를 <strong>으로 변환한다", () => {
    const { container, getByText } = render(
      <div>{renderRichText("이것은 **강조** 텍스트")}</div>,
    );
    const strong = getByText("강조");
    expect(strong.tagName).toBe("STRONG");
    // 볼드 앞뒤 일반 텍스트는 유지된다
    expect(container.querySelector("p")?.textContent).toBe("이것은 강조 텍스트");
  });

  it("미종결 볼드(**)는 리터럴로 남긴다", () => {
    const { container } = render(
      <div>{renderRichText("**닫히지 않은 볼드")}</div>,
    );
    expect(container.querySelector("strong")).toBeNull();
    expect(container.textContent).toContain("**닫히지 않은 볼드");
  });

  it("마크 없는 일반 텍스트는 그대로 한 문단으로 렌더링한다", () => {
    const { container } = render(<div>{renderRichText("평범한 문장")}</div>);
    expect(container.querySelectorAll("p").length).toBe(1);
    expect(container.querySelector("strong")).toBeNull();
  });
});
