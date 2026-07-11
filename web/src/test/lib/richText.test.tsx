import { render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup } from "@testing-library/react";
import { OrderedList, renderInline, renderRichText } from "@/lib/richText";
import {
  LEVER_BOLD_LEADIN,
  MONETIZATION_NUMBERED,
  REVISED_CONCEPT_NESTED,
} from "../richTextFixtures";

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

  it("개행 없는 인라인 번호 목록을 <ol>/<li>로 렌더링한다", () => {
    const { container } = render(
      <div>{renderRichText(MONETIZATION_NUMBERED)}</div>,
    );

    expect(container.querySelectorAll("ol").length).toBe(1);
    expect(container.querySelectorAll("ol > li").length).toBe(3);
    expect(container.querySelectorAll("ol > li > strong").length).toBe(3);
    // 818자 단일 문단이던 회귀 케이스 — 이제 <p>는 하나도 없다
    expect(container.querySelectorAll("p").length).toBe(0);
    // 화면에 마크다운 마커가 남지 않는다
    expect(container.textContent).not.toContain("*");
  });

  it("번호 목록 항목의 볼드 라벨을 본문과 다른 블록으로 분리한다", () => {
    const { container } = render(
      <div>{renderRichText(MONETIZATION_NUMBERED)}</div>,
    );

    const items = container.querySelectorAll("ol > li");
    expect(items.length).toBe(3);

    for (const item of items) {
      // 라벨은 <li>의 첫 엘리먼트, 본문은 그 다음 형제 블록이다
      const label = item.firstElementChild;
      expect(label?.tagName).toBe("STRONG");
      expect(label?.textContent?.length).toBeGreaterThan(0);

      const body = label?.nextElementSibling;
      expect(body?.tagName).toBe("DIV");
      expect(body?.textContent?.length).toBeGreaterThan(0);

      // 라벨이 본문에 중복 출력되지 않는다 (항목 전체에서 정확히 1회 등장)
      const labelText = label?.textContent ?? "";
      expect(item.textContent?.split(labelText).length).toBe(2);
    }

    expect(items[0].firstElementChild?.textContent).toBe(
      "AI 코칭 프리미엄 구독 (월 9.99달러 ~ 29.99달러):",
    );
    expect(items[0].lastElementChild?.textContent).toContain(
      "무료 티어는 제한된 영상 분석",
    );
  });

  it("불릿 목록에는 라벨 분리를 적용하지 않는다", () => {
    const { container } = render(
      <div>{renderRichText(REVISED_CONCEPT_NESTED)}</div>,
    );

    // 항목 전체가 볼드인 최상위 불릿이 라벨/본문 블록으로 쪼개지지 않는다
    expect(container.querySelectorAll("ul li > div").length).toBe(0);

    const first = container.querySelector("ul > li");
    expect(first?.firstElementChild?.tagName).toBe("STRONG");
    // 볼드 다음에 오는 것은 본문 블록이 아니라 중첩 목록이다
    expect(first?.firstElementChild?.nextElementSibling?.tagName).toBe("UL");
  });

  it("2계층 불릿을 중첩 <ul>로 렌더링한다", () => {
    const { container } = render(
      <div>{renderRichText(REVISED_CONCEPT_NESTED)}</div>,
    );

    const lists = container.querySelectorAll("ul");
    expect(lists.length).toBe(8); // 최상위 1 + 중첩 7
    expect(lists[0].querySelectorAll(":scope > li").length).toBe(7);
    expect(container.querySelectorAll("ul ul > li").length).toBe(7);
    // `**[Fatal/Major 비판 대응]**`는 불릿이 아니라 볼드 문단이다
    expect(container.querySelectorAll("p").length).toBe(2);
    expect(container.textContent).not.toContain("*");
  });
});

describe("renderInline", () => {
  it("래핑 엘리먼트 없이 <strong>과 텍스트만 반환한다", () => {
    const { container } = render(<li>{renderInline(LEVER_BOLD_LEADIN)}</li>);

    expect(container.querySelector("li > strong")?.textContent).toBe(
      "강력한 바이럴 루프 구축:",
    );
    expect(container.querySelector("li > p")).toBeNull();
    expect(container.querySelector("li > div")).toBeNull();
    expect(container.textContent).not.toContain("**");
  });
});

// 이미 항목별로 쪼개진 string[](verdict.conditions 등)을 위한 진입점.
// renderRichText(블록 파서)를 항목마다 태우면 <div> 래퍼가 생겨 리스트 구조가 깨진다.
describe("OrderedList", () => {
  it("항목 배열을 <ol>의 직계 <li>로 렌더링한다 (항목당 블록 래퍼 없음)", () => {
    const { container } = render(
      <OrderedList items={["첫째 조건", "둘째 조건"]} />,
    );

    expect(container.querySelectorAll("ol").length).toBe(1);
    expect(container.querySelectorAll("ol > li").length).toBe(2);
    expect(container.querySelectorAll("ol > div").length).toBe(0);
    expect(container.querySelectorAll("ol > li")[0].textContent).toBe(
      "첫째 조건",
    );
  });

  it("볼드 라벨을 본문과 다른 블록으로 분리한다 (renderRichText의 번호 목록과 같은 규칙)", () => {
    const { container } = render(
      <OrderedList items={["**리텐션:** 40% 이상을 6개월 내 달성한다"]} />,
    );

    const label = container.querySelector("ol > li")?.firstElementChild;
    expect(label?.tagName).toBe("STRONG");
    expect(label?.textContent).toBe("리텐션:");

    const body = label?.nextElementSibling;
    expect(body?.tagName).toBe("DIV");
    expect(body?.textContent).toContain("40% 이상");
    expect(container.textContent).not.toContain("**");
  });

  // 규격이 한 곳에서만 정의된다는 계약. 클래스 문자열을 복제하면 같은 리포트 안에
  // 간격이 다른 두 종류의 번호 목록이 생긴다 — 이 단언은 그 복제를 잡는다.
  it("renderRichText의 번호 목록과 같은 <ol> 규격을 공유한다", () => {
    const { container: viaList } = render(<OrderedList items={["조건"]} />);
    const { container: viaRichText } = render(
      <div>{renderRichText(MONETIZATION_NUMBERED)}</div>,
    );

    expect(viaList.querySelector("ol")?.className).toBe(
      viaRichText.querySelector("ol")?.className,
    );
  });
});
