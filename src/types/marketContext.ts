import { z } from "zod";
import { CommunityVoiceSchema, SourceCoverageSchema } from "./research.js";

/**
 * CommunityVoice는 개념적으로 자료조사의 타입이라 research.ts가 소유한다.
 * 여기서 re-export해 기존 import 경로(types/marketContext.js)를 유지한다.
 */
export { CommunityVoiceSchema, type CommunityVoice } from "./research.js";

export const CompetitorServiceSchema = z.object({
  name: z.string().min(1),
  description: z.string().min(1),
  url: z.url().optional(),
  pricingHint: z.string().optional(),
});
export type CompetitorService = z.infer<typeof CompetitorServiceSchema>;

/**
 * 코드가 grounding 응답에서 추출한 검증된 검색 인용 (ADR-012).
 * 리다이렉트 uri는 원 사이트가 아니라 만료되는 URL이다 — 그래서 sources[]를 대체하지 않는다.
 *
 * kind가 없으면 가장 강한 인용과 반드시 깨질 인용을 한 배열에서 구분할 수 없다 (ADR-013).
 * 구 context.json은 citations가 전부 빈 배열이라 승격할 원소가 없다 — .default()를 걸지 않는다.
 */
export const CitationSchema = z.object({
  uri: z.url(),
  title: z.string().optional(),
  domain: z.string().optional(),
  /**
   * origin   = urlContext가 실제로 읽어낸 원본 URL. 만료되지 않는다 — 가장 강한 인용이다.
   * redirect = groundingChunks의 vertexaisearch 리다이렉트 URL. 만료되면 404가 된다.
   */
  kind: z.enum(["origin", "redirect"]),
});
export type Citation = z.infer<typeof CitationSchema>;

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
   * LLM이 선별한 목소리의 ID 참조("V1", "V2"…) — 원문·URL·작성자는 코드가 research 증거에서
   * 복원한다 (ADR-013). 노이즈 제거는 LLM의 판단이지만, 그 목소리가 무엇인지는 사실이라 코드가 소유한다.
   * 전 소스가 실패하면 빈 배열이 정상이다.
   */
  communityVoiceRefs: z.array(z.string().min(1)),
  painPointEvidence: z.array(z.string().min(1)),
  /** LLM 자기보고 출처. 부정확할 수 있지만 만료되지 않는다 — citations와 실패 모드가 상보적이다 */
  sources: z.array(z.string().min(1)),
});
export type MarketContextDraft = z.infer<typeof MarketContextDraftSchema>;

/**
 * 코드가 주입하는 키. 프롬프트에 절대 넣지 않는다 —
 * LLM에게 인용을 채우라고 하면 URL을 지어낸다. 출처는 판단이 아니라 사실이다 (ADR-013).
 */
export const CODE_INJECTED_CONTEXT_KEYS = [
  "citations",
  "researchCoverage",
  "communityVoices",
] as const;

/**
 * 저장·소비되는 최종 형태. `.shape` 접근이 필요한 계약 검증은 이 스키마를 쓴다.
 *
 * communityVoiceRefs는 산출물에 남기지 않는다 — research 증거의 인덱스에 의존하는 내부 좌표라,
 * 해소된 communityVoices와 나란히 두면 같은 사실에 대한 두 개의 진실이 된다 (ADR-013).
 */
export const MarketContextObjectSchema = MarketContextDraftSchema.omit({
  communityVoiceRefs: true,
}).extend({
  /**
   * 코드가 ID 참조를 research 증거의 실제 목소리로 치환해 채운다 (ADR-013).
   * LLM이 URL·원문을 다시 받아적을 자리가 없으므로 여기의 출처는 지어낼 수 없다.
   */
  communityVoices: z.array(CommunityVoiceSchema).default([]),
  citations: z.array(CitationSchema).default([]),
  /**
   * 소스별 수집 커버리지 (ADR-013). collectAll의 결과를 코드가 주입한다 —
   * "네이버 키가 없어 조사를 안 했다"를 리포트가 침묵으로 숨기지 않게 하려는 필드다.
   * 구 context.json에는 이 키가 없다. 빈 배열은 "커버리지 정보 없음"을 뜻한다.
   */
  researchCoverage: z.array(SourceCoverageSchema).default([]),
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

/**
 * 하류 에이전트(正·反·合·판정) 프롬프트용. citations는 코드가 만든 출처 메타데이터라 논증에 쓰이지 않는다.
 * run당 10~30개이고 리다이렉트 URL이 길어서, 그대로 두면 같은 URL 뭉치가 하류 4개 프롬프트에 중복해 실린다.
 * sources는 남긴다 — LLM 자기보고 설명은 하류에 맥락을 준다.
 * researchCoverage도 남긴다 — "국내 커뮤니티 근거가 아예 없다"를 하류가 알아야 논증에서 근거 부재를
 * 진술할 수 있다. 소스가 3개뿐이라 프롬프트를 부풀리지도 않는다.
 */
export function toPromptContext(
  context: MarketContext,
): Omit<MarketContext, "citations"> {
  // citations만 덜어내고 나머지는 그대로 넘긴다 — MarketContext에 필드가 늘어도 자동으로 따라간다
  const promptContext: Omit<MarketContext, "citations"> & {
    citations?: Citation[];
  } = { ...context };
  delete promptContext.citations;
  return promptContext;
}
