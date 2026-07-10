// 에이전트 산출물의 장문 텍스트를 블록 토큰으로 파싱한다. React 비의존 — 단위 테스트 가능.
//
// 지원 문법은 실제 산출물에 나타나는 것만: **볼드**, `N. **항목:**` 번호 목록, `*   ` 불릿(2계층).
// 그 외 문법은 문단 텍스트로 그대로 둔다. 절대 throw 하지 않는다.

export type InlineToken =
  | { type: "text"; value: string }
  | { type: "strong"; value: string };

export interface ListItem {
  spans: InlineToken[];
  children: ListItem[];
}

export type Block =
  | { type: "paragraph"; spans: InlineToken[] }
  | { type: "orderedList"; items: ListItem[] }
  | { type: "unorderedList"; items: ListItem[] };

// `*` 뒤에 공백을 요구하므로 `**볼드**`로 시작하는 줄과 충돌하지 않는다.
const BULLET = /^([ \t]*)\*[ \t]+(\S.*?)[ \t]*$/;

// 번호 목록 줄은 반드시 볼드 리드인으로 시작한다 (실제 산출물 규칙).
const ORDERED_LINE = /^\d+\.[ \t]+\*\*/;

// 한 줄 안의 항목 경계. `(?=\*\*)`가 "9.99달러" 같은 소수의 오분할을 막는다.
// lookbehind를 쓰지 않는다 — 이 파서는 클라이언트 컴포넌트에서도 실행된다.
const ORDERED_ITEM = /(?:^|\s)\d+\.\s+(?=\*\*)/g;

// 중첩 불릿으로 볼 최소 들여쓰기. 실제 데이터는 최상위 0, 중첩 3~4를 쓴다.
const NESTED_INDENT = 2;

export function parseInline(text: string): InlineToken[] {
  const bold = /\*\*(.+?)\*\*/g;
  const tokens: InlineToken[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = bold.exec(text)) !== null) {
    if (match.index > lastIndex) {
      tokens.push({ type: "text", value: text.slice(lastIndex, match.index) });
    }
    tokens.push({ type: "strong", value: match[1] });
    lastIndex = bold.lastIndex;
  }
  if (lastIndex < text.length) {
    tokens.push({ type: "text", value: text.slice(lastIndex) });
  }
  return tokens;
}

// `1. **A:** … 2. **B:** …` 한 줄을 항목 본문 배열로 쪼갠다. 번호 마커는 버린다.
function splitOrderedItems(line: string): string[] {
  const matches = [...line.matchAll(ORDERED_ITEM)];
  const items: string[] = [];

  for (let i = 0; i < matches.length; i += 1) {
    const start = matches[i].index + matches[i][0].length;
    const end = i + 1 < matches.length ? matches[i + 1].index : line.length;
    const content = line.slice(start, end).trim();
    if (content !== "") {
      items.push(content);
    }
  }
  return items;
}

export function parseRichText(text: string): Block[] {
  const blocks: Block[] = [];
  let ordered: ListItem[] = [];
  let unordered: ListItem[] = [];

  function flush(): void {
    if (ordered.length > 0) {
      blocks.push({ type: "orderedList", items: ordered });
      ordered = [];
    }
    if (unordered.length > 0) {
      blocks.push({ type: "unorderedList", items: unordered });
      unordered = [];
    }
  }

  for (const rawLine of text.split("\n")) {
    if (rawLine.trim() === "") {
      flush();
      continue;
    }

    const bullet = BULLET.exec(rawLine);
    if (bullet !== null) {
      if (ordered.length > 0) flush();

      const item: ListItem = { spans: parseInline(bullet[2]), children: [] };
      const parent = unordered[unordered.length - 1];
      // 부모 없는 중첩 불릿은 최상위로 승격 — 데이터가 어긋나도 항목을 잃지 않는다.
      if (bullet[1].length >= NESTED_INDENT && parent !== undefined) {
        parent.children.push(item);
      } else {
        unordered.push(item);
      }
      continue;
    }

    const line = rawLine.trim();
    if (ORDERED_LINE.test(line)) {
      if (unordered.length > 0) flush();
      for (const content of splitOrderedItems(line)) {
        ordered.push({ spans: parseInline(content), children: [] });
      }
      continue;
    }

    flush();
    blocks.push({ type: "paragraph", spans: parseInline(line) });
  }

  flush();
  return blocks;
}
