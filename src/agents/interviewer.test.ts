import { describe, expect, it, vi } from "vitest";
import type { GeminiService } from "../services/gemini.js";
import {
  InterviewQuestionsSchema,
  type InterviewQuestions,
} from "../types/index.js";
import { runInterviewer, type InterviewerDeps } from "./interviewer.js";

const IDEA = "AI로 사람들을 도와주는 앱";

const QUESTIONS: InterviewQuestions = {
  questions: [
    {
      id: "q1",
      question: "핵심 타깃 사용자는 누구인가?",
      why: "타깃에 따라 검증 방향이 달라진다.",
    },
    {
      id: "q2",
      question: "어떤 문제를 해결하는가?",
      why: "페인포인트가 명확해야 수요를 검증할 수 있다.",
    },
  ],
};

interface FakeDeps {
  deps: InterviewerDeps;
  generateStructured: ReturnType<typeof vi.fn>;
}

function fakeDeps(
  result: InterviewQuestions = QUESTIONS,
): FakeDeps {
  const generateStructured = vi.fn().mockResolvedValue(result);
  return {
    deps: { gemini: { generateStructured } as unknown as GeminiService },
    generateStructured,
  };
}

describe("runInterviewer", () => {
  it("grounding 없이 InterviewQuestions 스키마로 Gemini를 호출하고 결과를 반환한다", async () => {
    const { deps, generateStructured } = fakeDeps();

    const result = await runInterviewer(deps, IDEA);

    expect(result).toEqual(QUESTIONS);
    expect(InterviewQuestionsSchema.safeParse(result).success).toBe(true);

    expect(generateStructured).toHaveBeenCalledTimes(1);
    const params = generateStructured.mock.calls[0][0];
    expect(params.useGrounding).toBe(false);
    expect(params.schema).toBe(InterviewQuestionsSchema);
  });

  it("시스템 프롬프트에 '명확하면 빈 배열'과 '최대 5개' 규칙이 포함된다", async () => {
    const { deps, generateStructured } = fakeDeps();

    await runInterviewer(deps, IDEA);

    const system = generateStructured.mock.calls[0][0]
      .systemInstruction as string;

    expect(system).toContain("빈 배열");
    expect(system).toContain("최대 5개");
  });

  it("유저 프롬프트에 아이디어 원문이 포함된다", async () => {
    const { deps, generateStructured } = fakeDeps();

    await runInterviewer(deps, IDEA);

    const prompt = generateStructured.mock.calls[0][0].prompt as string;
    expect(prompt).toContain(IDEA);
  });

  it("모호하지 않으면 빈 질문 목록을 그대로 반환한다", async () => {
    const { deps } = fakeDeps({ questions: [] });

    const result = await runInterviewer(deps, "명확한 아이디어");

    expect(result.questions).toEqual([]);
  });
});
