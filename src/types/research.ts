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
 * 소스(YouTube·Hacker News·네이버)별 원시 타입을 하나로 정규화한 유저 목소리 (ADR-012).
 * 소비처는 프롬프트 마크다운과 아코디언 렌더 둘뿐이고, 둘 다 "인용문 + 출처 링크 + 작성자 + 인기도"다.
 *
 * 시장 맥락의 타입이 아니라 자료조사의 타입이다 — marketContext.ts가 여기서 re-export한다.
 */
export const CommunityVoiceSchema = z.object({
  source: ResearchSourceIdSchema,
  /** 출처 문서 제목 — 영상·스토리·글 */
  title: z.string().min(1),
  /** 출처 퍼머링크 */
  url: z.url(),
  /** 인용 원문 */
  text: z.string().min(1),
  authorName: z.string().optional(),
  /** 좋아요·points를 "인기도" 하나로 단일화한다 */
  score: z.number().int().nonnegative().optional(),
  /** 소스별 부가 1줄 (검색 스니펫 등) */
  extra: z.string().optional(),
});
export type CommunityVoice = z.infer<typeof CommunityVoiceSchema>;

/**
 * 소스별 자료조사 결과 (ADR-013).
 *
 * "0건"과 "키가 없어 아예 조사 안 함"과 "에러로 실패함"은 전부 다른 사실이다.
 * - collected + count 0 = 소스는 켜져 있었고 검색은 됐는데 결과가 0건이다 (HN에 한국어 쿼리가 가면 이렇게 된다).
 *   시장 신호다.
 * - unconfigured = API 키가 없어 소스 배열에 애초에 없었다 (buildResearchSources). 우리 설정 문제다.
 * 이 둘을 뭉개면 리포트가 "네이버 근거 없음"을 침묵으로 숨긴다.
 */
export const SourceCoverageSchema = z.object({
  source: ResearchSourceIdSchema,
  status: z.enum(["collected", "unconfigured", "failed"]),
  /** 수집 건수. unconfigured·failed면 0 */
  count: z.number().int().nonnegative(),
  /** status가 failed일 때만 */
  error: z.string().optional(),
});
export type SourceCoverage = z.infer<typeof SourceCoverageSchema>;

/**
 * artifacts(kind='research') — LLM 이전의 사실 (ADR-013).
 * context 산출물의 communityVoices는 이 증거 voices[]의 부분집합이어야 한다.
 */
export const ResearchEvidenceSchema = z.object({
  voices: z.array(CommunityVoiceSchema),
  coverage: z.array(SourceCoverageSchema),
});
export type ResearchEvidence = z.infer<typeof ResearchEvidenceSchema>;

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
