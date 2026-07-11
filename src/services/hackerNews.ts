import { stripHtml } from "../lib/html.js";
import { withTimeout } from "./withTimeout.js";

// Algolia HN Search API — 인증 없음, IP당 시간당 10,000회
const HACKER_NEWS_API_BASE = "https://hn.algolia.com/api/v1";
const HACKER_NEWS_ITEM_BASE = "https://news.ycombinator.com/item?id=";
const DEFAULT_MAX_STORIES = 5;
const DEFAULT_MAX_COMMENTS = 12;
// 저품질 스토리 컷
const DEFAULT_MIN_POINTS = 10;
// Algolia는 보통 1초 내 응답한다 — hang을 끊기 위한 상한
const DEFAULT_TIMEOUT_MS = 15_000;
/**
 * 이 길이를 넘는 코멘트는 자르지 않고 버린다.
 * HN에는 에세이급 댓글이 흔한데, 잘라서 넘기면 LLM이 "…"로 끝나는 조각을
 * "원문 그대로 인용"으로 리포트에 실어 인용 계약이 깨진다.
 */
const MAX_COMMENT_LENGTH = 1200;

export interface HackerNewsStory {
  objectId: string;
  title: string;
  /** Ask HN/Show HN은 url이 null이라 HN 아이템 퍼머링크로 폴백한다 — 항상 유효한 URL */
  url: string;
  author: string;
  points: number;
  numComments: number;
}

export interface HackerNewsComment {
  objectId: string;
  /** stripHtml을 통과한 평문 — comment_text는 HTML이다 */
  text: string;
  author: string;
  storyTitle: string;
  /** 항상 코멘트 퍼머링크. 인용의 출처는 그 댓글이지 원문 기사(story_url)가 아니다 */
  url: string;
}

export interface HackerNewsServiceOptions {
  maxStories?: number;
  maxComments?: number;
  minPoints?: number;
  fetchFn?: typeof fetch;
  timeoutMs?: number;
}

export class HackerNewsApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "HackerNewsApiError";
  }
}

interface HackerNewsErrorBody {
  message?: string;
  error?: string;
}

interface StorySearchBody {
  hits?: {
    objectID?: string;
    title?: string;
    url?: string | null;
    author?: string;
    points?: number;
    num_comments?: number;
  }[];
}

interface CommentSearchBody {
  hits?: {
    objectID?: string;
    comment_text?: string | null;
    author?: string;
    story_title?: string;
  }[];
}

function buildApiErrorMessage(status: number, message: string): string {
  if (status === 429) {
    return `Hacker News API 요청 한도를 초과했다 (HTTP 429): ${message}`;
  }
  return `Hacker News API 요청이 실패했다 (HTTP ${status}): ${message}`;
}

function itemUrl(objectId: string): string {
  return `${HACKER_NEWS_ITEM_BASE}${objectId}`;
}

export class HackerNewsService {
  private readonly maxStories: number;
  private readonly maxComments: number;
  private readonly minPoints: number;
  private readonly fetchFn: typeof fetch;
  private readonly timeoutMs: number;

  constructor(options: HackerNewsServiceOptions = {}) {
    this.maxStories = options.maxStories ?? DEFAULT_MAX_STORIES;
    this.maxComments = options.maxComments ?? DEFAULT_MAX_COMMENTS;
    this.minPoints = options.minPoints ?? DEFAULT_MIN_POINTS;
    this.fetchFn = options.fetchFn ?? globalThis.fetch;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  /** query는 이미 영어여야 한다 — HN은 영어권이라 한국어 쿼리는 에러 없이 0건이 된다 */
  async searchStories(query: string): Promise<HackerNewsStory[]> {
    const body = await this.request<StorySearchBody>({
      query,
      tags: "story",
      hitsPerPage: String(this.maxStories),
      numericFilters: `points>=${this.minPoints}`,
    });

    const stories: HackerNewsStory[] = [];
    for (const hit of body.hits ?? []) {
      const objectId = hit.objectID;
      if (objectId === undefined || objectId === "") {
        continue;
      }
      const url = hit.url;
      stories.push({
        objectId,
        title: hit.title ?? "",
        url: url === undefined || url === null || url === "" ? itemUrl(objectId) : url,
        author: hit.author ?? "",
        points: hit.points ?? 0,
        numComments: hit.num_comments ?? 0,
      });
    }
    return stories.slice(0, this.maxStories);
  }

  async searchComments(query: string): Promise<HackerNewsComment[]> {
    const body = await this.request<CommentSearchBody>({
      query,
      tags: "comment",
      hitsPerPage: String(this.maxComments),
    });

    const comments: HackerNewsComment[] = [];
    for (const hit of body.hits ?? []) {
      const objectId = hit.objectID;
      const rawText = hit.comment_text;
      if (objectId === undefined || objectId === "") {
        continue;
      }
      if (rawText === undefined || rawText === null) {
        continue;
      }
      const text = stripHtml(rawText);
      // 정제 후 길이로 판단한다. 초과분은 잘라내지 않고 통째로 버린다
      if (text === "" || text.length > MAX_COMMENT_LENGTH) {
        continue;
      }
      comments.push({
        objectId,
        text,
        author: hit.author ?? "",
        storyTitle: hit.story_title ?? "",
        url: itemUrl(objectId),
      });
    }
    return comments.slice(0, this.maxComments);
  }

  /**
   * 정확히 2 round-trip이다. tags=comment hit이 story_title을 이미 실어 오므로
   * 스토리마다 댓글 트리를 도는 N+1(tags=comment,story_{id})은 호출만 늘고 관련도는 낮다.
   */
  async collect(
    query: string,
  ): Promise<{ stories: HackerNewsStory[]; comments: HackerNewsComment[] }> {
    const [stories, comments] = await Promise.all([
      this.searchStories(query),
      this.searchComments(query),
    ]);
    return { stories, comments };
  }

  private async request<T>(params: Record<string, string>): Promise<T> {
    // /search는 관련도 순이다. /search_by_date(최신순)는 쓰지 않는다
    const url = new URL(`${HACKER_NEWS_API_BASE}/search`);
    for (const [name, value] of Object.entries(params)) {
      url.searchParams.set(name, value);
    }

    // hang을 끊는다: abortSignal로 요청을 취소하고 withTimeout으로 상한을 강제한다
    const response = await withTimeout(
      this.fetchFn(url.toString(), {
        signal: AbortSignal.timeout(this.timeoutMs),
      }),
      this.timeoutMs,
      "Hacker News API 요청",
    );
    if (!response.ok) {
      const errorBody = (await response
        .json()
        .catch(() => ({}))) as HackerNewsErrorBody;
      const message = errorBody.message ?? errorBody.error ?? response.statusText;
      throw new HackerNewsApiError(
        buildApiErrorMessage(response.status, message),
        response.status,
      );
    }
    return (await response.json()) as T;
  }
}
