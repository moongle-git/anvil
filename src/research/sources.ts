import type { HackerNewsService } from "../services/hackerNews.js";
import type { NaverService } from "../services/naver.js";
import type { YoutubeService } from "../services/youtube.js";
import { SOURCE_LABELS, type CommunityVoice } from "../types/index.js";
import type { ResearchSource } from "./types.js";

/**
 * 네이버 description은 게시글 본문이 아니라 말줄임이 든 ~200자 검색 스니펫이다 (step 4).
 * 이 표시가 없으면 LLM이 잘린 문장을 완결된 원문 인용으로 리포트에 싣는다.
 */
const NAVER_SNIPPET_NOTE = "검색 스니펫";

export function youtubeSource(service: YoutubeService): ResearchSource {
  return {
    id: "youtube",
    label: SOURCE_LABELS.youtube,
    async collect(query: string): Promise<CommunityVoice[]> {
      const collected = await service.collectVoices(query);
      // 영상 묶음이 아니라 댓글 하나가 목소리 하나다.
      // url은 댓글 퍼머링크(service가 조립한다) — title만 영상 것이다. 댓글에는 제목이 없다
      return collected.flatMap(({ video, comments }) =>
        comments.map((comment) => ({
          source: "youtube" as const,
          title: video.title,
          url: comment.url,
          text: comment.text,
          ...(comment.authorName !== "" ? { authorName: comment.authorName } : {}),
          score: comment.likeCount,
        })),
      );
    },
  };
}

export function hackerNewsSource(service: HackerNewsService): ResearchSource {
  return {
    id: "hackernews",
    label: SOURCE_LABELS.hackernews,
    async collect(query: string): Promise<CommunityVoice[]> {
      const { stories, comments } = await service.collect(query);
      const commentVoices: CommunityVoice[] = comments.map((comment) => ({
        source: "hackernews" as const,
        title: comment.storyTitle,
        url: comment.url,
        text: comment.text,
        ...(comment.author !== "" ? { authorName: comment.author } : {}),
      }));
      // 스토리는 목소리라기보다 "이런 제품·글이 논의되고 있다"는 신호다 — 경쟁사 발굴 단서로 남긴다
      const storyVoices: CommunityVoice[] = stories.map((story) => ({
        source: "hackernews" as const,
        title: story.title,
        url: story.url,
        text: story.title,
        ...(story.author !== "" ? { authorName: story.author } : {}),
        score: story.points,
        extra: `HN 스토리 · 댓글 ${story.numComments}개`,
      }));
      return [...commentVoices, ...storyVoices];
    },
  };
}

export function naverSource(service: NaverService): ResearchSource {
  return {
    id: "naver",
    label: SOURCE_LABELS.naver,
    async collect(query: string): Promise<CommunityVoice[]> {
      const posts = await service.collect(query);
      return posts.map((post) => ({
        source: "naver" as const,
        title: post.title,
        url: post.link,
        text: post.description,
        ...(post.authorName !== undefined ? { authorName: post.authorName } : {}),
        extra: NAVER_SNIPPET_NOTE,
      }));
    },
  };
}
