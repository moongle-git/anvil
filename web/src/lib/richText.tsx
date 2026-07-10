import { Fragment, type ReactNode } from "react";
import {
  parseInline,
  parseRichText,
  type InlineToken,
  type ListItem,
} from "./richTextParser";

// 본문 규격 (docs/UI_GUIDE.md). 한국어 장문이라 줄간격을 1.8로 둔다.
const PROSE = "text-[15px] leading-[1.8] text-neutral-700";
const ORDERED = `${PROSE} list-decimal space-y-3 pl-6 marker:font-medium marker:text-neutral-500`;
const UNORDERED = `${PROSE} list-disc space-y-2 pl-5 marker:text-neutral-400`;
const NESTED = "mt-2 list-[circle] space-y-1.5 pl-5";

function renderTokens(spans: InlineToken[]): ReactNode[] {
  return spans.map((span, index) =>
    span.type === "strong" ? (
      <strong key={index}>{span.value}</strong>
    ) : (
      <Fragment key={index}>{span.value}</Fragment>
    ),
  );
}

function renderItems(items: ListItem[]): ReactNode[] {
  return items.map((item, index) => (
    <li key={index}>
      {renderTokens(item.spans)}
      {item.children.length > 0 ? (
        <ul className={NESTED}>{renderItems(item.children)}</ul>
      ) : null}
    </li>
  ));
}

// 블록 래퍼 없이 인라인 조각만 반환한다. 이미 <p>/<li> 안에 있는 문자열에 쓴다.
export function renderInline(text: string): ReactNode {
  return renderTokens(parseInline(text));
}

// 장문 텍스트를 문단·번호 목록·불릿 목록으로 렌더링한다.
export function renderRichText(text: string): ReactNode {
  return (
    <div className="flex flex-col gap-4">
      {parseRichText(text).map((block, index) => {
        if (block.type === "paragraph") {
          return (
            <p key={index} className={PROSE}>
              {renderTokens(block.spans)}
            </p>
          );
        }
        if (block.type === "orderedList") {
          return (
            <ol key={index} className={ORDERED}>
              {renderItems(block.items)}
            </ol>
          );
        }
        return (
          <ul key={index} className={UNORDERED}>
            {renderItems(block.items)}
          </ul>
        );
      })}
    </div>
  );
}
