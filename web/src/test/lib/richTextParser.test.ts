import { describe, expect, it } from "vitest";
import {
  parseInline,
  parseRichText,
  type Block,
  type InlineToken,
} from "@/lib/richTextParser";
import {
  DECIMAL_PROSE,
  LEVER_BOLD_LEADIN,
  MONETIZATION_NUMBERED,
  REVISED_CONCEPT_NESTED,
} from "../richTextFixtures";

function textOf(spans: InlineToken[]): string {
  return spans.map((span) => span.value).join("");
}

function blockText(block: Block): string {
  if (block.type === "paragraph") return textOf(block.spans);
  return block.items.map((item) => textOf(item.spans)).join("\n");
}

describe("parseInline", () => {
  it("**볼드**를 strong 토큰으로, 나머지를 text 토큰으로 분리한다", () => {
    const tokens = parseInline(LEVER_BOLD_LEADIN);
    expect(tokens[0]).toEqual({
      type: "strong",
      value: "강력한 바이럴 루프 구축:",
    });
    expect(tokens[1]?.type).toBe("text");
    // 어떤 토큰에도 마크다운 마커가 남지 않는다
    expect(tokens.every((token) => !token.value.includes("**"))).toBe(true);
  });

  it("미종결 **는 리터럴 text로 남긴다", () => {
    const tokens = parseInline("**닫히지 않은 볼드");
    expect(tokens).toEqual([{ type: "text", value: "**닫히지 않은 볼드" }]);
  });
});

describe("parseRichText — 인라인 번호 목록", () => {
  it("개행이 없어도 `N. **`를 경계로 orderedList 하나를 만든다", () => {
    const blocks = parseRichText(MONETIZATION_NUMBERED);

    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe("orderedList");

    const block = blocks[0];
    if (block.type !== "orderedList") throw new Error("orderedList가 아니다");
    expect(block.items).toHaveLength(3);

    // 각 항목은 굵은 리드인으로 시작한다
    for (const item of block.items) {
      expect(item.spans[0]?.type).toBe("strong");
      expect(item.children).toEqual([]);
    }
    expect(block.items[0].spans[0].value).toBe(
      "AI 코칭 프리미엄 구독 (월 9.99달러 ~ 29.99달러):",
    );
    expect(block.items[2].spans[0].value).toBe(
      "독점 발레코어 컬렉션 기획 및 판매:",
    );

    // 번호 마커와 볼드 마커는 본문에 남지 않는다
    const text = blockText(block);
    expect(text).not.toMatch(/\*/);
    expect(text).not.toMatch(/(^|\s)\d+\.\s/);
  });

  it("소수점을 번호 목록으로 오분할하지 않는다", () => {
    const blocks = parseRichText(DECIMAL_PROSE);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe("paragraph");
  });
});

describe("parseRichText — 불릿 목록", () => {
  it("`*   ` 불릿을 2계층 unorderedList로 만든다", () => {
    const blocks = parseRichText(REVISED_CONCEPT_NESTED);

    expect(blocks.map((block) => block.type)).toEqual([
      "paragraph",
      "paragraph",
      "unorderedList",
    ]);

    // `**[Fatal/Major 비판 대응]**`는 불릿이 아니라 전체 볼드 문단이다
    const heading = blocks[1];
    if (heading.type !== "paragraph") throw new Error("paragraph가 아니다");
    expect(heading.spans).toEqual([
      { type: "strong", value: "[Fatal/Major 비판 대응]" },
    ]);

    const list = blocks[2];
    if (list.type !== "unorderedList") throw new Error("unorderedList가 아니다");
    expect(list.items).toHaveLength(7);
    for (const item of list.items) {
      expect(item.children).toHaveLength(1);
      expect(item.children[0].spans[0]).toEqual({
        type: "strong",
        value: "대응:",
      });
    }

    const text = [
      ...list.items.map((item) => textOf(item.spans)),
      ...list.items.flatMap((item) =>
        item.children.map((child) => textOf(child.spans)),
      ),
    ].join("\n");
    expect(text).not.toMatch(/\*/);
  });

  it("부모 없는 중첩 불릿은 최상위 항목으로 승격한다", () => {
    const blocks = parseRichText("    *   외톨이 항목");
    const list = blocks[0];
    if (list.type !== "unorderedList") throw new Error("unorderedList가 아니다");
    expect(list.items).toHaveLength(1);
    expect(list.items[0].children).toEqual([]);
  });
});

describe("parseRichText — 기존 계약 유지 / 우아한 실패", () => {
  it("모든 개행이 문단을 나눈다", () => {
    const blocks = parseRichText("첫 문단\n\n둘째 문단\n셋째 문단");
    expect(blocks).toHaveLength(3);
    expect(blocks.every((block) => block.type === "paragraph")).toBe(true);
    expect(blockText(blocks[2])).toBe("셋째 문단");
  });

  it("인식하지 못하는 문법은 문단 텍스트로 그대로 둔다", () => {
    const blocks = parseRichText("# 제목이 아니다\n_기울임 아님_");
    expect(blocks.map((block) => block.type)).toEqual([
      "paragraph",
      "paragraph",
    ]);
    expect(blockText(blocks[0])).toBe("# 제목이 아니다");
    expect(blockText(blocks[1])).toBe("_기울임 아님_");
  });

  it("빈 문자열은 빈 블록 배열을 반환한다", () => {
    expect(parseRichText("")).toEqual([]);
    expect(parseRichText("   \n  \n")).toEqual([]);
  });
});
