import { withTimeout } from "./withTimeout.js";

const YOUTUBE_API_BASE = "https://www.googleapis.com/youtube/v3";
const YOUTUBE_WATCH_BASE = "https://www.youtube.com/watch?v=";
const DEFAULT_MAX_VIDEOS = 5;
const DEFAULT_MAX_COMMENTS_PER_VIDEO = 10;
// YouTube API는 보통 1초 내 응답한다 — hang을 끊기 위한 상한
const DEFAULT_TIMEOUT_MS = 15_000;
/**
 * 이 길이를 넘는 댓글은 자르지 않고 버린다 (hackerNews.ts의 MAX_COMMENT_LENGTH와 같은 규칙).
 * 상한이 없으면 장문 댓글 몇 개가 하류 프롬프트를 무제한 팽창시킨다 — 비용이자 견고성 문제다.
 * 잘라서 싣지 않는 이유: 잘린 조각이 communityVoices에 그대로 실려 "원문 그대로 인용"으로
 * 리포트에 나간다. 요약본을 인용으로 실으면 리포트가 거짓말을 한다 (research/format.ts).
 */
const MAX_COMMENT_LENGTH = 1200;

export interface YoutubeVideo {
  videoId: string;
  title: string;
  channelTitle: string;
  url: string;
  description: string;
}

export interface YoutubeComment {
  videoId: string;
  commentId: string;
  text: string;
  authorName: string;
  likeCount: number;
  /** 항상 댓글 퍼머링크. 인용의 출처는 그 댓글이지 영상 페이지가 아니다 */
  url: string;
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
        id?: string;
        snippet?: {
          textOriginal?: string;
          authorDisplayName?: string;
          likeCount?: number;
        };
      };
    };
  }[];
}

function videoUrl(videoId: string): string {
  return `${YOUTUBE_WATCH_BASE}${videoId}`;
}

/**
 * `lc`는 해당 댓글로 스크롤·하이라이트하는 YouTube 표준 파라미터다.
 * URL/URLSearchParams로 조립하지 않는다 — 값이 인코딩되면 permalink가 깨진다.
 */
function commentUrl(videoId: string, commentId: string): string {
  return `${videoUrl(videoId)}&lc=${commentId}`;
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
        url: videoUrl(videoId),
        description: item.snippet?.description ?? "",
      });
    }
    return videos.slice(0, this.maxVideos);
  }

  /** part=snippet으로 충분하다 — topLevelComment(id 포함)가 그 안에 들어 있다 */
  async fetchComments(videoId: string): Promise<YoutubeComment[]> {
    const body = await this.request<CommentThreadListBody>("commentThreads", {
      part: "snippet",
      order: "relevance",
      maxResults: String(this.maxCommentsPerVideo),
      videoId,
    });

    const comments: YoutubeComment[] = [];
    for (const item of body.items ?? []) {
      const topLevelComment = item.snippet?.topLevelComment;
      const commentId = topLevelComment?.id;
      const snippet = topLevelComment?.snippet;
      // ID가 없으면 영상 URL로 폴백하지 않고 버린다. 폴백하면 "이 댓글이 출처다"라는
      // 계약이 조용히 깨진 채 통과한다 — 없는 근거보다 잘못된 근거가 나쁘다
      if (commentId === undefined || commentId === "") {
        continue;
      }
      if (snippet?.textOriginal === undefined) {
        continue;
      }
      // 초과분은 잘라내지 않고 통째로 버린다 (HN과 같은 규칙)
      if (snippet.textOriginal.length > MAX_COMMENT_LENGTH) {
        continue;
      }
      comments.push({
        videoId,
        commentId,
        text: snippet.textOriginal,
        authorName: snippet.authorDisplayName ?? "",
        likeCount: snippet.likeCount ?? 0,
        url: commentUrl(videoId, commentId),
      });
    }
    return comments.slice(0, this.maxCommentsPerVideo);
  }

  async collectVoices(
    query: string,
  ): Promise<{ video: YoutubeVideo; comments: YoutubeComment[] }[]> {
    const videos = await this.searchVideos(query);

    // 영상별 댓글 요청은 서로 독립이다 — 병렬로 보내 지연을 sum이 아니라 max로 만든다
    const settled = await Promise.allSettled(
      videos.map((video) => this.fetchComments(video.videoId)),
    );

    // 댓글 비활성화만 정상 케이스로 건너뛴다. 나머지(특히 quotaExceeded)를 삼키면
    // quota 초과가 조용히 "댓글 0개"가 되어 수집 실패가 보이지 않는다
    const fatal = settled.find(
      (result): result is PromiseRejectedResult =>
        result.status === "rejected" &&
        !(
          result.reason instanceof YoutubeApiError &&
          result.reason.reason === "commentsDisabled"
        ),
    );
    if (fatal !== undefined) {
      throw fatal.reason;
    }

    // allSettled는 입력 순서로 결과를 준다 — 응답이 늦게 도착해도 영상 순서가 보존된다
    const voices: { video: YoutubeVideo; comments: YoutubeComment[] }[] = [];
    settled.forEach((result, index) => {
      if (result.status === "fulfilled") {
        voices.push({ video: videos[index], comments: result.value });
      }
    });
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
