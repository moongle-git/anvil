import { z } from "zod";

export const CompetitorServiceSchema = z.object({
  name: z.string().min(1),
  description: z.string().min(1),
  url: z.url().optional(),
  pricingHint: z.string().optional(),
});
export type CompetitorService = z.infer<typeof CompetitorServiceSchema>;

export const YoutubeVoiceSchema = z.object({
  videoTitle: z.string().min(1),
  videoUrl: z.url(),
  comment: z.string().min(1),
  authorName: z.string().optional(),
  likeCount: z.number().int().nonnegative().optional(),
});
export type YoutubeVoice = z.infer<typeof YoutubeVoiceSchema>;

export const MarketContextSchema = z.object({
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
  /** YouTube quota 초과 시 빈 배열이 정상이다 */
  youtubeVoices: z.array(YoutubeVoiceSchema),
  painPointEvidence: z.array(z.string().min(1)),
  sources: z.array(z.string().min(1)),
});
export type MarketContext = z.infer<typeof MarketContextSchema>;
