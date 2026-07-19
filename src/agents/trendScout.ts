import type { GeminiService, GroundingCitation } from "../services/gemini.js";
import {
  opportunitiesSchemaFor,
  SIGNAL_TYPES,
  type CapitalSignal,
  type Citation,
  type Opportunities,
  type Opportunity,
  type OpportunityDraft,
  type ResolvedCapitalSignal,
  type ResolvedFigure,
  type ScoutDossier,
} from "../types/index.js";
import { planScoutQueries, scoutWindowStart } from "./scoutPlanner.js";
import { searchCapitalSignals } from "./scoutSearch.js";

/** usage 집계 라벨 = 파이프라인 step 이름 (ADR-016). scout-planner·scout-search는 자기 라벨로 따로 남는다 */
export const TREND_SCOUT_USAGE_LABEL = "trend-scout";

/**
 * thinking 상한 (ADR-016). 8192 — 이 호출이 이 step의 유일한 판단 지점이다.
 * 검색어 설계(0)도 사실 정리(4096)도 아니고, "어느 사실들이 하나의 기회를 이루는가"를
 * 삼각측량 제약 아래에서 조립해야 한다. contextHunter와 같은 이유로 최대치를 뚜껑으로만 둔다.
 */
export const TREND_SCOUT_THINKING_BUDGET = 8192;

/**
 * 범위 힌트가 없을 때 산출물의 scope에 적는 값.
 * RunStore의 SCOUT_FULL_SCOPE_IDEA와 같은 문자열이어야 한다 — 목록에 보이는 run 제목과
 * 산출물의 scope가 갈리면 같은 사실에 두 표기가 생긴다. (runStore를 import하지 않는 것은
 * 그것이 node:sqlite를 끌고 오기 때문이다 — agents는 저장소를 모른다.)
 */
export const SCOUT_FULL_SCOPE_LABEL = "전 범위 탐색";

export const TREND_SCOUT_SYSTEM_PROMPT = `당신은 수집된 자본 신호를 읽고 **아직 아무도 만들지 않은 서비스 기회**를 조립하는 스카우트다.

## 당신이 받는 것과 만드는 것
당신은 (1) 앞 단계가 검색으로 관측한 사실 목록과 (2) 코드가 검색 응답에서 추출한 번호 붙은 인용 목록을 받는다.
후보는 이 둘 위에서만 조립된다. **기억으로 보충하지 마라** — 당신의 사전지식에는 날짜도 출처도 붙어 있지 않아, 그것으로 채운 문장은 검증에서 전부 떨어진다.

## 인용은 ID로만 지목한다
- **[C1]·[C2] 같은 ID로만 지목하라. URL을 타이핑하지 마라.** 원문·출처·주소는 코드가 그 ID로 복원한다.
- 목록에 없는 ID를 쓰면 검증에 실패하고 재시도가 돈다. 지어내도 소용이 없다.
- findings와 인용은 **별개의 목록**이다. 어느 사실이 어느 인용에서 왔는지는 당신이 짝지어야 한다.

## 후보의 조건
- **삼각측량** — 후보마다 서로 다른 signalType이 2종 이상이고, 서로 다른 인용이 2개 이상이어야 한다. 한 기사에서 읽은 한 이야기는 신호가 아니다.
- **날짜** — 모든 신호에 observedAt(보도·공시된 날)이 필수다. **연·월·일이 다 있는 YYYY-MM-DD로만 적어라** — "2026-Q2"·"2026-03"처럼 분기·월까지만 쓴 표기는 받지 않는다. 아직 오지 않은 날은 보도된 날일 수 없으니 observedAt은 반드시 오늘이거나 그 이전이다. 규제 시행일 등 앞으로의 날짜는 effectiveAt에 따로 적는다.
- **구간 밖은 버린다** — 날짜창 밖의 사실은 신호로 쓸 수 없다. 날짜를 창 안으로 옮겨 적지 마라. 그 신호를 빼고, 남는 신호가 조건을 못 채우면 그 후보를 통째로 빼라.
- **수치 귀속** — 금액·퍼센트를 문장에 쓰면 반드시 figures[]에 같은 표기로, 그 수치가 나온 인용 ID와 함께 담아라.
- **counterSignal** — 이 주제에 **불리한** 증거를 반드시 하나 찾아 담아라. 반대 증거를 못 찾는 주제는 검색되지 않은 주제다.

## 하지 않는 것
- **점수·순위를 매기지 마라.** 우열 판단은 파이프라인 끝의 판정이 한다. 여기서 결론이 나오면 그 뒤 단계가 할 일이 없어진다.
- **"이미 레드오션인가"를 걸러내지 마라.** 그것은 뒤에 오는 비판가의 일이다. 앞에서 미리 거르면 비판이 공격할 표적이 사라진다.
- **근거가 부족하면 후보를 만들지 마라. candidates: []가 정당한 답이다.** 억지로 채운 후보 하나가 비운 목록보다 나쁘다.

## 출력 형식
{ "candidates": [{ "id": "O1", "title": "…", "whatItIs": "무엇을 만드는 서비스인가 1~2문장", "signals": [{ "signalType": "funding|incumbent|regulation|costCurve", "statement": "…", "observedAt": "YYYY-MM-DD", "effectiveAt": "YYYY-MM-DD (선택)", "citationRef": "C1", "figures": [{ "value": "$4.2B", "citationRef": "C1" }], "quote": "출처에서 그대로 딴 문장 (선택)" }], "counterSignal": { …신호와 같은 형식… }, "whyNow": "왜 지금인가", "whoPays": "누가 돈을 내나", "horizon": "short|mid|long" }] }`;

export const TREND_SCOUT_PROMPT_TEMPLATE = `## 탐색 범위
{scope}

## 탐색 날짜창
{windowStart} ~ {now} (오늘은 {now}다). 모든 observedAt은 이 구간 안이어야 한다.

## 관측된 사실 (앞 단계의 검색 결과)
{findings}

## 인용 목록
아래가 코드가 실제 검색 응답에서 추출한 인용의 전부다. citationRef에는 **이 ID만** 쓸 수 있다.

{citations}

## 지시사항
1. 위 사실과 인용을 읽고, 자본이 들어갔는데 아직 물건이 없는 지점을 찾아라.
2. 그 지점마다 후보를 하나 조립하라. 최대 5개다 — 억지로 개수를 채우지 마라.
3. 각 후보의 signals에 서로 다른 종류·서로 다른 인용의 신호를 2건 이상 담고, counterSignal에 불리한 증거를 1건 담아라.
4. 금액·퍼센트를 문장에 썼으면 figures[]에 같은 표기로 출처와 함께 담아라.
5. 근거가 부족하면 candidates를 빈 배열로 두어라.`;

export interface TrendScoutDeps {
  gemini: GeminiService;
  log?: (message: string) => void;
}

/** 인용의 안정적 ID. citations 배열의 인덱스 기준 1-origin이다 (voiceRefId와 같은 규약) */
export function citationRefId(index: number): string {
  return `C${index + 1}`;
}

/** 선행 0("C01")·0번("C0")·잡문자열은 받지 않는다 — 모르는 참조는 추측하지 않고 드롭한다 */
const CITATION_REF_PATTERN = /^C([1-9]\d*)$/;

/** citationRefId의 역함수. 형식이 어긋나면 null — 호출부가 드롭하고 로그를 남긴다 */
function parseCitationRef(ref: string): number | null {
  const match = CITATION_REF_PATTERN.exec(ref.trim());
  return match === null ? null : Number(match[1]) - 1;
}

/**
 * 인용 하나를 프롬프트 줄로 편다.
 *
 * uri를 싣지 않는다 (ADR-013). groundingChunks의 uri는 만료되는 vertexaisearch 리다이렉트라
 * "어느 인용이 유의미한가"를 판단하는 데 아무 정보도 주지 않고, 모델에게 보여주면 받아적다가
 * 도메인 오타를 낸다. 판단에 쓸모 있는 것은 제목과 도메인뿐이다.
 */
function citationBlock(citation: GroundingCitation, index: number): string {
  const label = citation.title ?? "(제목 없음)";
  const domain = citation.domain === undefined ? "" : ` — ${citation.domain}`;
  return `- [${citationRefId(index)}] ${label}${domain}`;
}

function formatCitationSection(citations: readonly GroundingCitation[]): string {
  return citations.map(citationBlock).join("\n");
}

/**
 * 관측된 사실을 축별로 편다. findings는 **모델이 앞 호출에서 서술한 것**이고 citations는
 * 코드가 추출한 것이다 — 둘을 한 목록으로 합치면 무엇이 검색된 사실이고 무엇이 모델의 구성인지
 * 다시 뒤섞인다(그 구분이 step을 나눈 이유다). 그래서 프롬프트에서도 두 섹션으로 남긴다.
 */
function formatFindingsSection(dossier: ScoutDossier): string {
  if (dossier.findings.length === 0) {
    return "(관측된 사실이 없다. 인용만으로 근거를 댈 수 없으면 candidates를 비워라.)";
  }
  return SIGNAL_TYPES.map((axis) => {
    const entries = dossier.findings.filter(
      (finding) => finding.signalType === axis,
    );
    if (entries.length === 0) {
      return `### ${axis}\n- (관측 없음)`;
    }
    return [
      `### ${axis}`,
      ...entries.map(
        (finding) =>
          `- ${finding.statement}${
            finding.observedAt === undefined ? "" : ` (관측일 ${finding.observedAt})`
          }`,
      ),
    ].join("\n");
  }).join("\n\n");
}

/**
 * ref를 실제 인용으로 해소한다. 모르는 ref는 "가장 비슷한 인용"으로 매칭하지 않는다 —
 * 퍼지 매칭은 환각을 그럴듯한 근거로 세탁한다 (resolveVoiceRefs와 같은 규율).
 */
function lookupCitation(
  ref: string,
  citations: readonly GroundingCitation[],
): Citation | null {
  const index = parseCitationRef(ref);
  if (index === null || index >= citations.length) {
    return null;
  }
  return citations[index];
}

function resolveSignal(
  signal: CapitalSignal,
  citations: readonly GroundingCitation[],
  dropped: string[],
): ResolvedCapitalSignal | null {
  const citation = lookupCitation(signal.citationRef, citations);
  if (citation === null) {
    dropped.push(signal.citationRef);
    return null;
  }

  const figures: ResolvedFigure[] = [];
  for (const figure of signal.figures) {
    const figureCitation = lookupCitation(figure.citationRef, citations);
    if (figureCitation === null) {
      dropped.push(figure.citationRef);
      continue;
    }
    figures.push({ value: figure.value, citation: figureCitation });
  }

  // ref를 빼고 실체를 넣는 자리다. 스프레드로 옮기지 않고 필드를 하나씩 적는다 —
  // draft에 새 필드가 생기면 여기서 컴파일이 깨져야 그 필드의 해소 규칙을 정하게 된다.
  return {
    signalType: signal.signalType,
    statement: signal.statement,
    observedAt: signal.observedAt,
    effectiveAt: signal.effectiveAt,
    quote: signal.quote,
    citation,
    figures,
  };
}

/**
 * 후보 하나를 해소한다. 스키마 팩토리가 이미 화이트리스트를 강제하므로 여기서 드롭이 일어나면
 * 방어적 이중 장치가 작동한 것이고, 그 로그가 환각을 관측하는 계기다.
 *
 * 삼각측량이 무너지면(신호 2건 미만) 후보를 통째로 드롭한다 — 근거 하나짜리 후보를 살려두면
 * 스키마가 막으려던 것이 해소 단계를 통해 뒷문으로 들어온다.
 */
function resolveCandidate(
  draft: OpportunityDraft,
  citations: readonly GroundingCitation[],
  dropped: string[],
): Opportunity | null {
  const signals = draft.signals
    .map((signal) => resolveSignal(signal, citations, dropped))
    .filter((signal): signal is ResolvedCapitalSignal => signal !== null);
  const counterSignal = resolveSignal(draft.counterSignal, citations, dropped);

  if (signals.length < 2 || counterSignal === null) {
    return null;
  }

  return {
    id: draft.id,
    title: draft.title,
    whatItIs: draft.whatItIs,
    signals,
    counterSignal,
    whyNow: draft.whyNow,
    whoPays: draft.whoPays,
    horizon: draft.horizon,
  };
}

/**
 * 주제 발굴 에이전트. 세 호출로 나뉜다 — 검색어 설계(non-grounded, budget 0) →
 * grounded 검색(사실 목록) → 합성(non-grounded, budget 8192).
 *
 * 합성이 non-grounded인 것은 형식 실패율 때문이다. grounding 모드는 responseSchema를 못 써
 * 자유 텍스트에서 JSON을 긁어내는데, 이 산출물은 중첩이 깊어 그 경로로는 재시도가 쏟아지고
 * 그 재시도가 grounding 정액 요금을 다시 태운다 (ADR-016 실측).
 */
export async function runTrendScout(
  deps: TrendScoutDeps,
  scope: string | undefined,
  now: Date,
): Promise<Opportunities> {
  const trimmedScope = scope?.trim();
  const scopeLabel =
    trimmedScope !== undefined && trimmedScope.length > 0
      ? trimmedScope
      : SCOUT_FULL_SCOPE_LABEL;
  const searchedAt = now.toISOString();

  // planner는 실패해도 throw하지 않고 축별 기본 검색어로 폴백한다 (ADR-012의 fail-soft 규약)
  const queries = await planScoutQueries(deps, scope, now);
  const { dossier, citations } = await searchCapitalSignals(deps, queries);

  // ── 침묵 게이트 ──
  // grounding이 아무것도 못 찾았다는 것은 근거가 하나도 없다는 뜻이고, 그 상태에서 만든 후보는
  // 전부 모델의 사전지식이다. 다른 장치들은 "지어내면 걸린다"이지만 이것만 "지어낼 이유를 없앤다" —
  // 빈손으로 돌아올 길이 없는 시스템에서 모델은 반드시 무언가를 내놓게 된다.
  if (citations.length === 0) {
    deps.log?.(
      "[trend-scout] 인용 0건 — 근거가 없어 합성을 건너뛴다. candidates는 빈 배열이다",
    );
    return { candidates: [], scope: scopeLabel, searchedAt };
  }

  const citationIds = citations.map((_, index) => citationRefId(index));
  const windowStart = scoutWindowStart(now);
  const prompt = TREND_SCOUT_PROMPT_TEMPLATE.replace("{scope}", scopeLabel)
    .replace("{windowStart}", windowStart.toISOString().slice(0, 10))
    .replaceAll("{now}", now.toISOString().slice(0, 10))
    .replace("{findings}", formatFindingsSection(dossier))
    .replace("{citations}", formatCitationSection(citations));

  // 검증을 generateStructured 바깥으로 빼지 않는다 — 반환된 **뒤**라 자가 교정 재시도가
  // 붙지 않고, 에러 메시지가 곧 교정 프롬프트다 (ADR-017).
  const draft = await deps.gemini.generateStructured({
    systemInstruction: TREND_SCOUT_SYSTEM_PROMPT,
    prompt,
    usageLabel: TREND_SCOUT_USAGE_LABEL,
    thinkingBudget: TREND_SCOUT_THINKING_BUDGET,
    schema: opportunitiesSchemaFor({ citationIds, now, windowStart }),
  });

  // 판단(어느 사실들이 하나의 기회인가)은 LLM이, 사실(그 근거의 출처)은 코드가 소유한다.
  // ref는 dossier 내부 좌표라 산출물에 남기지 않는다 (ADR-013).
  //
  // quote는 대조하지 않는다. step 2의 조사 결론대로 출처 원문은 얻을 수 없다 —
  // groundingSupports[].segment.text는 출처가 아니라 **모델 자신의 응답 텍스트**이고,
  // groundingChunk.web에는 본문이 없으며, 본문을 담는 retrievedContext는 Vertex AI Search
  // 전용이라 googleSearch 경로에서는 비어 있다. 그래서 quote는 사람의 눈 검증에 넘긴다.
  const dropped: string[] = [];
  const candidates = draft.candidates
    .map((candidate) => resolveCandidate(candidate, citations, dropped))
    .filter((candidate): candidate is Opportunity => candidate !== null);

  if (dropped.length > 0) {
    deps.log?.(
      `[trend-scout] 알 수 없는 인용 참조 ${dropped.length}건을 드롭했다: ${dropped.join(", ")}`,
    );
  }
  deps.log?.(
    `[trend-scout] 후보 ${candidates.length}건 (인용 ${citations.length}건 기준)`,
  );

  return { candidates, scope: scopeLabel, searchedAt };
}
