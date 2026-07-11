import { z } from "zod";

/**
 * 자료조사 소스의 좌표계 (ADR-012). 소스는 정확히 셋이고 전부 컴파일 타임에 알려져 있다 —
 * 이 배열 자체가 레지스트리다(플러그인 등록 없음).
 */
export const RESEARCH_SOURCE_IDS = ["youtube", "hackernews", "naver"] as const;
export const ResearchSourceIdSchema = z.enum(RESEARCH_SOURCE_IDS);
export type ResearchSourceId = (typeof RESEARCH_SOURCE_IDS)[number];

/**
 * 소스 표시 라벨의 단일 소스. report.ts와 web은 라벨을 하드코딩하지 않고 이 상수만 읽는다.
 */
export const SOURCE_LABELS: Record<ResearchSourceId, string> = {
  youtube: "YouTube",
  hackernews: "Hacker News",
  naver: "네이버",
};

/**
 * researchPlanner 산출물 — 아이디어 원문을 그대로 검색하지 않고 소스별 검색어를 생성한다.
 * 파이프라인 step이 아니라 context-hunter 내부 호출이다 (ADR-012).
 */
export const SearchQueriesSchema = z.object({
  /** YouTube 댓글 검색어 — 한국어. 타겟 유저가 실제로 쓰는 생활 언어 */
  youtube: z.string().min(1),
  /**
   * Hacker News 검색어 — 반드시 영어.
   * HN은 영어권이라 한국어 쿼리로는 조용히 0건이 된다.
   */
  hackernews: z.string().min(1),
  /** 네이버 블로그·카페·지식iN 검색어 — 한국어 */
  naver: z.string().min(1),
  /** Google Search grounding에 줄 검색 힌트 — 한국어. 1~3개 */
  web: z.array(z.string().min(1)).min(1).max(3),
});
export type SearchQueries = z.infer<typeof SearchQueriesSchema>;
