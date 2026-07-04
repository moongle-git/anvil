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
  trends: z.array(z.string().min(1)),
  competitors: z.array(CompetitorServiceSchema),
  youtubeVoices: z.array(YoutubeVoiceSchema),
  painPointEvidence: z.array(z.string().min(1)),
  sources: z.array(z.string().min(1)),
});
export type MarketContext = z.infer<typeof MarketContextSchema>;
