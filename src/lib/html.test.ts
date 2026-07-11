import { describe, expect, it } from "vitest";
import { stripHtml } from "./html.js";

describe("stripHtml", () => {
  describe("태그 제거", () => {
    it("네이버 검색 하이라이트 <b> 태그를 벗긴다", () => {
      expect(stripHtml("<b>회의록</b> 요약")).toBe("회의록 요약");
    });

    it("앵커 태그를 벗기고 링크 텍스트만 남긴다 (href URL은 사라진다)", () => {
      const result = stripHtml('<a href="https://x.com">링크</a>');
      expect(result).toBe("링크");
      expect(result).not.toContain("https://x.com");
    });

    it("<pre><code> 안의 코드 텍스트만 남긴다", () => {
      expect(stripHtml("<pre><code>const x = 1;</code></pre>")).toBe(
        "const x = 1;",
      );
    });

    it("속성이 붙은 태그도 제거한다", () => {
      expect(stripHtml('<i class="x">기울임</i>텍스트')).toBe("기울임텍스트");
    });
  });

  describe("블록 경계 보존", () => {
    it("<p>로 나뉜 두 문단이 한 줄로 뭉개지지 않는다", () => {
      const result = stripHtml("<p>첫 문단</p><p>둘째 문단</p>");

      expect(result).toContain("\n");
      expect(result.split(/\n+/)).toEqual(["첫 문단", "둘째 문단"]);
    });

    it("닫는 태그 없이 <p>만 구분자로 쓰는 HN 댓글도 문단을 분리한다", () => {
      const result = stripHtml("첫 문단<p>둘째 문단<p>셋째 문단");

      expect(result.split(/\n+/)).toEqual(["첫 문단", "둘째 문단", "셋째 문단"]);
    });

    it("<br>을 개행으로 치환한다", () => {
      expect(stripHtml("줄1<br>줄2").split("\n")).toEqual(["줄1", "줄2"]);
    });

    it("<br/>과 <br />도 개행으로 치환한다", () => {
      expect(stripHtml("줄1<br/>줄2<br />줄3").split("\n")).toEqual([
        "줄1",
        "줄2",
        "줄3",
      ]);
    });

    it("</div>를 개행으로 치환한다", () => {
      expect(stripHtml("<div>줄1</div><div>줄2</div>").split(/\n+/)).toEqual([
        "줄1",
        "줄2",
      ]);
    });
  });

  describe("엔티티 디코드", () => {
    it("따옴표·부등호 엔티티를 디코드한다", () => {
      expect(stripHtml("&quot;인용&quot;")).toBe('"인용"');
      expect(stripHtml("doesn&#x27;t work")).toBe("doesn't work");
      expect(stripHtml("doesn&#39;t work")).toBe("doesn't work");
      expect(stripHtml("it&apos;s")).toBe("it's");
      expect(stripHtml("&lt;div&gt;")).toBe("<div>");
    });

    it("&nbsp;를 일반 공백으로 디코드한다", () => {
      expect(stripHtml("앞&nbsp;뒤")).toBe("앞 뒤");
    });

    it("슬래시 엔티티를 디코드한다", () => {
      expect(stripHtml("a&#x2F;b&#47;c")).toBe("a/b/c");
    });

    it("숫자 엔티티를 일반적으로 디코드한다", () => {
      expect(stripHtml("&#65;&#66;&#x43;")).toBe("ABC");
    });

    it("디코드할 수 없는 엔티티는 원문 그대로 둔다", () => {
      expect(stripHtml("&zzz; &#x110000;")).toBe("&zzz; &#x110000;");
    });
  });

  describe("이중 디코드 방지 (★ 핵심 계약)", () => {
    it("&amp;lt;는 &lt;가 되고, <가 되지 않는다", () => {
      const result = stripHtml("&amp;lt;");

      expect(result).toBe("&lt;");
      expect(result).not.toBe("<");
    });

    it("&amp;amp;는 &amp;가 된다", () => {
      expect(stripHtml("&amp;amp;")).toBe("&amp;");
    });

    it("&amp; 단독은 &로 디코드된다", () => {
      expect(stripHtml("A &amp; B")).toBe("A & B");
    });

    it("앰퍼샌드의 숫자 엔티티도 이중 디코드를 일으키지 않는다", () => {
      expect(stripHtml("&#38;lt;")).toBe("&lt;");
      expect(stripHtml("&#x26;amp;")).toBe("&amp;");
    });
  });

  describe("공백 정규화", () => {
    it("3개 이상 연속된 개행을 2개로 줄인다", () => {
      expect(stripHtml("줄1<br><br><br><br>줄2")).toBe("줄1\n\n줄2");
    });

    it("각 줄의 trailing 공백을 제거한다", () => {
      expect(stripHtml("줄1   <br>줄2   ")).toBe("줄1\n줄2");
    });

    it("전체를 trim한다", () => {
      expect(stripHtml("<p>본문</p>")).toBe("본문");
    });
  });

  describe("불변 조건", () => {
    it("빈 문자열은 빈 문자열을 반환하며 throw하지 않는다", () => {
      expect(() => stripHtml("")).not.toThrow();
      expect(stripHtml("")).toBe("");
    });

    it("태그·엔티티가 없는 평문은 입력 그대로 반환한다", () => {
      const plain = "회의록을 요약해주는 서비스가 필요하다. 정말로.";

      expect(stripHtml(plain)).toBe(plain);
    });

    it("내용을 자르거나 요약하지 않는다", () => {
      const long = "가".repeat(5000);

      expect(stripHtml(long)).toBe(long);
    });

    it("순수 함수다 — 같은 입력은 같은 출력을 낸다", () => {
      const input = "<p>doesn&#x27;t work</p><p>&amp;lt; 는 그대로</p>";

      expect(stripHtml(input)).toBe(stripHtml(input));
    });
  });

  describe("실전 원문", () => {
    it("Hacker News comment_text를 평문으로 정제한다", () => {
      const commentText =
        "I&#x27;ve tried this &amp; it doesn&#x27;t work.<p>The real issue is <i>latency</i> &gt; 2s.<p>See <a href=\"https://news.ycombinator.com/item?id=1\" rel=\"nofollow\">this thread</a>.";

      expect(stripHtml(commentText)).toBe(
        "I've tried this & it doesn't work.\nThe real issue is latency > 2s.\nSee this thread.",
      );
    });

    it("네이버 검색 API의 title/description을 평문으로 정제한다", () => {
      const description =
        "<b>AI 회의록</b> 서비스 후기 - 받아쓰기는 되는데 &quot;요약&quot;이 엉망이라 결국 손으로 고친다";

      expect(stripHtml(description)).toBe(
        'AI 회의록 서비스 후기 - 받아쓰기는 되는데 "요약"이 엉망이라 결국 손으로 고친다',
      );
    });
  });
});
