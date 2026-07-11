import { describe, expect, it } from "vitest";
import {
  RESEARCH_SOURCE_IDS,
  SOURCE_LABELS,
  type CommunityVoice,
} from "../types/index.js";
import {
  EVIDENCE_EMPTY_SECTION,
  formatEvidenceSection,
  parseVoiceRef,
  voiceRefId,
} from "./format.js";
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

/** formatEvidenceSection은 coverage를 읽지 않는다 — 프롬프트 포맷의 입력은 voices·failures뿐이다 */
function evidence(partial: Partial<CollectedEvidence>): CollectedEvidence {
  return { voices: [], failures: [], coverage: [], ...partial };
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

  it("출처 제목·작성자·인기도·부가표시를 함께 싣는다", () => {
    const section = formatEvidenceSection(
      evidence({ voices: [YOUTUBE_VOICE, NAVER_VOICE] }),
    );

    expect(section).toContain(YOUTUBE_VOICE.title);
    expect(section).toContain("초보집사");
    expect(section).toContain("42");
    // 네이버 스니펫은 완결된 원문이 아니라는 표시가 프롬프트까지 따라가야 한다
    expect(section).toContain("검색 스니펫");
  });

  // ADR-013: 모델이 볼 수 없는 URL은 받아적을 수도 없다. 프롬프트에서 URL을 빼는 것이
  // 이 방어의 전부다 — 실제로 모델은 코드가 준 URL을 옮겨적다가 도메인 오타를 냈다.
  it("★ 목소리의 URL을 프롬프트에 싣지 않는다", () => {
    const section = formatEvidenceSection(
      evidence({ voices: [YOUTUBE_VOICE, HN_VOICE, NAVER_VOICE] }),
    );

    for (const voice of [YOUTUBE_VOICE, HN_VOICE, NAVER_VOICE]) {
      expect(section).not.toContain(voice.url);
    }
    expect(section).not.toContain("http");
  });

  it("★ 각 목소리에 [V*] ID를 전역 연번으로 붙인다 (소스별로 리셋하지 않는다)", () => {
    const section = formatEvidenceSection(
      evidence({ voices: [YOUTUBE_VOICE, HN_VOICE, NAVER_VOICE] }),
    );

    // ID는 voices[] 인덱스 기준이다 — 소스별로 리셋하면 runContextHunter가 복원할 수 없다
    expect(section).toContain(`[V1] `);
    expect(section.indexOf("[V1]")).toBeLessThan(
      section.indexOf(YOUTUBE_VOICE.text),
    );
    expect(section.indexOf("[V2]")).toBeLessThan(section.indexOf(HN_VOICE.text));
    expect(section.indexOf("[V3]")).toBeLessThan(
      section.indexOf(NAVER_VOICE.text),
    );
    // HN이 자기 그룹의 첫 항목이지만 V1이 아니다
    expect(section).not.toContain("[V0]");
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
  it("communityVoiceRefs를 빈 배열로 두고 웹검색만으로 조사하라고 지시한다", () => {
    // LLM은 더 이상 목소리 객체를 출력하지 않는다 — 고를 ID가 없으면 빈 배열이다 (ADR-013)
    expect(EVIDENCE_EMPTY_SECTION).toContain("communityVoiceRefs");
    expect(EVIDENCE_EMPTY_SECTION).toContain("빈 배열");
    expect(EVIDENCE_EMPTY_SECTION).toContain("웹검색");
  });
});

// ID 생성과 해석이 한 곳에 있어야 한다 — 문자열 포맷이 두 곳에 중복되면 조용히 어긋난다
describe("voiceRefId ↔ parseVoiceRef", () => {
  it("★ 인덱스 → ID → 인덱스 왕복이 보존된다", () => {
    for (const index of [0, 1, 9, 41, 128]) {
      expect(parseVoiceRef(voiceRefId(index))).toBe(index);
    }
  });

  it("ID는 1-origin이다", () => {
    expect(voiceRefId(0)).toBe("V1");
    expect(parseVoiceRef("V1")).toBe(0);
  });

  it("공백이 섞인 ID는 받아준다 (LLM이 흔히 붙인다)", () => {
    expect(parseVoiceRef(" V2 ")).toBe(1);
  });

  it.each(["Vfoo", "V", "V0", "V01", "1", "", "V1a", "v1"])(
    "형식이 어긋난 %s는 null이다 (추측하지 않고 드롭한다)",
    (ref) => {
      expect(parseVoiceRef(ref)).toBeNull();
    },
  );
});
