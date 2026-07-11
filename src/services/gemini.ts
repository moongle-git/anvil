import {
  GoogleGenAI,
  UrlRetrievalStatus,
  type GenerateContentConfig,
  type GenerateContentResponse,
} from "@google/genai";
import { z, type ZodType } from "zod";
import { withTimeout } from "./withTimeout.js";

export const DEFAULT_GEMINI_MODEL = "gemini-2.5-flash";
const DEFAULT_MAX_RETRIES = 3;
// grounding은 검색 왕복 때문에 정상 응답도 50~90초가 걸린다(실측 52초). 정상 호출을
// 오탐하지 않도록 2분으로 넉넉히 잡되, 무한 hang(수 분~영구)은 반드시 끊는다.
const DEFAULT_TIMEOUT_MS = 120_000;
// grounding에 urlContext(경쟁사 페이지 직접 read)를 얹으면 왕복이 더 늘어난다. 다만
// `재시도 × 타임아웃`이 runStore의 STALLED_THRESHOLD_MS(15분)를 넘으면 웹 UI가 정상
// 실행 중인 run을 "중단됨"으로 오탐한다 — executeStep은 실행 중 state.json을 건드리지
// 않기 때문이다. 최악 2 × 180초 = 6분으로 묶는다. 타임아웃을 늘리려면 재시도를 줄여라.
const DEFAULT_GROUNDED_TIMEOUT_MS = 180_000;
// grounding 실패는 대개 JSON 형식이라 2회면 잡힌다. 3회째가 살리는 경우는 드물다.
const DEFAULT_GROUNDED_MAX_RETRIES = 2;

export interface GeminiServiceOptions {
  apiKey: string;
  model?: string;
  maxRetries?: number;
  timeoutMs?: number;
  groundedTimeoutMs?: number;
  groundedMaxRetries?: number;
}

export interface GenerateStructuredParams<T> {
  systemInstruction: string;
  prompt: string;
  schema: ZodType<T>;
}

export interface GenerateGroundedParams<T> {
  systemInstruction: string;
  prompt: string;
  schema: ZodType<T>;
  /** 경쟁사 공식 페이지를 모델이 직접 읽게 한다 (ADR-012). 기본 true */
  useUrlContext?: boolean;
}

/**
 * 인용의 출처 종류 (ADR-013). types/marketContext의 CitationSchema.kind와 같은 값이어야 한다.
 * origin(urlContext가 실제로 읽어낸 원본 URL)은 만료되지 않고, redirect(vertexaisearch)는 만료된다.
 */
export type CitationKind = "origin" | "redirect";

/** 코드가 grounding 응답에서 추출한 검증된 인용. LLM 자기보고(sources)와 공존한다 (ADR-012) */
export interface GroundingCitation {
  /** uri 없는 chunk는 인용으로 쓸 수 없다 — 그래서 필수다 */
  uri: string;
  title?: string;
  domain?: string;
  kind: CitationKind;
}

export interface GroundedResult<T> {
  data: T;
  citations: GroundingCitation[];
  /** 모델이 실제로 검색한 쿼리 — 관측용. 산출물 스키마에는 넣지 않는다 */
  webSearchQueries: string[];
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

/**
 * grounding 응답들에서 검증된 인용을 추출한다 (ADR-012, ADR-013).
 *
 * 이 함수가 존재하는 이유: 이전에는 응답의 text만 읽고 groundingMetadata를 버렸다.
 * 그래서 리포트의 출처가 LLM이 자기 기억으로 적어낸 URL이었고, 환각을 걸러낼 장치가 없었다.
 *
 * **재시도의 모든 시도를 함께 받는다.** 인용은 문장별 각주가 아니라 "이 run의 grounding이
 * 실제로 무엇을 가져왔는가"의 run 단위 기록이다 — 형식 검증에 실패한 시도에서도 검색은 실재했다.
 *
 * 주의: groundingChunks의 uri는 원 사이트가 아니라 만료되는 vertexaisearch 리다이렉트 URL이다
 * (kind: redirect). 반면 urlContext로 실제로 읽어낸 페이지(urlContextMetadata)는 원 URL이라
 * 가장 강한 인용이다(kind: origin) — 같은 uri가 양쪽에 나오면 origin이 이긴다.
 * metadata가 없어도 throw하지 않는다 — grounding이 아무것도 못 찾는 것은 정상이다.
 */
export function extractCitations(
  responses: readonly GenerateContentResponse[],
): GroundingCitation[] {
  // 같은 소스가 여러 chunk로 쪼개져 오고, 여러 시도가 같은 검색 결과를 다시 물어온다
  const byUri = new Map<string, GroundingCitation>();

  for (const response of responses) {
    const candidate = response.candidates?.[0];

    for (const chunk of candidate?.groundingMetadata?.groundingChunks ?? []) {
      const web = chunk.web;
      const uri = web?.uri;
      if (
        web === undefined ||
        uri === undefined ||
        uri === "" ||
        byUri.has(uri)
      ) {
        continue;
      }
      // exactOptionalPropertyTypes — 값이 없으면 키 자체를 넣지 않는다
      const citation: GroundingCitation = { uri, kind: "redirect" };
      if (web.title !== undefined && web.title !== "") {
        citation.title = web.title;
      }
      if (web.domain !== undefined && web.domain !== "") {
        citation.domain = web.domain;
      }
      byUri.set(uri, citation);
    }

    for (const meta of candidate?.urlContextMetadata?.urlMetadata ?? []) {
      const uri = meta.retrievedUrl;
      if (
        meta.urlRetrievalStatus !==
          UrlRetrievalStatus.URL_RETRIEVAL_STATUS_SUCCESS ||
        uri === undefined ||
        uri === ""
      ) {
        continue;
      }
      const seen = byUri.get(uri);
      if (seen === undefined) {
        byUri.set(uri, { uri, kind: "origin" });
        continue;
      }
      // 이미 본 uri라도 origin이 리다이렉트를 이긴다 — 원본이 더 강한 인용이다.
      // chunk가 실어온 title·domain은 같은 uri의 설명이므로 그대로 둔다.
      seen.kind = "origin";
    }
  }

  return [...byUri.values()];
}

export class GeminiService {
  private readonly client: GoogleGenAI;
  private readonly model: string;
  private readonly maxRetries: number;
  private readonly timeoutMs: number;
  private readonly groundedMaxRetries: number;
  private readonly groundedTimeoutMs: number;

  constructor(options: GeminiServiceOptions, client?: GoogleGenAI) {
    this.client = client ?? new GoogleGenAI({ apiKey: options.apiKey });
    this.model = options.model ?? DEFAULT_GEMINI_MODEL;
    this.maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.groundedMaxRetries =
      options.groundedMaxRetries ?? DEFAULT_GROUNDED_MAX_RETRIES;
    this.groundedTimeoutMs =
      options.groundedTimeoutMs ?? DEFAULT_GROUNDED_TIMEOUT_MS;
  }

  /**
   * 자가 교정 재시도 루프 (ADR-004). **모든 시도**의 raw 응답을 함께 돌려준다 (ADR-013).
   *
   * 검증에 성공한 시도의 응답만 돌려주던 것을 뒤집었다. 재시도 프롬프트는 `[교정 요청]`이라
   * 모델이 새로 검색하지 않아 2차 응답에는 groundingMetadata가 아예 없다 — 그래서 1차 시도가
   * 실제로 수행한 검색의 인용이 통째로 버려졌고, 실측 8개 run 전부에서 citations가 0건이었다.
   * 형식 실패한 것은 JSON이지 검색이 아니다. 그 시도의 인용은 실재한다.
   */
  private async generateValidated<T>(params: {
    baseConfig: GenerateContentConfig;
    basePrompt: string;
    schema: ZodType<T>;
    maxRetries: number;
    timeoutMs: number;
    /** grounding은 responseJsonSchema를 못 써 자유 텍스트에서 JSON을 긁어내야 한다 */
    extractJson: boolean;
    label: string;
  }): Promise<{ data: T; responses: GenerateContentResponse[] }> {
    const { baseConfig, basePrompt, schema, maxRetries, timeoutMs } = params;

    const responses: GenerateContentResponse[] = [];
    let lastError = "";
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
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
          config: { ...baseConfig, abortSignal: AbortSignal.timeout(timeoutMs) },
        }),
        timeoutMs,
        "Gemini 호출",
      );

      // 검증 결과와 무관하게 누적한다 — 이 시도의 검색은 이미 일어났다
      responses.push(response);

      const text = response.text;
      if (text === undefined || text.trim() === "") {
        lastError = "응답 텍스트가 비어 있다";
        continue;
      }

      try {
        const parsed: unknown = JSON.parse(
          params.extractJson ? extractJsonText(text) : text,
        );
        // LLM이 선택 필드에 넣는 null을 '키 부재'로 정규화한 뒤 검증한다
        const result = schema.safeParse(stripNullProps(parsed));
        if (result.success) {
          return { data: result.data, responses };
        }
        lastError = z.prettifyError(result.error);
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
      }
    }

    throw new Error(
      `Gemini ${params.label}이 ${maxRetries}회 시도 후에도 검증에 실패했다: ${lastError}`,
    );
  }

  async generateStructured<T>(params: GenerateStructuredParams<T>): Promise<T> {
    const { systemInstruction, prompt, schema } = params;

    const { data } = await this.generateValidated({
      baseConfig: {
        systemInstruction,
        responseMimeType: "application/json",
        responseJsonSchema: z.toJSONSchema(schema),
      },
      basePrompt: prompt,
      schema,
      maxRetries: this.maxRetries,
      timeoutMs: this.timeoutMs,
      extractJson: false,
      label: "구조화 출력",
    });
    return data;
  }

  /**
   * Google Search grounding(+urlContext) 모드. 산출물과 함께 코드가 추출한 인용을 돌려준다.
   * grounding과 responseSchema는 동시 사용이 불가하므로 자유 텍스트로 받아 JSON을 추출한다.
   */
  async generateGrounded<T>(
    params: GenerateGroundedParams<T>,
  ): Promise<GroundedResult<T>> {
    const { systemInstruction, prompt, schema, useUrlContext = true } = params;

    const tools = useUrlContext
      ? [{ googleSearch: {} }, { urlContext: {} }]
      : [{ googleSearch: {} }];

    const { data, responses } = await this.generateValidated({
      baseConfig: { systemInstruction, tools },
      basePrompt: `${prompt}\n\n${JSON_ONLY_INSTRUCTION}`,
      schema,
      maxRetries: this.groundedMaxRetries,
      timeoutMs: this.groundedTimeoutMs,
      extractJson: true,
      label: "grounding 응답",
    });

    return {
      data,
      // 인용·검색어는 채택된 시도가 아니라 run 전체의 기록이다 (ADR-013)
      citations: extractCitations(responses),
      webSearchQueries: [
        ...new Set(
          responses.flatMap(
            (response) =>
              response.candidates?.[0]?.groundingMetadata?.webSearchQueries ??
              [],
          ),
        ),
      ],
    };
  }
}
