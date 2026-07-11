import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { GenerateContentResponse, GoogleGenAI } from "@google/genai";
import {
  DEFAULT_GEMINI_MODEL,
  GeminiService,
  extractCitations,
} from "./gemini.js";

const TestSchema = z.object({
  title: z.string(),
  score: z.number(),
});

interface FakeClient {
  client: GoogleGenAI;
  generateContent: ReturnType<typeof vi.fn>;
}

/** 응답 본문(text)만 주거나, grounding metadata까지 실은 raw 응답을 준다 */
type FakeResponse = string | undefined | { text?: string; candidates?: unknown[] };

function fakeClient(...responses: FakeResponse[]): FakeClient {
  const generateContent = vi.fn();
  for (const response of responses) {
    generateContent.mockResolvedValueOnce(
      typeof response === "object" ? response : { text: response },
    );
  }
  return {
    client: { models: { generateContent } } as unknown as GoogleGenAI,
    generateContent,
  };
}

const SUCCESS = "URL_RETRIEVAL_STATUS_SUCCESS";

/** groundingMetadata/urlContextMetadata를 실은 응답을 만든다 */
function grounded(
  text: string | undefined,
  metadata: {
    chunks?: unknown[];
    queries?: string[];
    urlMetadata?: unknown[];
  },
): { text?: string; candidates: unknown[] } {
  return {
    text,
    candidates: [
      {
        groundingMetadata: {
          groundingChunks: metadata.chunks,
          webSearchQueries: metadata.queries,
        },
        urlContextMetadata: { urlMetadata: metadata.urlMetadata },
      },
    ],
  };
}

function asResponse(candidates?: unknown[]): GenerateContentResponse {
  return { candidates } as unknown as GenerateContentResponse;
}

/** 영원히 resolve/reject하지 않는 응답 — 실제 네트워크 hang을 재현한다 */
function hangingClient(): FakeClient {
  const generateContent = vi.fn().mockReturnValue(new Promise(() => undefined));
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

describe("GeminiService.generateGrounded (grounding 모드)", () => {
  function grounding(client: GoogleGenAI, maxRetries = 2): GeminiService {
    return new GeminiService(
      { apiKey: "test-key", groundedMaxRetries: maxRetries },
      client,
    );
  }

  it("googleSearch·urlContext tool을 활성화하고 responseSchema는 사용하지 않는다", async () => {
    const { client, generateContent } = fakeClient(VALID_JSON);

    await grounding(client).generateGrounded({
      systemInstruction: "system",
      prompt: "prompt",
      schema: TestSchema,
    });

    const request = generateContent.mock.calls[0][0];
    // grounding과 responseJsonSchema는 동시 사용이 불가하다
    expect(request.config.tools).toEqual([
      { googleSearch: {} },
      { urlContext: {} },
    ]);
    expect(request.config.responseMimeType).toBeUndefined();
    expect(request.config.responseJsonSchema).toBeUndefined();
    // 자유 텍스트 응답이므로 JSON만 출력하라는 지시를 프롬프트에 포함한다
    expect(request.contents).toContain("JSON");
  });

  it("useUrlContext: false면 googleSearch tool만 활성화한다", async () => {
    const { client, generateContent } = fakeClient(VALID_JSON);

    await grounding(client).generateGrounded({
      systemInstruction: "system",
      prompt: "prompt",
      schema: TestSchema,
      useUrlContext: false,
    });

    expect(generateContent.mock.calls[0][0].config.tools).toEqual([
      { googleSearch: {} },
    ]);
  });

  it("data·citations·webSearchQueries를 함께 반환한다", async () => {
    const { client } = fakeClient(
      grounded(VALID_JSON, {
        chunks: [{ web: { uri: "https://x.example", title: "T", domain: "x.example" } }],
        queries: ["회의록 요약 서비스"],
      }),
    );

    const result = await grounding(client).generateGrounded({
      systemInstruction: "system",
      prompt: "prompt",
      schema: TestSchema,
    });

    expect(result).toEqual({
      data: { title: "아이디어", score: 42 },
      citations: [
        {
          uri: "https://x.example",
          title: "T",
          domain: "x.example",
          kind: "redirect",
        },
      ],
      webSearchQueries: ["회의록 요약 서비스"],
    });
  });

  it("★ 형식 검증에 실패한 시도의 grounding 인용도 보존된다 (ADR-013)", async () => {
    // 이 테스트는 "실패한 시도의 metadata는 함께 버린다"는 기존 계약을 의도적으로 뒤집은 것이다.
    //
    // 뒤집은 이유: 실측 8개 run 전부에서 citations가 0건이었다. grounding은 responseSchema를
    // 못 써 1차 시도의 JSON 형식 실패가 잦은데, 재시도 프롬프트는 `[교정 요청]`이라 모델이
    // 새로 검색하지 않는다 → 2차 응답에는 groundingMetadata가 아예 없다 → 1차가 실제로 수행한
    // 검색의 인용이 통째로 버려진다. 그 결과 리포트의 유일한 검증된 출처 필드가 늘 비고,
    // LLM이 손으로 타이핑한 환각 URL(sources[])만 남았다. 인용 0건 + 환각 필드 잔존이
    // "본문과 대응하지 않는 인용이 섞일 수 있음"보다 압도적으로 나쁜 실패다.
    //
    // 실패한 것은 JSON 형식이지 검색이 아니다 — 그 시도의 인용은 실재한다. citations는
    // 문장별 각주가 아니라 "이 run의 grounding이 무엇을 가져왔는가"의 run 단위 기록이다.
    //
    // 아래가 실전에서 8/8 run을 망친 바로 그 시나리오다:
    // 1차 = 검색은 했지만(A) JSON 형식 실패 / 2차 = JSON은 정상이나 메타데이터 없음
    const { client, generateContent } = fakeClient(
      grounded("JSON 없이 설명만 있는 응답", {
        chunks: [{ web: { uri: "https://a.example", title: "A" } }],
      }),
      VALID_JSON,
    );

    const result = await grounding(client).generateGrounded({
      systemInstruction: "system",
      prompt: "prompt",
      schema: TestSchema,
    });

    expect(generateContent).toHaveBeenCalledTimes(2);
    // 채택된 2차 응답에는 metadata가 없다. A가 살아남지 못하면 citations는 0건이 된다
    expect(result.citations).toEqual([
      { uri: "https://a.example", title: "A", kind: "redirect" },
    ]);
  });

  it("webSearchQueries도 모든 시도에서 누적하고 dedupe한다", async () => {
    const { client } = fakeClient(
      grounded("형식 실패", { queries: ["회의록 요약", "AI 노트"] }),
      grounded(VALID_JSON, { queries: ["AI 노트", "회의 자동화"] }),
    );

    const { webSearchQueries } = await grounding(client).generateGrounded({
      systemInstruction: "system",
      prompt: "prompt",
      schema: TestSchema,
    });

    expect(webSearchQueries).toEqual(["회의록 요약", "AI 노트", "회의 자동화"]);
  });

  it("```json 펜스로 감싼 응답에서 JSON을 추출해 검증한다", async () => {
    const fenced = `검색 결과를 반영했습니다.\n\`\`\`json\n${VALID_JSON}\n\`\`\`\n이상입니다.`;
    const { client } = fakeClient(fenced);

    const { data } = await grounding(client).generateGrounded({
      systemInstruction: "system",
      prompt: "prompt",
      schema: TestSchema,
    });

    expect(data).toEqual({ title: "아이디어", score: 42 });
  });

  it("펜스 없이 텍스트에 섞인 JSON도 중괄호 매칭으로 추출한다", async () => {
    const { client } = fakeClient(`설명 앞부분 ${VALID_JSON} 뒤에 붙은 설명`);

    const { data } = await grounding(client).generateGrounded({
      systemInstruction: "system",
      prompt: "prompt",
      schema: TestSchema,
    });

    expect(data).toEqual({ title: "아이디어", score: 42 });
  });

  it("config에 abortSignal을 실어 요청을 취소 가능하게 한다", async () => {
    const { client, generateContent } = fakeClient(VALID_JSON);

    await grounding(client).generateGrounded({
      systemInstruction: "system",
      prompt: "prompt",
      schema: TestSchema,
    });

    expect(generateContent.mock.calls[0][0].config.abortSignal).toBeInstanceOf(
      AbortSignal,
    );
  });

  it("groundedMaxRetries(기본 2)를 지키고 소진되면 예외를 던진다", async () => {
    const { client, generateContent } = fakeClient("invalid-1", "invalid-2", VALID_JSON);

    await expect(
      new GeminiService({ apiKey: "test-key" }, client).generateGrounded({
        systemInstruction: "system",
        prompt: "prompt",
        schema: TestSchema,
      }),
    ).rejects.toThrow(/2/);
    // 3번째 응답(성공)까지 가지 않는다 — 최악 2 × 180초 = 6분 상한을 지키기 위한 계약
    expect(generateContent).toHaveBeenCalledTimes(2);
  });

  // 두 경로가 서로의 타임아웃을 쓰면 이 테스트들이 hang한다 (긴 쪽 상한을 기다리게 되므로)
  it("grounding 경로는 groundedTimeoutMs를 쓴다 (timeoutMs가 아니다)", async () => {
    const { client } = hangingClient();
    const svc = new GeminiService(
      {
        apiKey: "test-key",
        groundedTimeoutMs: 20,
        groundedMaxRetries: 1,
        timeoutMs: 120_000,
      },
      client,
    );

    await expect(
      svc.generateGrounded({
        systemInstruction: "system",
        prompt: "prompt",
        schema: TestSchema,
      }),
    ).rejects.toThrow(/시간 초과/);
  });

  it("non-grounding 경로는 여전히 timeoutMs를 쓴다 (groundedTimeoutMs가 아니다)", async () => {
    const { client } = hangingClient();
    const svc = new GeminiService(
      {
        apiKey: "test-key",
        timeoutMs: 20,
        maxRetries: 1,
        groundedTimeoutMs: 180_000,
      },
      client,
    );

    await expect(
      svc.generateStructured({
        systemInstruction: "system",
        prompt: "prompt",
        schema: TestSchema,
      }),
    ).rejects.toThrow(/시간 초과/);
  });
});

describe("extractCitations", () => {
  it("web.uri가 없는 chunk는 버린다 (인용으로 쓸 수 없다)", () => {
    const citations = extractCitations([
      asResponse([
        {
          groundingMetadata: {
            groundingChunks: [
              { web: { uri: "https://a.example" } },
              { web: { title: "uri 없음" } },
              { web: { uri: "" } },
              { retrievedContext: { uri: "https://not-web.example" } },
            ],
          },
        },
      ]),
    ]);

    expect(citations).toEqual([{ uri: "https://a.example", kind: "redirect" }]);
  });

  it("같은 uri가 여러 chunk에 나오면 1개로 dedupe한다", () => {
    const citations = extractCitations([
      asResponse([
        {
          groundingMetadata: {
            groundingChunks: [
              { web: { uri: "https://a.example", title: "첫 조각" } },
              { web: { uri: "https://a.example", title: "둘째 조각" } },
              { web: { uri: "https://b.example" } },
            ],
          },
        },
      ]),
    ]);

    expect(citations).toEqual([
      { uri: "https://a.example", title: "첫 조각", kind: "redirect" },
      { uri: "https://b.example", kind: "redirect" },
    ]);
  });

  it("여러 시도에 걸쳐 같은 uri가 나와도 1개로 dedupe한다 (ADR-013)", () => {
    // 재시도는 같은 검색 결과를 다시 물어온다 — 누적하되 중복은 남기지 않는다
    const citations = extractCitations([
      asResponse([
        {
          groundingMetadata: {
            groundingChunks: [{ web: { uri: "https://a.example", title: "1차" } }],
          },
        },
      ]),
      asResponse([
        {
          groundingMetadata: {
            groundingChunks: [
              { web: { uri: "https://a.example", title: "2차" } },
              { web: { uri: "https://b.example" } },
            ],
          },
        },
      ]),
    ]);

    expect(citations).toEqual([
      { uri: "https://a.example", title: "1차", kind: "redirect" },
      { uri: "https://b.example", kind: "redirect" },
    ]);
  });

  it("title·domain이 없으면 결과 객체에 키 자체가 없다", () => {
    const [citation] = extractCitations([
      asResponse([
        { groundingMetadata: { groundingChunks: [{ web: { uri: "https://a.example" } }] } },
      ]),
    ]);

    expect(Object.keys(citation)).toEqual(["uri", "kind"]);
    expect("title" in citation).toBe(false);
    expect("domain" in citation).toBe(false);
  });

  it("urlContext로 읽어낸 페이지는 origin, 검색 chunk는 redirect로 태깅한다", () => {
    // urlRetrievalStatus가 SUCCESS가 아닌 항목은 제외한다 — 읽지 못한 URL은 인용이 아니다
    const citations = extractCitations([
      asResponse([
        {
          groundingMetadata: {
            groundingChunks: [{ web: { uri: "https://search.example" } }],
          },
          urlContextMetadata: {
            urlMetadata: [
              {
                retrievedUrl: "https://competitor.example/pricing",
                urlRetrievalStatus: SUCCESS,
              },
              {
                retrievedUrl: "https://blocked.example",
                urlRetrievalStatus: "URL_RETRIEVAL_STATUS_ERROR",
              },
              {
                retrievedUrl: "https://paywall.example",
                urlRetrievalStatus: "URL_RETRIEVAL_STATUS_PAYWALL",
              },
            ],
          },
        },
      ]),
    ]);

    expect(citations).toEqual([
      { uri: "https://search.example", kind: "redirect" },
      { uri: "https://competitor.example/pricing", kind: "origin" },
    ]);
  });

  it("같은 uri가 chunk와 urlContext 양쪽에 있으면 origin이 이긴다 (ADR-013)", () => {
    // 원본을 실제로 읽어낸 인용이 만료되는 리다이렉트보다 강하다.
    // chunk가 실어온 title은 같은 uri의 설명이므로 그대로 살린다
    const citations = extractCitations([
      asResponse([
        {
          groundingMetadata: {
            groundingChunks: [{ web: { uri: "https://a.example", title: "T" } }],
          },
          urlContextMetadata: {
            urlMetadata: [
              { retrievedUrl: "https://a.example", urlRetrievalStatus: SUCCESS },
            ],
          },
        },
      ]),
    ]);

    expect(citations).toEqual([
      { uri: "https://a.example", title: "T", kind: "origin" },
    ]);
  });

  it("시도 경계를 넘어서도 origin이 redirect를 이긴다", () => {
    // 1차 시도는 검색으로만 만난 uri를, 2차 시도는 그 페이지를 실제로 읽어냈다
    const citations = extractCitations([
      asResponse([
        {
          groundingMetadata: {
            groundingChunks: [{ web: { uri: "https://a.example" } }],
          },
        },
      ]),
      asResponse([
        {
          urlContextMetadata: {
            urlMetadata: [
              { retrievedUrl: "https://a.example", urlRetrievalStatus: SUCCESS },
            ],
          },
        },
      ]),
    ]);

    expect(citations).toEqual([{ uri: "https://a.example", kind: "origin" }]);
  });

  it("candidates·metadata가 없어도 빈 배열을 반환하고 throw하지 않는다", () => {
    // grounding이 아무것도 못 찾는 것은 정상적인 결과다 — 파이프라인을 죽이지 않는다
    expect(extractCitations([])).toEqual([]);
    expect(extractCitations([asResponse()])).toEqual([]);
    expect(extractCitations([asResponse([])])).toEqual([]);
    expect(extractCitations([asResponse([{}])])).toEqual([]);
    expect(extractCitations([asResponse([{ groundingMetadata: {} }])])).toEqual(
      [],
    );
  });
});
