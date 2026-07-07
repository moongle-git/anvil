import type { ReactNode } from "react";

// 인라인 변환: **볼드**만 <strong>으로. 미종결 **는 정규식에 매칭되지 않아 리터럴로 남는다.
function renderInline(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const boldPattern = /\*\*(.+?)\*\*/g;
  let lastIndex = 0;
  let key = 0;
  let match: RegExpExecArray | null;
  while ((match = boldPattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(text.slice(lastIndex, match.index));
    }
    nodes.push(<strong key={key++}>{match[1]}</strong>);
    lastIndex = boldPattern.lastIndex;
  }
  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex));
  }
  return nodes;
}

// 에이전트 산출물의 장문 텍스트를 문단(<p>)으로 분리하고 **볼드**만 변환한다.
// 그 외 마크다운 문법은 처리하지 않고 일반 텍스트로 둔다 (의존성 없는 최소 렌더).
export function renderRichText(text: string): ReactNode {
  const paragraphs = text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  return (
    <div className="flex flex-col gap-3">
      {paragraphs.map((paragraph, index) => (
        <p
          key={index}
          className="text-[15px] leading-relaxed text-neutral-700"
        >
          {renderInline(paragraph)}
        </p>
      ))}
    </div>
  );
}
