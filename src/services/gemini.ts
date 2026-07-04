import { GoogleGenAI } from "@google/genai";
import { z, type ZodType } from "zod";

export const DEFAULT_GEMINI_MODEL = "gemini-2.5-flash";
const DEFAULT_MAX_RETRIES = 3;

export interface GeminiServiceOptions {
  apiKey: string;
  model?: string;
  maxRetries?: number;
}

export interface GenerateStructuredParams<T> {
  systemInstruction: string;
  prompt: string;
  schema: ZodType<T>;
  useGrounding?: boolean;
}

const JSON_ONLY_INSTRUCTION =
  "응답은 다른 설명 없이 요구된 구조의 JSON만 출력하라.";

function extractJsonText(text: string): string {
  const fenced = /```(?:json)?\s*\n?([\s\S]*?)```/.exec(text);
  if (fenced) {
    return fenced[1].trim();
  }
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start !== -1 && end > start) {
    return text.slice(start, end + 1);
  }
  throw new Error("응답에서 JSON 블록을 찾을 수 없다");
}

export class GeminiService {
  private readonly client: GoogleGenAI;
  private readonly model: string;
  private readonly maxRetries: number;

  constructor(options: GeminiServiceOptions, client?: GoogleGenAI) {
    this.client = client ?? new GoogleGenAI({ apiKey: options.apiKey });
    this.model = options.model ?? DEFAULT_GEMINI_MODEL;
    this.maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
  }

  async generateStructured<T>(params: GenerateStructuredParams<T>): Promise<T> {
    const { systemInstruction, prompt, schema, useGrounding = false } = params;

    // grounding과 responseSchema는 동시 사용 불가 — grounding 시 자유 텍스트로
    // 받고 JSON을 추출하며, 아니면 SDK 구조화 출력을 사용한다
    const config = useGrounding
      ? { systemInstruction, tools: [{ googleSearch: {} }] }
      : {
          systemInstruction,
          responseMimeType: "application/json",
          responseJsonSchema: z.toJSONSchema(schema),
        };

    const basePrompt = useGrounding
      ? `${prompt}\n\n${JSON_ONLY_INSTRUCTION}`
      : prompt;

    let lastError = "";
    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      const contents =
        attempt === 1
          ? basePrompt
          : `${basePrompt}\n\n[교정 요청] 직전 응답이 검증에 실패했다. 아래 에러를 해결한 JSON을 다시 출력하라.\n${lastError}`;

      const response = await this.client.models.generateContent({
        model: this.model,
        contents,
        config,
      });

      const text = response.text;
      if (text === undefined || text.trim() === "") {
        lastError = "응답 텍스트가 비어 있다";
        continue;
      }

      try {
        const parsed: unknown = JSON.parse(
          useGrounding ? extractJsonText(text) : text,
        );
        const result = schema.safeParse(parsed);
        if (result.success) {
          return result.data;
        }
        lastError = z.prettifyError(result.error);
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
      }
    }

    throw new Error(
      `Gemini 구조화 출력이 ${this.maxRetries}회 시도 후에도 검증에 실패했다: ${lastError}`,
    );
  }
}
