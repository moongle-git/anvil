import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { GoogleGenAI } from "@google/genai";
import {
  DEFAULT_GEMINI_MODEL,
  GeminiService,
} from "./gemini.js";

const TestSchema = z.object({
  title: z.string(),
  score: z.number(),
});

interface FakeClient {
  client: GoogleGenAI;
  generateContent: ReturnType<typeof vi.fn>;
}

function fakeClient(...texts: (string | undefined)[]): FakeClient {
  const generateContent = vi.fn();
  for (const text of texts) {
    generateContent.mockResolvedValueOnce({ text });
  }
  return {
    client: { models: { generateContent } } as unknown as GoogleGenAI,
    generateContent,
  };
}

function service(client: GoogleGenAI, maxRetries = 3): GeminiService {
  return new GeminiService({ apiKey: "test-key", maxRetries }, client);
}

const VALID_JSON = JSON.stringify({ title: "아이디어", score: 42 });

describe("GeminiService.generateStructured (구조화 출력 모드)", () => {
  it("정상 응답을 zod 스키마로 검증해 반환한다", async () => {
    const { client, generateContent } = fakeClient(VALID_JSON);

    const result = await service(client).generateStructured({
      systemInstruction: "system",
      prompt: "prompt",
      schema: TestSchema,
    });

    expect(result).toEqual({ title: "아이디어", score: 42 });
    expect(generateContent).toHaveBeenCalledTimes(1);
  });

  it("기본 모델과 JSON 구조화 출력 설정으로 요청한다", async () => {
    const { client, generateContent } = fakeClient(VALID_JSON);

    await service(client).generateStructured({
      systemInstruction: "system",
      prompt: "prompt",
      schema: TestSchema,
    });

    const request = generateContent.mock.calls[0][0];
    expect(request.model).toBe(DEFAULT_GEMINI_MODEL);
    expect(request.config.systemInstruction).toBe("system");
    expect(request.config.responseMimeType).toBe("application/json");
    expect(request.config.responseJsonSchema).toBeDefined();
    expect(request.config.tools).toBeUndefined();
  });

  it("options.model을 지정하면 해당 모델로 요청한다", async () => {
    const { client, generateContent } = fakeClient(VALID_JSON);

    await new GeminiService(
      { apiKey: "test-key", model: "gemini-custom" },
      client,
    ).generateStructured({
      systemInstruction: "system",
      prompt: "prompt",
      schema: TestSchema,
    });

    expect(generateContent.mock.calls[0][0].model).toBe("gemini-custom");
  });

  it("1회 검증 실패 시 에러 피드백을 담아 재요청하고 교정 응답을 반환한다", async () => {
    const invalid = JSON.stringify({ title: "아이디어", score: "높음" });
    const { client, generateContent } = fakeClient(invalid, VALID_JSON);

    const result = await service(client).generateStructured({
      systemInstruction: "system",
      prompt: "원본 프롬프트",
      schema: TestSchema,
    });

    expect(result).toEqual({ title: "아이디어", score: 42 });
    expect(generateContent).toHaveBeenCalledTimes(2);

    const retryContents = generateContent.mock.calls[1][0].contents as string;
    expect(retryContents).toContain("원본 프롬프트");
    // zod 에러 메시지(실패한 필드)가 교정 프롬프트에 포함되어야 한다
    expect(retryContents).toContain("score");
  });

  it("JSON 파싱 실패도 재시도 대상이다", async () => {
    const { client, generateContent } = fakeClient("이것은 JSON이 아님", VALID_JSON);

    const result = await service(client).generateStructured({
      systemInstruction: "system",
      prompt: "prompt",
      schema: TestSchema,
    });

    expect(result).toEqual({ title: "아이디어", score: 42 });
    expect(generateContent).toHaveBeenCalledTimes(2);
  });

  it("maxRetries 소진 시 마지막 에러를 담아 예외를 던진다", async () => {
    const { client, generateContent } = fakeClient(
      "invalid-1",
      "invalid-2",
      "invalid-3",
    );

    await expect(
      service(client, 3).generateStructured({
        systemInstruction: "system",
        prompt: "prompt",
        schema: TestSchema,
      }),
    ).rejects.toThrow(/3/);
    expect(generateContent).toHaveBeenCalledTimes(3);
  });

  it("응답 텍스트가 비어 있으면 재시도 대상이다", async () => {
    const { client, generateContent } = fakeClient(undefined, VALID_JSON);

    const result = await service(client).generateStructured({
      systemInstruction: "system",
      prompt: "prompt",
      schema: TestSchema,
    });

    expect(result).toEqual({ title: "아이디어", score: 42 });
    expect(generateContent).toHaveBeenCalledTimes(2);
  });

  it("선택 필드를 null로 채운 응답도 (키 생략처럼) 검증을 통과한다", async () => {
    // 실제 grounding 모델은 값 없는 선택 필드를 키 생략이 아니라 null로 내보낸다.
    // .optional()은 null을 거부하므로, 검증 경계에서 null을 '키 부재'로 정규화해야 한다.
    const schema = z.object({
      name: z.string(),
      url: z.url().optional(),
      items: z.array(z.object({ label: z.string(), note: z.string().optional() })),
    });
    const body = JSON.stringify({
      name: "서비스",
      url: null, // ← 실측된 실패 형태 (competitors[].url === null)
      items: [{ label: "a", note: null }],
    });
    const { client } = fakeClient(body);

    const result = await service(client).generateStructured({
      systemInstruction: "system",
      prompt: "prompt",
      schema,
    });

    // null 키는 제거되어 undefined(=선택 부재)로 남는다
    expect(result).toEqual({ name: "서비스", items: [{ label: "a" }] });
  });

  it("응답이 timeoutMs 내에 오지 않으면 시간 초과 에러로 실패한다 (hang 방지)", async () => {
    // 영원히 resolve/reject하지 않는 응답 — 실제 네트워크 hang을 재현한다
    const generateContent = vi.fn().mockReturnValue(new Promise(() => undefined));
    const client = {
      models: { generateContent },
    } as unknown as GoogleGenAI;

    const timed = new GeminiService(
      { apiKey: "test-key", timeoutMs: 20 },
      client,
    );

    await expect(
      timed.generateStructured({
        systemInstruction: "system",
        prompt: "prompt",
        schema: TestSchema,
      }),
    ).rejects.toThrow(/시간 초과/);
  });
});

describe("GeminiService.generateStructured (grounding 모드)", () => {
  it("Google Search tool을 활성화하고 responseSchema는 사용하지 않는다", async () => {
    const { client, generateContent } = fakeClient(VALID_JSON);

    await service(client).generateStructured({
      systemInstruction: "system",
      prompt: "prompt",
      schema: TestSchema,
      useGrounding: true,
    });

    const request = generateContent.mock.calls[0][0];
    expect(request.config.tools).toEqual([{ googleSearch: {} }]);
    expect(request.config.responseMimeType).toBeUndefined();
    expect(request.config.responseJsonSchema).toBeUndefined();
    // 자유 텍스트 응답이므로 JSON만 출력하라는 지시를 프롬프트에 포함한다
    expect(request.contents).toContain("JSON");
  });

  it("```json 펜스로 감싼 응답에서 JSON을 추출해 검증한다", async () => {
    const fenced = `검색 결과를 반영했습니다.\n\`\`\`json\n${VALID_JSON}\n\`\`\`\n이상입니다.`;
    const { client } = fakeClient(fenced);

    const result = await service(client).generateStructured({
      systemInstruction: "system",
      prompt: "prompt",
      schema: TestSchema,
      useGrounding: true,
    });

    expect(result).toEqual({ title: "아이디어", score: 42 });
  });

  it("config에 abortSignal을 실어 요청을 취소 가능하게 한다", async () => {
    const { client, generateContent } = fakeClient(VALID_JSON);

    await service(client).generateStructured({
      systemInstruction: "system",
      prompt: "prompt",
      schema: TestSchema,
      useGrounding: true,
    });

    expect(generateContent.mock.calls[0][0].config.abortSignal).toBeInstanceOf(
      AbortSignal,
    );
  });

  it("펜스 없이 텍스트에 섞인 JSON도 중괄호 매칭으로 추출한다", async () => {
    const mixed = `설명 텍스트 앞부분 ${VALID_JSON} 뒤에 붙은 설명`;
    const { client } = fakeClient(mixed);

    const result = await service(client).generateStructured({
      systemInstruction: "system",
      prompt: "prompt",
      schema: TestSchema,
      useGrounding: true,
    });

    expect(result).toEqual({ title: "아이디어", score: 42 });
  });

  it("JSON을 찾을 수 없는 응답은 재시도하고, 교정 응답을 반환한다", async () => {
    const { client, generateContent } = fakeClient(
      "JSON 없이 설명만 있는 응답",
      `\`\`\`json\n${VALID_JSON}\n\`\`\``,
    );

    const result = await service(client).generateStructured({
      systemInstruction: "system",
      prompt: "prompt",
      schema: TestSchema,
      useGrounding: true,
    });

    expect(result).toEqual({ title: "아이디어", score: 42 });
    expect(generateContent).toHaveBeenCalledTimes(2);
  });
});
