/** 문단·줄바꿈 태그. 지우지 않고 개행으로 치환해야 문단 구분이 살아남는다. */
const BLOCK_BOUNDARY = /<\s*\/?\s*(?:br|p|div)\b[^>]*>/gi;
const ANY_TAG = /<[^>]*>/g;
const ENTITY = /&(#[xX][0-9a-fA-F]+|#\d+|[a-zA-Z][a-zA-Z0-9]*);/g;
/** `&amp;`와 그 숫자 표기(십진 38, 십육진 26). 항상 마지막에 디코드한다. */
const AMPERSAND_ENTITY = /&amp;|&#0*38;|&#[xX]0*26;/g;
/** `&#160;`으로 들어온 non-breaking space. 평문에서는 일반 공백이어야 trailing 정리에 걸린다. */
const NBSP = /\u00A0/g;

const MAX_CODE_POINT = 0x10ffff;

/** Map이어야 한다 — 객체 리터럴은 `&constructor;`가 Object.prototype을 타고 값을 찾아낸다. */
const NAMED_ENTITIES = new Map<string, string>([
  ["lt", "<"],
  ["gt", ">"],
  ["quot", '"'],
  ["apos", "'"],
  ["nbsp", " "],
]);

/** 디코드할 수 없는 코드포인트는 원문을 그대로 돌려준다 — 손실보다 노이즈가 낫다. */
function decodeNumericEntity(entity: string, body: string): string {
  const isHex = body.startsWith("#x") || body.startsWith("#X");
  const codePoint = isHex
    ? Number.parseInt(body.slice(2), 16)
    : Number.parseInt(body.slice(1), 10);

  if (!Number.isInteger(codePoint) || codePoint > MAX_CODE_POINT) return entity;
  return String.fromCodePoint(codePoint);
}

/**
 * HTML 태그를 제거하고 엔티티를 디코드해 평문으로 만든다.
 * Hacker News의 comment_text(HTML 본문)와 네이버 검색 API의 <b> 하이라이트를 정제하는 데 쓴다.
 * 임의의 HTML 문서를 위한 범용 파서가 아니다 — 두 API가 뱉는 인라인 마크업만 다룬다.
 *
 * 순서가 계약이다:
 * 태그를 먼저 지워야 `&lt;b&gt;`(문자 그대로의 "<b>")가 태그로 오인돼 사라지지 않고,
 * `&amp;`를 마지막에 디코드해야 `&amp;lt;`가 `&lt;`를 거쳐 `<`로 이중 디코드되지 않는다.
 * 내용을 자르거나 요약하지 않는다 — 길이 제한은 호출자의 정책이다.
 */
export function stripHtml(input: string): string {
  return input
    .replace(BLOCK_BOUNDARY, "\n")
    .replace(ANY_TAG, "")
    .replace(ENTITY, (entity: string, body: string) => {
      if (body.startsWith("#")) {
        const decoded = decodeNumericEntity(entity, body);
        // 앰퍼샌드는 마지막 패스로 미룬다. 여기서 풀면 `&#38;lt;`가 `&lt;` → `<`로 이중 디코드된다.
        return decoded === "&" ? entity : decoded;
      }
      return NAMED_ENTITIES.get(body) ?? entity;
    })
    .replace(AMPERSAND_ENTITY, "&")
    .replace(NBSP, " ")
    .replace(/\r\n?/g, "\n")
    .replace(/[^\S\n]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
