import { z } from "zod";
import { ResearchSourceIdSchema } from "./research.js";

export const CompetitorServiceSchema = z.object({
  name: z.string().min(1),
  description: z.string().min(1),
  url: z.url().optional(),
  pricingHint: z.string().optional(),
});
export type CompetitorService = z.infer<typeof CompetitorServiceSchema>;

/**
 * 코드가 groundingMetadata에서 추출한 검증된 검색 인용 (ADR-012).
 * uri는 원 사이트가 아니라 만료되는 vertexaisearch 리다이렉트 URL이다 — 그래서 sources[]를 대체하지 않는다.
 */
export const CitationSchema = z.object({
  uri: z.url(),
  title: z.string().optional(),
  domain: z.string().optional(),
});
export type Citation = z.infer<typeof CitationSchema>;

/**
 * 소스(YouTube·Hacker News·네이버)별 원시 타입을 하나로 정규화한 유저 목소리 (ADR-012).
 * 소비처는 프롬프트 마크다운과 아코디언 렌더 둘뿐이고, 둘 다 "인용문 + 출처 링크 + 작성자 + 인기도"다.
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
 * LLM이 프롬프트의 출력 JSON 예시를 보고 채우는 부분.
 * context-hunter는 grounding 모드라 responseSchema를 못 쓰고, 그 예시가 유일한 형식 지시다 —
 * 그래서 "LLM이 채우는 키"의 정의가 코드에 있어야 프롬프트-스키마 계약을 테스트할 수 있다.
 */
export const MarketContextDraftSchema = z.object({
  ideaTitle: z.string().min(1),

  // ── Summary: 본문에 노출되는 정제된 인사이트 ──
  /** 3~5문장. 건조한 팩트 브리핑 */
  briefing: z.string().min(1),
  /** 시장 규모·성장률 등 정량 지표. 지표를 못 찾는 아이디어가 있으므로 빈 배열을 허용한다 */
  marketSizeIndicators: z.array(z.string().min(1)),
  /** 경쟁 구도에서 읽어낸 한 단락 인사이트 */
  competitorInsight: z.string().min(1),
  /** 유저 목소리에서 읽어낸 한 단락 인사이트 */
  voicesInsight: z.string().min(1),

  // ── Details: 아코디언에 접히는 원시 근거 ──
  trends: z.array(z.string().min(1)),
  competitors: z.array(CompetitorServiceSchema),
  /**
   * 수집물 그대로가 아니라 LLM이 노이즈를 걷어내고 선별한 목소리다 (ADR-012).
   * 전 소스가 실패하면 빈 배열이 정상이다.
   */
  communityVoices: z.array(CommunityVoiceSchema),
  painPointEvidence: z.array(z.string().min(1)),
  /** LLM 자기보고 출처. 부정확할 수 있지만 만료되지 않는다 — citations와 실패 모드가 상보적이다 */
  sources: z.array(z.string().min(1)),
});
export type MarketContextDraft = z.infer<typeof MarketContextDraftSchema>;

/**
 * 코드가 주입하는 키. 프롬프트에 절대 넣지 않는다 —
 * LLM에게 인용을 채우라고 하면 URL을 지어낸다. citations는 판단이 아니라 사실이다.
 */
export const CODE_INJECTED_CONTEXT_KEYS = ["citations"] as const;

/** 저장·소비되는 최종 형태. `.shape` 접근이 필요한 계약 검증은 이 스키마를 쓴다 */
export const MarketContextObjectSchema = MarketContextDraftSchema.extend({
  citations: z.array(CitationSchema).default([]),
});

/** 구 목소리의 키를 CommunityVoice의 키로 옮긴다. 값 검증은 하지 않는다 — zod의 몫이다 */
function promoteYoutubeVoice(voice: unknown): unknown {
  if (voice === null || typeof voice !== "object" || Array.isArray(voice)) {
    return voice;
  }
  const legacy = voice as Record<string, unknown>;
  const promoted: Record<string, unknown> = {
    source: "youtube",
    title: legacy.videoTitle,
    url: legacy.videoUrl,
    text: legacy.comment,
  };
  if (legacy.authorName !== undefined) promoted.authorName = legacy.authorName;
  if (legacy.likeCount !== undefined) promoted.score = legacy.likeCount;
  return promoted;
}

/**
 * 구 context.json의 youtubeVoices[]를 communityVoices[]로 승격한다 (ADR-012 하위호환).
 * `.default([])`만 걸면 zod object의 strip 정책이 youtubeVoices를 모르는 키로 조용히 버려
 * 구 run의 유저 목소리가 리포트에서 소멸한다. 파싱은 성공하므로 테스트에도 걸리지 않는다.
 *
 * 손상된 구 데이터를 여기서 throw하지 않는다 — 검증 실패로 흘려보내 loadStepOutput의
 * null 처리 경로를 그대로 타게 한다.
 */
function promoteLegacyVoices(input: unknown): unknown {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    return input;
  }
  const raw = input as Record<string, unknown>;
  // 신 형식이 이기고, 구 키는 zod가 strip한다
  if ("communityVoices" in raw || !Array.isArray(raw.youtubeVoices)) {
    return input;
  }
  const { youtubeVoices, ...rest } = raw;
  return {
    ...rest,
    communityVoices: (youtubeVoices as unknown[]).map(promoteYoutubeVoice),
  };
}

export const MarketContextSchema = z.preprocess(
  promoteLegacyVoices,
  MarketContextObjectSchema,
);
export type MarketContext = z.infer<typeof MarketContextSchema>;
