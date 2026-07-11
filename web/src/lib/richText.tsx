import { Fragment, type ReactNode } from "react";
import {
  parseInline,
  parseRichText,
  type InlineToken,
  type ListItem,
} from "./richTextParser";

// 본문 규격 (docs/UI_GUIDE.md). 한국어 장문이라 줄간격을 1.8로 둔다.
const PROSE = "text-[15px] leading-[1.8] text-neutral-700";
const ORDERED = `${PROSE} list-decimal space-y-5 pl-6 marker:font-medium marker:text-neutral-500`;
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

// 번호 목록 항목은 `**라벨:** 본문…` 꼴이다. 라벨을 별도 줄로 띄우고 본문을 아래 블록으로
// 내린다 — 한 줄에 이어붙으면 번호가 있어도 통짜 문단이 되어 스캔이 안 된다 (docs/UI_GUIDE.md).
function renderItemContent(item: ListItem, splitLead: boolean): ReactNode {
  const lead = item.spans[0];
  if (!splitLead || lead === undefined || lead.type !== "strong") {
    return renderTokens(item.spans);
  }

  const body = item.spans.slice(1);
  return (
    <>
      <strong className="block">{lead.value}</strong>
      {body.length > 0 ? (
        <div className="mt-1">{renderTokens(body)}</div>
      ) : null}
    </>
  );
}

function renderItems(items: ListItem[], splitLead = false): ReactNode[] {
  return items.map((item, index) => (
    <li key={index}>
      {renderItemContent(item, splitLead)}
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

// 이미 항목별로 쪼개진 문자열 배열(verdict.conditions 등)을 번호 목록으로 렌더링한다.
// 번호 목록 규격(ORDERED·라벨 분리)의 정의는 이 파일 하나뿐이다 — 호출부가 <ol>을 직접 짜면
// 클래스가 복제되어 같은 리포트 안에 간격이 다른 두 종류의 번호 목록이 생긴다.
// 항목마다 renderRichText를 태우면 안 된다: 블록 파서가 항목마다 <div>를 씌워 리스트가 깨진다.
export function OrderedList({ items }: { items: string[] }): ReactNode {
  const listItems: ListItem[] = items.map((item) => ({
    spans: parseInline(item),
    children: [],
  }));

  return <ol className={ORDERED}>{renderItems(listItems, true)}</ol>;
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
              {renderItems(block.items, true)}
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
