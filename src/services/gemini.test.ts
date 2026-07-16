import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { ApiError } from "@google/genai";
import type { GenerateContentResponse, GoogleGenAI } from "@google/genai";
import type { CallUsage } from "../lib/cost.js";
import {
  DEFAULT_GEMINI_MODEL,
  GeminiService,
  extractCitations,
  type GeminiServiceOptions,
} from "./gemini.js";

const TestSchema = z.object({
  title: z.string(),
  score: z.number(),
});

interface FakeClient {
  client: GoogleGenAI;
  generateContent: ReturnType<typeof vi.fn>;
}

/**
 * 응답 본문(text)만 주거나, grounding metadata·usageMetadata까지 실은 raw 응답을 준다.
 * Error를 주면 그 시도는 reject한다 — 503 같은 전송 실패를 재현한다.
 */
type FakeResponse =
  | string
  | undefined
  | Error
  | { text?: string; candidates?: unknown[]; usageMetadata?: unknown };

function fakeClient(...responses: FakeResponse[]): FakeClient {
  const generateContent = vi.fn();
  for (const response of responses) {
    if (response instanceof Error) {
      generateContent.mockRejectedValueOnce(response);
      continue;
    }
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
      usageLabel: "test",
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
      usageLabel: "test",
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
      usageLabel: "test",
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
      usageLabel: "test",
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
      usageLabel: "test",
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
        usageLabel: "test",
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
      usageLabel: "test",
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
      usageLabel: "test",
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
        usageLabel: "test",
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
      usageLabel: "test",
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
      usageLabel: "test",
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
      usageLabel: "test",
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
      usageLabel: "test",
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
      usageLabel: "test",
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
      usageLabel: "test",
    });

    expect(data).toEqual({ title: "아이디어", score: 42 });
  });

  it("펜스 없이 텍스트에 섞인 JSON도 중괄호 매칭으로 추출한다", async () => {
    const { client } = fakeClient(`설명 앞부분 ${VALID_JSON} 뒤에 붙은 설명`);

    const { data } = await grounding(client).generateGrounded({
      systemInstruction: "system",
      prompt: "prompt",
      schema: TestSchema,
      usageLabel: "test",
    });

    expect(data).toEqual({ title: "아이디어", score: 42 });
  });

  it("config에 abortSignal을 실어 요청을 취소 가능하게 한다", async () => {
    const { client, generateContent } = fakeClient(VALID_JSON);

    await grounding(client).generateGrounded({
      systemInstruction: "system",
      prompt: "prompt",
      schema: TestSchema,
      usageLabel: "test",
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
        usageLabel: "test",
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
        usageLabel: "test",
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
        usageLabel: "test",
      }),
    ).rejects.toThrow(/시간 초과/);
  });
});

describe("일시적 전송 오류 재시도 (503/429)", () => {
  /**
   * SDK가 실제로 던지는 에러다 — message는 응답 본문 JSON 전문, status는 HTTP 코드.
   * 실측된 시장조사 실패의 원문:
   * {"error":{"code":503,"message":"This model is currently experiencing high demand...","status":"UNAVAILABLE"}}
   */
  function apiError(code: number, status: string, message: string): ApiError {
    return new ApiError({
      message: JSON.stringify({ error: { code, message, status } }),
      status: code,
    });
  }

  const OVERLOADED = (): ApiError =>
    apiError(
      503,
      "UNAVAILABLE",
      "This model is currently experiencing high demand. Spikes in demand are usually temporary. Please try again later.",
    );
  const RATE_LIMITED = (): ApiError =>
    apiError(429, "RESOURCE_EXHAUSTED", "Quota exceeded.");
  const BAD_REQUEST = (): ApiError =>
    apiError(400, "INVALID_ARGUMENT", "Invalid JSON payload.");

  /** 백오프를 0으로 둬야 테스트가 실제로 잠들지 않는다 */
  function resilient(
    client: GoogleGenAI,
    overrides: Partial<GeminiServiceOptions> = {},
  ): GeminiService {
    return new GeminiService(
      { apiKey: "test-key", transportBackoffMs: 0, ...overrides },
      client,
    );
  }

  const structured = {
    systemInstruction: "system",
    prompt: "원본 프롬프트",
    schema: TestSchema,
    usageLabel: "test",
  };

  it("503 UNAVAILABLE로 실패하면 재시도해 성공 응답을 반환한다", async () => {
    const { client, generateContent } = fakeClient(OVERLOADED(), VALID_JSON);

    const result = await resilient(client).generateStructured(structured);

    expect(result).toEqual({ title: "아이디어", score: 42 });
    expect(generateContent).toHaveBeenCalledTimes(2);
  });

  it("429 RESOURCE_EXHAUSTED도 재시도 대상이다", async () => {
    const { client, generateContent } = fakeClient(RATE_LIMITED(), VALID_JSON);

    await expect(
      resilient(client).generateStructured(structured),
    ).resolves.toEqual({ title: "아이디어", score: 42 });
    expect(generateContent).toHaveBeenCalledTimes(2);
  });

  it("★ 전송 재시도는 원본 프롬프트를 그대로 다시 보낸다 — 교정 요청이 아니다", async () => {
    // 503은 모델이 응답을 준 적이 없다는 뜻이다. 교정하라고 시키면 존재하지도 않는
    // '직전 응답'을 고치라는 말이 되어 모델을 오염시킨다.
    const { client, generateContent } = fakeClient(OVERLOADED(), VALID_JSON);

    await resilient(client).generateStructured(structured);

    const retryContents = generateContent.mock.calls[1][0].contents as string;
    expect(retryContents).toBe("원본 프롬프트");
    expect(retryContents).not.toContain("교정 요청");
  });

  it("★ 전송 재시도는 검증 재시도 예산을 쓰지 않는다", async () => {
    // 503(응답 없음)과 형식 오류(응답은 왔으나 틀림)는 다른 실패다. 503이 교정 예산을
    // 갉아먹으면, 용량 스파이크 한 번에 자가 교정 기회가 통째로 사라진다.
    const invalid = JSON.stringify({ title: "아이디어", score: "높음" });
    const { client, generateContent } = fakeClient(
      OVERLOADED(),
      invalid,
      VALID_JSON,
    );

    const result = await resilient(client, {
      maxRetries: 2,
    }).generateStructured(structured);

    // maxRetries=2인데도 3번 호출됐다 — 503은 검증 시도로 세지 않았다는 뜻이다
    expect(result).toEqual({ title: "아이디어", score: 42 });
    expect(generateContent).toHaveBeenCalledTimes(3);
  });

  it("503이 계속되면 시도 횟수와 원인을 담아 던진다", async () => {
    const { client, generateContent } = fakeClient(
      OVERLOADED(),
      OVERLOADED(),
      OVERLOADED(),
    );

    const call = resilient(client, {
      transportMaxAttempts: 3,
    }).generateStructured(structured);

    // 원인 진단에 필요한 것: 몇 번 시도했는가와 서버가 뭐라 했는가
    await expect(call).rejects.toThrow(/3회/);
    await expect(call).rejects.toThrow(/high demand/);
    expect(generateContent).toHaveBeenCalledTimes(3);
  });

  it("★ 400 INVALID_ARGUMENT는 재시도하지 않고 즉시 던진다", async () => {
    // 요청 자체가 틀렸다는 뜻이다 — 백 번을 보내도 같은 답이 온다.
    // 재시도하면 진짜 원인이 백오프 뒤에 묻히고 과금만 3배가 된다.
    const { client, generateContent } = fakeClient(BAD_REQUEST(), VALID_JSON);

    await expect(
      resilient(client).generateStructured(structured),
    ).rejects.toThrow(/INVALID_ARGUMENT/);
    expect(generateContent).toHaveBeenCalledTimes(1);
  });

  it("★ 시간 초과는 재시도하지 않는다 (STALLED 예산 보호)", async () => {
    // 503은 즉시 실패라 재시도가 싸지만, 타임아웃은 이미 timeoutMs를 통째로 태운
    // 뒤다. 그것까지 재시도하면 `검증 재시도 × 전송 재시도 × 타임아웃`이 곱해져
    // runStore의 STALLED_THRESHOLD_MS(15분)를 넘고, 웹 UI가 정상 run을 중단됨으로 오탐한다.
    const { client } = hangingClient();

    await expect(
      resilient(client, { timeoutMs: 20, maxRetries: 1 }).generateStructured(
        structured,
      ),
    ).rejects.toThrow(/시간 초과/);
    // hangingClient는 영원히 pending이므로 호출 수 단언 대신 시간 초과 전파로 검증한다
  });

  it("전송 재시도 사이에는 백오프를 두어 즉시 다시 때리지 않는다", async () => {
    const { client } = fakeClient(OVERLOADED(), VALID_JSON);
    const started = Date.now();

    await resilient(client, { transportBackoffMs: 40 }).generateStructured(
      structured,
    );

    expect(Date.now() - started).toBeGreaterThanOrEqual(40);
  });

  it("실패한 전송 시도는 과금되지 않으므로 usage를 기록하지 않는다", async () => {
    // 503은 응답 본문이 없다 = 토큰을 쓴 적이 없다. 검증 실패(과금됨)와 정반대다.
    const usages: CallUsage[] = [];
    const { client } = fakeClient(OVERLOADED(), {
      text: VALID_JSON,
      usageMetadata: { promptTokenCount: 10, totalTokenCount: 12 },
    });

    await new GeminiService(
      {
        apiKey: "test-key",
        transportBackoffMs: 0,
        onUsage: (usage) => usages.push(usage),
      },
      client,
    ).generateStructured(structured);

    expect(usages).toHaveLength(1);
    expect(usages[0].attempt).toBe(1);
  });

  it("★ grounding 경로도 전송 오류를 재시도한다 (시장조사가 503으로 죽던 경로)", async () => {
    const { client, generateContent } = fakeClient(
      OVERLOADED(),
      grounded(VALID_JSON, {
        chunks: [{ web: { uri: "https://a.dev", title: "A" } }],
        queries: ["시장 규모"],
      }),
    );

    const result = await resilient(client, {
      groundedMaxRetries: 2,
    }).generateGrounded({
      systemInstruction: "system",
      prompt: "prompt",
      schema: TestSchema,
      usageLabel: "context-hunter",
    });

    expect(result.data).toEqual({ title: "아이디어", score: 42 });
    // 503으로 날아간 시도는 인용을 남기지 않지만, 살아남은 시도의 인용은 온전하다
    expect(result.citations).toEqual([
      { uri: "https://a.dev", title: "A", kind: "redirect" },
    ]);
    expect(generateContent).toHaveBeenCalledTimes(2);
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

describe("usage 계측 (onUsage — ADR-016)", () => {
  const USAGE_METADATA = {
    promptTokenCount: 12_000,
    cachedContentTokenCount: 2_000,
    candidatesTokenCount: 800,
    thoughtsTokenCount: 3_500,
    totalTokenCount: 16_300,
  };

  /** usageMetadata를 실은 응답 */
  function metered(
    text: string | undefined,
    usageMetadata: unknown = USAGE_METADATA,
  ): FakeResponse {
    return { text, usageMetadata };
  }

  /** onUsage를 배선한 서비스와, 콜백이 받은 usage들을 함께 돌려준다 */
  function metering(
    client: GoogleGenAI,
    overrides: { maxRetries?: number; groundedMaxRetries?: number } = {},
    onUsage?: (usage: CallUsage) => void,
  ): { svc: GeminiService; usages: CallUsage[] } {
    const usages: CallUsage[] = [];
    const svc = new GeminiService(
      {
        apiKey: "test-key",
        maxRetries: overrides.maxRetries ?? 3,
        groundedMaxRetries: overrides.groundedMaxRetries ?? 2,
        onUsage:
          onUsage ??
          ((usage) => {
            usages.push(usage);
          }),
      },
      client,
    );
    return { svc, usages };
  }

  it("응답의 usageMetadata를 CallUsage로 옮겨 흘려보낸다", async () => {
    const { client } = fakeClient(metered(VALID_JSON));
    const { svc, usages } = metering(client);

    await svc.generateStructured({
      systemInstruction: "system",
      prompt: "prompt",
      schema: TestSchema,
      usageLabel: "thesis",
    });

    expect(usages).toEqual([
      {
        label: "thesis",
        model: DEFAULT_GEMINI_MODEL,
        grounded: false,
        attempt: 1,
        promptTokens: 12_000,
        cachedTokens: 2_000,
        outputTokens: 800,
        thoughtsTokens: 3_500,
        totalTokens: 16_300,
      },
    ]);
  });

  it("★ 재시도한 시도마다 usage가 기록된다 (검증에 실패한 응답도 과금된다)", async () => {
    // 이 계약이 없으면 재시도 비용이 장부에서 통째로 사라진다. 재시도야말로 프롬프트
    // 전문을 다시 전송하는 가장 비싼 경로이고, 그것을 못 세면 "재시도를 줄이는 것이
    // 이득인가"라는 질문에 영영 답할 수 없다. 형식이 실패한 것이지 청구가 실패한 게 아니다.
    const invalid = JSON.stringify({ title: "아이디어", score: "높음" });
    const { client } = fakeClient(
      metered(invalid, { ...USAGE_METADATA, candidatesTokenCount: 500 }),
      metered(VALID_JSON),
    );
    const { svc, usages } = metering(client);

    const result = await svc.generateStructured({
      systemInstruction: "system",
      prompt: "prompt",
      schema: TestSchema,
      usageLabel: "coldCritic",
    });

    expect(result).toEqual({ title: "아이디어", score: 42 });
    expect(usages).toHaveLength(2);
    // 1차는 zod 검증에 실패한 시도다 — 그래도 과금됐으므로 장부에 남는다
    expect(usages[0]).toMatchObject({ attempt: 1, outputTokens: 500 });
    expect(usages[1]).toMatchObject({ attempt: 2, outputTokens: 800 });
    expect(usages.every((usage) => usage.label === "coldCritic")).toBe(true);
  });

  it("모든 시도가 실패해 throw할 때도 시도별 usage가 남는다", async () => {
    const { client } = fakeClient(
      metered("invalid-1"),
      metered("invalid-2"),
      metered("invalid-3"),
    );
    const { svc, usages } = metering(client, { maxRetries: 3 });

    await expect(
      svc.generateStructured({
        systemInstruction: "system",
        prompt: "prompt",
        schema: TestSchema,
        usageLabel: "verdict",
      }),
    ).rejects.toThrow();

    // 실패로 끝난 step도 3회분이 청구된다 — throw 경로에서 usage가 새면 안 된다
    expect(usages.map((usage) => usage.attempt)).toEqual([1, 2, 3]);
  });

  it("usageMetadata가 없는 응답에서도 throw하지 않는다", async () => {
    // 계측 실패가 파이프라인을 죽이면 안 된다
    const { client } = fakeClient(VALID_JSON);
    const { svc, usages } = metering(client);

    const result = await svc.generateStructured({
      systemInstruction: "system",
      prompt: "prompt",
      schema: TestSchema,
      usageLabel: "thesis",
    });

    expect(result).toEqual({ title: "아이디어", score: 42 });
    expect(usages).toEqual([]);
  });

  it("onUsage가 throw해도 generateStructured는 정상적으로 값을 반환한다", async () => {
    // 계측은 부수적 관심사다. DB 쓰기 실패가 컨설팅 실행을 중단시키는 것은
    // 꼬리가 개를 흔드는 것이다.
    const { client } = fakeClient(metered(VALID_JSON));
    const { svc } = metering(client, {}, () => {
      throw new Error("DB 쓰기 실패");
    });

    await expect(
      svc.generateStructured({
        systemInstruction: "system",
        prompt: "prompt",
        schema: TestSchema,
        usageLabel: "thesis",
      }),
    ).resolves.toEqual({ title: "아이디어", score: 42 });
  });

  it("generateGrounded의 usage는 grounded: true다 (요청당 정액이 붙는다)", async () => {
    const { client } = fakeClient(metered(VALID_JSON));
    const { svc, usages } = metering(client);

    await svc.generateGrounded({
      systemInstruction: "system",
      prompt: "prompt",
      schema: TestSchema,
      usageLabel: "contextHunter",
    });

    expect(usages).toHaveLength(1);
    expect(usages[0]).toMatchObject({
      label: "contextHunter",
      grounded: true,
      attempt: 1,
    });
  });

  it("onUsage를 주지 않아도 호출은 정상 동작한다", async () => {
    const { client } = fakeClient(metered(VALID_JSON));

    await expect(
      service(client).generateStructured({
        systemInstruction: "system",
        prompt: "prompt",
        schema: TestSchema,
        usageLabel: "thesis",
      }),
    ).resolves.toEqual({ title: "아이디어", score: 42 });
  });
});

describe("thinkingBudget (ADR-016 결정 4)", () => {
  function grounding(client: GoogleGenAI): GeminiService {
    return new GeminiService({ apiKey: "test-key" }, client);
  }

  it("thinkingBudget: 0이면 구조화 호출의 thinking을 끈다", async () => {
    const { client, generateContent } = fakeClient(VALID_JSON);

    await service(client).generateStructured({
      systemInstruction: "system",
      prompt: "prompt",
      schema: TestSchema,
      usageLabel: "research-planner",
      thinkingBudget: 0,
    });

    expect(generateContent.mock.calls[0][0].config.thinkingConfig).toEqual({
      thinkingBudget: 0,
      // thought 원문을 받아올 이유가 없다 — 받으면 그것도 토큰이다
      includeThoughts: false,
    });
  });

  it("thinkingBudget을 생략하면 thinkingConfig 자체를 넣지 않는다 (모델 기본값)", async () => {
    const { client, generateContent } = fakeClient(VALID_JSON);

    await service(client).generateStructured({
      systemInstruction: "system",
      prompt: "prompt",
      schema: TestSchema,
      usageLabel: "test",
    });

    const { config } = generateContent.mock.calls[0][0];
    expect(config.thinkingConfig).toBeUndefined();
    expect("thinkingConfig" in config).toBe(false);
  });

  it("grounded 호출도 tool과 함께 thinkingConfig를 싣는다", async () => {
    const { client, generateContent } = fakeClient(VALID_JSON);

    await grounding(client).generateGrounded({
      systemInstruction: "system",
      prompt: "prompt",
      schema: TestSchema,
      usageLabel: "context-hunter",
      thinkingBudget: 4096,
    });

    const { config } = generateContent.mock.calls[0][0];
    // googleSearch·urlContext와 thinkingConfig는 병용 가능하다
    expect(config.tools).toEqual([{ googleSearch: {} }, { urlContext: {} }]);
    expect(config.thinkingConfig).toEqual({
      thinkingBudget: 4096,
      includeThoughts: false,
    });
  });

  it("grounded 호출도 thinkingBudget을 생략하면 thinkingConfig가 없다", async () => {
    const { client, generateContent } = fakeClient(VALID_JSON);

    await grounding(client).generateGrounded({
      systemInstruction: "system",
      prompt: "prompt",
      schema: TestSchema,
      usageLabel: "test",
    });

    expect(
      "thinkingConfig" in generateContent.mock.calls[0][0].config,
    ).toBe(false);
  });

  it("재시도한 시도에도 같은 상한이 걸린다 — 재시도가 가장 비싼 경로다", async () => {
    const { client, generateContent } = fakeClient("이것은 JSON이 아님", VALID_JSON);

    await service(client).generateStructured({
      systemInstruction: "system",
      prompt: "prompt",
      schema: TestSchema,
      usageLabel: "cold-critic",
      thinkingBudget: 2048,
    });

    expect(generateContent).toHaveBeenCalledTimes(2);
    for (const call of generateContent.mock.calls) {
      expect(call[0].config.thinkingConfig).toEqual({
        thinkingBudget: 2048,
        includeThoughts: false,
      });
    }
  });
});
