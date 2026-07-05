import type { GeminiService } from "../services/gemini.js";
import type {
  YoutubeComment,
  YoutubeService,
  YoutubeVideo,
} from "../services/youtube.js";
import { MarketContextSchema, type MarketContext } from "../types/index.js";

export const CONTEXT_HUNTER_SYSTEM_PROMPT = `당신은 신규 서비스 아이디어의 시장 맥락을 수집·정제하는 리서치 애널리스트다.
웹검색으로 최신 트렌드와 유사/경쟁 서비스를 조사하고, 제공된 YouTube 댓글에서 타겟 유저의 실제 목소리를 선별한다.
YouTube 댓글은 요약하지 말고 원문을 그대로 선별·인용하라. 근거 없는 추측 대신 검색·댓글에서 확인된 사실만 담아라.`;

export const CONTEXT_HUNTER_PROMPT_TEMPLATE = `## 아이디어 원문
{idea}

## YouTube 수집 결과
{youtubeSection}

## 지시사항
1. 웹검색(Google Search)으로 이 아이디어와 관련된 최신 트렌드, 유사/경쟁 서비스(이름·설명·URL·가격 힌트)를 조사하라.
2. 위 YouTube 수집 결과에서 노이즈(광고, 인사말, 무관한 잡담)를 제거하고, 아이디어의 페인포인트와 관련된 유의미한 유저 목소리만 선별하라. comment 필드에는 수집된 댓글 원문을 요약하지 말고 그대로 인용하라.
3. 트렌드·경쟁 서비스·유저 목소리에서 드러나는 실제 페인포인트 근거를 정리하라.

## 출력 형식
아래 구조의 JSON만 출력하라:
{
  "ideaTitle": "아이디어를 요약한 제목 (string)",
  "trends": ["최신 시장 트렌드 (string 배열)"],
  "competitors": [{ "name": "서비스명", "description": "설명", "url": "URL (선택)", "pricingHint": "가격 힌트 (선택)" }],
  "youtubeVoices": [{ "videoTitle": "영상 제목", "videoUrl": "영상 URL", "comment": "댓글 원문 그대로", "authorName": "작성자 (선택)", "likeCount": 좋아요수 (선택) }],
  "painPointEvidence": ["실제 페인포인트 근거 (string 배열)"],
  "sources": ["참고한 출처 URL 또는 설명 (string 배열)"]
}
youtubeVoices는 위 YouTube 수집 결과에 실제로 존재하는 영상·댓글만 사용하라.`;

export const YOUTUBE_EMPTY_SECTION =
  "(YouTube 데이터를 수집하지 못했다. youtubeVoices는 빈 배열로 출력하고, 웹검색만으로 조사하라.)";

export interface ContextHunterDeps {
  gemini: GeminiService;
  youtube: YoutubeService;
}

function formatYoutubeSection(
  voices: { video: YoutubeVideo; comments: YoutubeComment[] }[],
): string {
  if (voices.length === 0) {
    return YOUTUBE_EMPTY_SECTION;
  }
  return voices
    .map(({ video, comments }) => {
      const commentLines =
        comments.length === 0
          ? ["- (댓글 없음)"]
          : comments.map(
              (c) => `- (좋아요 ${c.likeCount}, ${c.authorName}) ${c.text}`,
            );
      return [
        `### ${video.title}`,
        `- URL: ${video.url}`,
        `- 댓글 원문:`,
        ...commentLines,
      ].join("\n");
    })
    .join("\n\n");
}

export async function runContextHunter(
  deps: ContextHunterDeps,
  idea: string,
): Promise<MarketContext> {
  let voices: { video: YoutubeVideo; comments: YoutubeComment[] }[] = [];
  try {
    voices = await deps.youtube.collectVoices(idea);
  } catch (error) {
    // YouTube 실패(quota 초과 등)는 파이프라인을 멈추지 않는다 — 웹검색만으로 진행
    const message = error instanceof Error ? error.message : String(error);
    console.warn(
      `[context-hunter] YouTube 수집 실패 — 웹검색만으로 진행한다: ${message}`,
    );
  }

  const prompt = CONTEXT_HUNTER_PROMPT_TEMPLATE.replace("{idea}", idea).replace(
    "{youtubeSection}",
    formatYoutubeSection(voices),
  );

  return deps.gemini.generateStructured({
    systemInstruction: CONTEXT_HUNTER_SYSTEM_PROMPT,
    prompt,
    schema: MarketContextSchema,
    useGrounding: true,
  });
}
