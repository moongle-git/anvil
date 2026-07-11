import { withTimeout } from "./withTimeout.js";

const YOUTUBE_API_BASE = "https://www.googleapis.com/youtube/v3";
const DEFAULT_MAX_VIDEOS = 5;
const DEFAULT_MAX_COMMENTS_PER_VIDEO = 10;
// YouTube API는 보통 1초 내 응답한다 — hang을 끊기 위한 상한
const DEFAULT_TIMEOUT_MS = 15_000;

export interface YoutubeVideo {
  videoId: string;
  title: string;
  channelTitle: string;
  url: string;
  description: string;
}

export interface YoutubeComment {
  videoId: string;
  text: string;
  authorName: string;
  likeCount: number;
}

export interface YoutubeServiceOptions {
  apiKey: string;
  maxVideos?: number;
  maxCommentsPerVideo?: number;
  fetchFn?: typeof fetch;
  timeoutMs?: number;
}

export class YoutubeApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly reason?: string,
  ) {
    super(message);
    this.name = "YoutubeApiError";
  }
}

interface YoutubeErrorBody {
  error?: {
    message?: string;
    errors?: { reason?: string }[];
  };
}

interface SearchListBody {
  items?: {
    id?: { videoId?: string };
    snippet?: {
      title?: string;
      channelTitle?: string;
      description?: string;
    };
  }[];
}

interface CommentThreadListBody {
  items?: {
    snippet?: {
      topLevelComment?: {
        snippet?: {
          textOriginal?: string;
          authorDisplayName?: string;
          likeCount?: number;
        };
      };
    };
  }[];
}

function buildApiErrorMessage(status: number, message: string, reason?: string): string {
  if (reason === "quotaExceeded") {
    return `YouTube API quota가 초과되었다 (quotaExceeded): ${message}`;
  }
  if (status === 401 || reason === "keyInvalid") {
    return `YouTube API 키가 유효하지 않다 (HTTP ${status}): ${message}`;
  }
  return `YouTube API 요청이 실패했다 (HTTP ${status}${reason ? `, ${reason}` : ""}): ${message}`;
}

export class YoutubeService {
  private readonly apiKey: string;
  private readonly maxVideos: number;
  private readonly maxCommentsPerVideo: number;
  private readonly fetchFn: typeof fetch;
  private readonly timeoutMs: number;

  constructor(options: YoutubeServiceOptions) {
    this.apiKey = options.apiKey;
    this.maxVideos = options.maxVideos ?? DEFAULT_MAX_VIDEOS;
    this.maxCommentsPerVideo =
      options.maxCommentsPerVideo ?? DEFAULT_MAX_COMMENTS_PER_VIDEO;
    this.fetchFn = options.fetchFn ?? globalThis.fetch;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  async searchVideos(query: string): Promise<YoutubeVideo[]> {
    const body = await this.request<SearchListBody>("search", {
      part: "snippet",
      type: "video",
      relevanceLanguage: "ko",
      maxResults: String(this.maxVideos),
      q: query,
    });

    const videos: YoutubeVideo[] = [];
    for (const item of body.items ?? []) {
      const videoId = item.id?.videoId;
      if (videoId === undefined || videoId === "") {
        continue;
      }
      videos.push({
        videoId,
        title: item.snippet?.title ?? "",
        channelTitle: item.snippet?.channelTitle ?? "",
        url: `https://www.youtube.com/watch?v=${videoId}`,
        description: item.snippet?.description ?? "",
      });
    }
    return videos.slice(0, this.maxVideos);
  }

  async fetchComments(videoId: string): Promise<YoutubeComment[]> {
    const body = await this.request<CommentThreadListBody>("commentThreads", {
      part: "snippet",
      order: "relevance",
      maxResults: String(this.maxCommentsPerVideo),
      videoId,
    });

    const comments: YoutubeComment[] = [];
    for (const item of body.items ?? []) {
      const snippet = item.snippet?.topLevelComment?.snippet;
      if (snippet?.textOriginal === undefined) {
        continue;
      }
      comments.push({
        videoId,
        text: snippet.textOriginal,
        authorName: snippet.authorDisplayName ?? "",
        likeCount: snippet.likeCount ?? 0,
      });
    }
    return comments.slice(0, this.maxCommentsPerVideo);
  }

  async collectVoices(
    query: string,
  ): Promise<{ video: YoutubeVideo; comments: YoutubeComment[] }[]> {
    const videos = await this.searchVideos(query);

    const voices: { video: YoutubeVideo; comments: YoutubeComment[] }[] = [];
    for (const video of videos) {
      try {
        voices.push({ video, comments: await this.fetchComments(video.videoId) });
      } catch (error) {
        // 댓글 비활성화는 정상 케이스 — 해당 영상만 건너뛴다
        if (
          error instanceof YoutubeApiError &&
          error.reason === "commentsDisabled"
        ) {
          continue;
        }
        throw error;
      }
    }
    return voices;
  }

  private async request<T>(
    endpoint: string,
    params: Record<string, string>,
  ): Promise<T> {
    const url = new URL(`${YOUTUBE_API_BASE}/${endpoint}`);
    for (const [name, value] of Object.entries(params)) {
      url.searchParams.set(name, value);
    }
    url.searchParams.set("key", this.apiKey);

    // hang을 끊는다: abortSignal로 요청을 취소하고 withTimeout으로 상한을 강제한다
    const response = await withTimeout(
      this.fetchFn(url.toString(), {
        signal: AbortSignal.timeout(this.timeoutMs),
      }),
      this.timeoutMs,
      "YouTube API 요청",
    );
    if (!response.ok) {
      const errorBody = (await response
        .json()
        .catch(() => ({}))) as YoutubeErrorBody;
      const message = errorBody.error?.message ?? response.statusText;
      const reason = errorBody.error?.errors?.[0]?.reason;
      throw new YoutubeApiError(
        buildApiErrorMessage(response.status, message, reason),
        response.status,
        reason,
      );
    }
    return (await response.json()) as T;
  }
}
