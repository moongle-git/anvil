import { GoogleGenAI } from "@google/genai";
import { z, type ZodType } from "zod";
import { withTimeout } from "./withTimeout.js";

export const DEFAULT_GEMINI_MODEL = "gemini-2.5-flash";
const DEFAULT_MAX_RETRIES = 3;
// grounding은 검색 왕복 때문에 정상 응답도 50~90초가 걸린다(실측 52초). 정상 호출을
// 오탐하지 않도록 2분으로 넉넉히 잡되, 무한 hang(수 분~영구)은 반드시 끊는다.
const DEFAULT_TIMEOUT_MS = 120_000;

export interface GeminiServiceOptions {
  apiKey: string;
  model?: string;
  maxRetries?: number;
  timeoutMs?: number;
}

export interface GenerateStructuredParams<T> {
  systemInstruction: string;
  prompt: string;
  schema: ZodType<T>;
  useGrounding?: boolean;
}

const JSON_ONLY_INSTRUCTION =
  "응답은 다른 설명 없이 요구된 구조의 JSON만 출력하라.";

/**
 * LLM은 값이 없는 선택(optional) 필드를 키 생략이 아니라 명시적 null로 내보낸다
 * (예: grounding 응답의 competitors[].url === null). zod의 .optional()은 null을
 * 거부하므로 검증이 결정론적으로 실패한다. null 값을 가진 객체 프로퍼티를 제거해
 * '키 부재(undefined)'로 정규화하면 .optional()과 호환된다. 배열 요소는 그대로 두어
 * (스키마가 기대하는) 실제 데이터 오류는 검증에서 드러나게 한다.
 */
function stripNullProps(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(stripNullProps);
  }
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(value)) {
      if (v === null) {
        continue;
      }
      out[key] = stripNullProps(v);
    }
    return out;
  }
  return value;
}

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
  private readonly timeoutMs: number;

  constructor(options: GeminiServiceOptions, client?: GoogleGenAI) {
    this.client = client ?? new GoogleGenAI({ apiKey: options.apiKey });
    this.model = options.model ?? DEFAULT_GEMINI_MODEL;
    this.maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  async generateStructured<T>(params: GenerateStructuredParams<T>): Promise<T> {
    const { systemInstruction, prompt, schema, useGrounding = false } = params;

    // grounding과 responseSchema는 동시 사용 불가 — grounding 시 자유 텍스트로
    // 받고 JSON을 추출하며, 아니면 SDK 구조화 출력을 사용한다
    const baseConfig = useGrounding
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

      // abortSignal로 실제 HTTP 요청을 취소하고, withTimeout으로 SDK가 signal을
      // 무시하더라도 반드시 시간 상한 안에서 promise가 정착하도록 이중으로 막는다
      const response = await withTimeout(
        this.client.models.generateContent({
          model: this.model,
          contents,
          config: { ...baseConfig, abortSignal: AbortSignal.timeout(this.timeoutMs) },
        }),
        this.timeoutMs,
        "Gemini 호출",
      );

      const text = response.text;
      if (text === undefined || text.trim() === "") {
        lastError = "응답 텍스트가 비어 있다";
        continue;
      }

      try {
        const parsed: unknown = JSON.parse(
          useGrounding ? extractJsonText(text) : text,
        );
        // LLM이 선택 필드에 넣는 null을 '키 부재'로 정규화한 뒤 검증한다
        const result = schema.safeParse(stripNullProps(parsed));
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
