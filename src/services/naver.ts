import { stripHtml } from "../lib/html.js";
import { withTimeout } from "./withTimeout.js";

const NAVER_API_BASE = "https://openapi.naver.com/v1/search";
/**
 * 신호 품질 순이다:
 * 카페글(실제 커뮤니티의 불만·후기) > 지식iN(질문 자체가 페인포인트다) > 블로그(SEO 스팸이 섞이지만 진짜 후기도 있다).
 */
const DEFAULT_CORPORA: readonly NaverCorpus[] = ["cafearticle", "kin", "blog"];
/** corpus당 상한. 3 corpus × 5 = 최대 15건 — 프롬프트 토큰 방어다 */
const DEFAULT_DISPLAY = 5;
// 네이버 검색은 보통 1초 내 응답한다 — hang을 끊기 위한 상한
const DEFAULT_TIMEOUT_MS = 15_000;

/** 네이버 문서상 인증 실패 / 호출 한도 초과 코드. 실제 응답이 다를 수 있어 status 폴백과 병용한다 */
const AUTH_ERROR_CODE = "024";
const QUOTA_ERROR_CODE = "012";

export type NaverCorpus = "blog" | "cafearticle" | "kin";

export interface NaverPost {
  corpus: NaverCorpus;
  /** stripHtml을 통과한 평문 — 검색어가 <b> 하이라이트로 감싸여 온다 */
  title: string;
  link: string;
  /**
   * ★ 게시글 본문이 아니라 ~200자 검색 스니펫이다 (말줄임이 포함된다).
   * 완결된 원문 인용으로 다루면 리포트가 거짓말을 한다 — 인용 시 스니펫임을 밝혀야 한다.
   * 본문 전문 수집은 스크래핑이 필요하고 카페는 로그인 월이 있어 이번 phase의 범위 밖이다.
   */
  description: string;
  /** blog: bloggername / cafearticle: cafename / kin: 없음 */
  authorName?: string;
  /** blog의 postdate (YYYYMMDD). 다른 corpus는 제공하지 않는다 */
  postedAt?: string;
}

export interface NaverServiceOptions {
  clientId: string;
  clientSecret: string;
  corpora?: readonly NaverCorpus[];
  display?: number;
  fetchFn?: typeof fetch;
  timeoutMs?: number;
}

export class NaverApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly errorCode?: string,
  ) {
    super(message);
    this.name = "NaverApiError";
  }
}

interface NaverErrorBody {
  errorMessage?: string;
  errorCode?: string;
}

interface SearchBody {
  items?: {
    title?: string;
    link?: string;
    description?: string;
    bloggername?: string;
    cafename?: string;
    postdate?: string;
  }[];
}

function buildApiErrorMessage(
  status: number,
  message: string,
  errorCode?: string,
): string {
  if (status === 401 || errorCode === AUTH_ERROR_CODE) {
    return `네이버 API 인증에 실패했다 (NAVER_CLIENT_ID/NAVER_CLIENT_SECRET을 확인하라): ${message}`;
  }
  if (status === 429 || errorCode === QUOTA_ERROR_CODE) {
    return `네이버 API 일일 호출 한도(25,000)를 초과했다: ${message}`;
  }
  // errorCode가 문서와 달라도 status로 원인을 좁힐 수 있어야 한다
  return `네이버 검색 API 요청이 실패했다 (HTTP ${status}${errorCode ? `, ${errorCode}` : ""}): ${message}`;
}

export class NaverService {
  private readonly clientId: string;
  private readonly clientSecret: string;
  private readonly corpora: readonly NaverCorpus[];
  private readonly display: number;
  private readonly fetchFn: typeof fetch;
  private readonly timeoutMs: number;

  constructor(options: NaverServiceOptions) {
    this.clientId = options.clientId;
    this.clientSecret = options.clientSecret;
    this.corpora = options.corpora ?? DEFAULT_CORPORA;
    this.display = options.display ?? DEFAULT_DISPLAY;
    this.fetchFn = options.fetchFn ?? globalThis.fetch;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  async search(corpus: NaverCorpus, query: string): Promise<NaverPost[]> {
    const body = await this.request<SearchBody>(corpus, {
      query,
      display: String(this.display),
      sort: "sim",
    });

    const posts: NaverPost[] = [];
    for (const item of body.items ?? []) {
      const link = item.link;
      // CommunityVoice.url이 z.url()이라 link 없는 item이 새어나가면 스키마 검증이 깨진다
      if (link === undefined || link === "") {
        continue;
      }
      // 검색어가 <b>로 하이라이트돼 오고 엔티티도 섞인다
      const authorName = item.cafename ?? item.bloggername;
      posts.push({
        corpus,
        title: stripHtml(item.title ?? ""),
        link,
        description: stripHtml(item.description ?? ""),
        ...(authorName !== undefined && authorName !== ""
          ? { authorName: stripHtml(authorName) }
          : {}),
        ...(item.postdate !== undefined && item.postdate !== ""
          ? { postedAt: item.postdate }
          : {}),
      });
    }
    return posts.slice(0, this.display);
  }

  /**
   * corpus들을 병렬 수집한다. 일부 corpus가 실패하면 성공한 것만 돌려주되,
   * 전부 실패하면 첫 에러를 던진다 — "검색 결과 0건"과 "네이버가 죽었다"는 다른 사실이고,
   * 후자는 collectAll이 소스 실패로 기록해 프롬프트에 적어야 한다.
   */
  async collect(query: string): Promise<NaverPost[]> {
    const settled = await Promise.allSettled(
      this.corpora.map((corpus) => this.search(corpus, query)),
    );

    const posts: NaverPost[] = [];
    const failures: unknown[] = [];
    for (const result of settled) {
      if (result.status === "fulfilled") {
        posts.push(...result.value);
      } else {
        failures.push(result.reason);
      }
    }

    if (failures.length > 0 && failures.length === this.corpora.length) {
      throw failures[0];
    }
    return posts;
  }

  private async request<T>(
    corpus: NaverCorpus,
    params: Record<string, string>,
  ): Promise<T> {
    const url = new URL(`${NAVER_API_BASE}/${corpus}.json`);
    for (const [name, value] of Object.entries(params)) {
      url.searchParams.set(name, value);
    }

    // ★ 네이버는 자격증명을 쿼리 파라미터가 아니라 헤더로만 받는다 (YoutubeService와의 결정적 차이)
    const headers = {
      "X-Naver-Client-Id": this.clientId,
      "X-Naver-Client-Secret": this.clientSecret,
    };

    // hang을 끊는다: abortSignal로 요청을 취소하고 withTimeout으로 상한을 강제한다
    const response = await withTimeout(
      this.fetchFn(url.toString(), {
        headers,
        signal: AbortSignal.timeout(this.timeoutMs),
      }),
      this.timeoutMs,
      "네이버 API 요청",
    );
    if (!response.ok) {
      const errorBody = (await response.json().catch(() => ({}))) as NaverErrorBody;
      const message = errorBody.errorMessage ?? response.statusText;
      const errorCode = errorBody.errorCode;
      throw new NaverApiError(
        buildApiErrorMessage(response.status, message, errorCode),
        response.status,
        errorCode,
      );
    }
    return (await response.json()) as T;
  }
}
