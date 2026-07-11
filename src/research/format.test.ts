import { describe, expect, it } from "vitest";
import {
  RESEARCH_SOURCE_IDS,
  SOURCE_LABELS,
  type CommunityVoice,
} from "../types/index.js";
import { EVIDENCE_EMPTY_SECTION, formatEvidenceSection } from "./format.js";
import type { CollectedEvidence } from "./types.js";

const YOUTUBE_VOICE: CommunityVoice = {
  source: "youtube",
  title: "식물 키우기 실패담",
  url: "https://www.youtube.com/watch?v=abc",
  text: "물주기 타이밍을 늘 놓쳐서 결국 죽였어요",
  authorName: "초보집사",
  score: 42,
};

const HN_VOICE: CommunityVoice = {
  source: "hackernews",
  title: "Show HN: Plant care assistant",
  url: "https://news.ycombinator.com/item?id=42",
  text: "Reminder apps don't work because the plant dies before the reminder fires.",
  authorName: "pg",
};

const NAVER_VOICE: CommunityVoice = {
  source: "naver",
  title: "식물 키우기 실패 후기",
  url: "https://cafe.naver.com/plant/1",
  text: "물주기를 놓쳐서 결국 시들었어요... 다들 어떻게",
  authorName: "식물카페",
  extra: "검색 스니펫",
};

function evidence(partial: Partial<CollectedEvidence>): CollectedEvidence {
  return { voices: [], failures: [], ...partial };
}

describe("formatEvidenceSection", () => {
  it("소스별로 그룹핑하고 제목을 SOURCE_LABELS에서 가져온다", () => {
    const section = formatEvidenceSection(
      evidence({ voices: [YOUTUBE_VOICE, HN_VOICE, NAVER_VOICE] }),
    );

    for (const id of RESEARCH_SOURCE_IDS) {
      expect(section).toContain(SOURCE_LABELS[id]);
    }
    // 목소리는 자기 소스 그룹 아래에 놓인다
    const ytIndex = section.indexOf(SOURCE_LABELS.youtube);
    const hnIndex = section.indexOf(SOURCE_LABELS.hackernews);
    expect(section.indexOf(YOUTUBE_VOICE.text)).toBeGreaterThan(ytIndex);
    expect(section.indexOf(YOUTUBE_VOICE.text)).toBeLessThan(hnIndex);
    expect(section.indexOf(HN_VOICE.text)).toBeGreaterThan(hnIndex);
  });

  it("목소리 원문을 자르지 않고 축자로 싣는다", () => {
    const long = "가".repeat(1200);
    const section = formatEvidenceSection(
      evidence({ voices: [{ ...YOUTUBE_VOICE, text: long }] }),
    );

    expect(section).toContain(long);
  });

  it("출처 제목·URL·작성자·인기도·부가표시를 함께 싣는다", () => {
    const section = formatEvidenceSection(
      evidence({ voices: [YOUTUBE_VOICE, NAVER_VOICE] }),
    );

    expect(section).toContain(YOUTUBE_VOICE.title);
    expect(section).toContain(YOUTUBE_VOICE.url);
    expect(section).toContain("초보집사");
    expect(section).toContain("42");
    // 네이버 스니펫은 완결된 원문이 아니라는 표시가 프롬프트까지 따라가야 한다
    expect(section).toContain("검색 스니펫");
  });

  it("★ 수집 0건인 소스도 0건으로 명시한다 (조용한 0건이 눈에 보여야 한다)", () => {
    const section = formatEvidenceSection(evidence({ voices: [YOUTUBE_VOICE] }));

    expect(section).toContain(`${SOURCE_LABELS.hackernews} — 0건`);
    expect(section).toContain(`${SOURCE_LABELS.naver} — 0건`);
    expect(section).toContain(`${SOURCE_LABELS.youtube} — 1건`);
  });

  it("★ 실패한 소스의 에러 메시지를 섹션에 명기한다", () => {
    const message = "네이버 API 일일 호출 한도(25,000)를 초과했다";
    const section = formatEvidenceSection(
      evidence({
        voices: [YOUTUBE_VOICE],
        failures: [{ source: "naver", message }],
      }),
    );

    expect(section).toContain("수집 실패");
    expect(section).toContain(SOURCE_LABELS.naver);
    expect(section).toContain(message);
  });

  it("수집도 0건이고 실패도 없으면 빈 섹션 안내를 반환한다", () => {
    expect(formatEvidenceSection(evidence({}))).toBe(EVIDENCE_EMPTY_SECTION);
  });

  it("수집은 0건이지만 실패가 있으면 빈 섹션이 아니라 실패 사실을 싣는다", () => {
    const section = formatEvidenceSection(
      evidence({ failures: [{ source: "youtube", message: "quota 초과" }] }),
    );

    expect(section).not.toBe(EVIDENCE_EMPTY_SECTION);
    expect(section).toContain("quota 초과");
  });
});

describe("EVIDENCE_EMPTY_SECTION", () => {
  it("communityVoices를 빈 배열로 두고 웹검색만으로 조사하라고 지시한다", () => {
    expect(EVIDENCE_EMPTY_SECTION).toContain("communityVoices");
    expect(EVIDENCE_EMPTY_SECTION).toContain("빈 배열");
    expect(EVIDENCE_EMPTY_SECTION).toContain("웹검색");
  });
});
