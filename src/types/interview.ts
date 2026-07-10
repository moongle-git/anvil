import { z } from "zod";

export const InterviewQuestionSchema = z.object({
  id: z.string().min(1),
  question: z.string().min(1),
  why: z.string().optional(),
});
export type InterviewQuestion = z.infer<typeof InterviewQuestionSchema>;

/** 아이디어가 명확하면 questions는 빈 배열(질문 없음)이 될 수 있다 */
export const InterviewQuestionsSchema = z.object({
  questions: z.array(InterviewQuestionSchema).max(5),
});
export type InterviewQuestions = z.infer<typeof InterviewQuestionsSchema>;

export const InterviewAnswerSchema = z.object({
  questionId: z.string().min(1),
  // 빈 문자열 허용 = 사용자가 해당 질문을 건너뜀
  answer: z.string(),
});
export type InterviewAnswer = z.infer<typeof InterviewAnswerSchema>;

/** answers가 빈 배열이면 전체 스킵으로 간주한다 */
export const InterviewAnswersSchema = z.object({
  answers: z.array(InterviewAnswerSchema),
});
export type InterviewAnswers = z.infer<typeof InterviewAnswersSchema>;
