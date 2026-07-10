import { describe, expect, it } from "vitest";
import {
  InterviewAnswersSchema,
  InterviewQuestionsSchema,
} from "./interview.js";

describe("InterviewQuestionsSchema", () => {
  const validQuestion = {
    id: "q1",
    question: "핵심 타깃 사용자는 초보 식집사인가, 전문 원예가인가?",
    why: "타깃에 따라 UX 복잡도와 가격 민감도가 크게 달라진다.",
  };

  it("유효한 질문 목록을 허용한다", () => {
    const result = InterviewQuestionsSchema.safeParse({
      questions: [validQuestion],
    });
    expect(result.success).toBe(true);
  });

  it("빈 questions 배열을 허용한다 (모호하지 않음 = 질문 없음)", () => {
    expect(
      InterviewQuestionsSchema.safeParse({ questions: [] }).success,
    ).toBe(true);
  });

  it("why 없이도 허용한다 (옵셔널)", () => {
    const { why, ...withoutWhy } = validQuestion;
    void why;
    const result = InterviewQuestionsSchema.safeParse({
      questions: [withoutWhy],
    });
    expect(result.success).toBe(true);
  });

  it("질문이 5개를 초과하면 거부한다", () => {
    const many = Array.from({ length: 6 }, (_, i) => ({
      id: `q${i}`,
      question: `질문 ${i}`,
    }));
    expect(InterviewQuestionsSchema.safeParse({ questions: many }).success).toBe(
      false,
    );
  });

  it("빈 id 또는 빈 question을 거부한다", () => {
    expect(
      InterviewQuestionsSchema.safeParse({
        questions: [{ id: "", question: "내용" }],
      }).success,
    ).toBe(false);
    expect(
      InterviewQuestionsSchema.safeParse({
        questions: [{ id: "q1", question: "" }],
      }).success,
    ).toBe(false);
  });
});

describe("InterviewAnswersSchema", () => {
  it("유효한 답변 목록을 허용한다", () => {
    const result = InterviewAnswersSchema.safeParse({
      answers: [{ questionId: "q1", answer: "초보 식집사가 핵심 타깃이다." }],
    });
    expect(result.success).toBe(true);
  });

  it("빈 answer 문자열을 허용한다 (해당 질문 스킵)", () => {
    const result = InterviewAnswersSchema.safeParse({
      answers: [{ questionId: "q1", answer: "" }],
    });
    expect(result.success).toBe(true);
  });

  it("빈 answers 배열을 허용한다 (전체 스킵)", () => {
    expect(InterviewAnswersSchema.safeParse({ answers: [] }).success).toBe(true);
  });

  it("questionId가 빠지면 거부한다", () => {
    const result = InterviewAnswersSchema.safeParse({
      answers: [{ answer: "답변만 있음" }],
    });
    expect(result.success).toBe(false);
  });
});
