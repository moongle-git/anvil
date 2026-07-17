import type { GeminiService } from "../services/gemini.js";
import {
  buildLedger,
  type LedgerEntry,
  RECOMMENDATION_SCORE_BANDS,
  REMEDY_STRATEGY_LABELS,
  verdictSchemaFor,
  type Criticism,
  toPromptContext,
  type MarketContext,
  type Recommendation,
  type Solution,
  type Thesis,
  type Verdict,
} from "../types/index.js";

/** usage 집계 라벨 = 파이프라인 step 이름 (ADR-016) */
export const VERDICT_USAGE_LABEL = "verdict";

/**
 * thinking 상한 (ADR-016). 2048 — 판정 품질 때문에 별도 에이전트로 분리한 만큼(ADR-010)
 * thinking을 끄지는 않는다. 끄는 것과 상한을 두는 것은 다르다.
 */
export const VERDICT_THINKING_BUDGET = 2048;

/** 밴드는 스키마의 refine이 검증한다. 프롬프트가 같은 숫자를 말해야 재시도 루프가 돌지 않는다. */
function band(recommendation: Recommendation): string {
  const { min, max } = RECOMMENDATION_SCORE_BANDS[recommendation];
  return `${min}~${max}`;
}

export const VERDICT_SYSTEM_PROMPT = `당신은 앞선 네 단계 — 시장 맥락(MarketContext) / 正 낙관 논제(Thesis) / 反 냉정한 비판(Criticism) / 合 피벗 재설계(Solution) — 를 모두 읽은 최종 심사역이다.
당신은 낙관론자도 비판가도 아니다. 어느 한쪽 편을 들지 않으며, 앞 네 단계를 종합해 최종 생존 가능성만 판정한다.

## 판정 대상은 원본 아이디어가 아니라 合의 재설계안(solution.revisedConcept)이다
이것이 당신이 존재하는 이유다. 원본 아이디어를 채점하지 마라. 反이 이미 원본을 난도질했고, 合은 그 비판을 딛고 피벗했다.
당신이 할 일은 criticism.points의 비판 각각에 대해 合이 실제로 그것을 **방어**(취약점을 구조적으로 제거)했는지, **우회**(비판이 성립하는 전장을 떠나 같은 자산으로 다른 가치를 판매)했는지 검증하는 것이다.
- 당신이 solid로 감사한 항목(아래 "결함↔해결책 감사")은 해소된 것이다. 그 항목으로 재설계안을 감점하지 마라.
- 방어되지 않은 비판, 그리고 피벗이 **새로 만들어낸** 리스크만이 잔존 리스크다.

## 결함↔해결책 감사 (remedyAudits)
유저 프롬프트에는 코드가 비판과 재설계를 대조해 만든 표가 있다. 비판이 fatal로 판정한 항목 **각각**에 대해 remedyAudits에 항목을 하나씩 만들어라. 하나라도 빠지면 출력은 검증에 실패해 폐기된다.
- **criticismId** — 감사 대상 비판의 id를 그대로 옮겨 적는다. 표에 없는 id를 지어내지 마라.
- **assessment** — 재설계가 그 결함에 내놓은 답이 아래 셋 중 무엇인지 고른다.
  - **solid**(유효한 해결책) — 비판이 지적한 취약점을 실제로 제거했거나, 비판이 성립하는 전장을 실제로 떠났다.
  - **restated**(재주장) — 비판이 이미 반박한 것을 **수식어만 붙여** 다시 제시했다. 비판이 "AI 품질 예측은 허상"이라 했는데 재설계가 "경량화된 AI 품질 예측"이라 답하면 재주장이다. 비판의 논거를 건드리지 않았다면 재주장이다.
  - **dismissed**(비판 기각) — 풀지 않고 비판이 과장·기우라며 넘어갔다. "그 우려는 과장됐다", "전반적 신뢰 구축으로 포괄한다"가 여기 해당한다. 표에 "해결책 없음"으로 적힌 항목도 dismissed다 — 아무 말도 하지 않은 것은 푼 것이 아니다.
- **note** — 왜 그렇게 판정했는지 한 문장.
셋 중 무엇을 고르든 그것은 리포트에 당신의 이름으로 렌더된다. 곤란한 항목에 solid를 적어 넘어가지 마라.

## survivalScore와 recommendation
survivalScore는 0~100의 정수이며, recommendation은 아래 밴드를 반드시 지켜야 한다. 어기면 출력이 검증에 실패해 폐기된다.
- abandon — survivalScore ${band("abandon")}
- pivot — survivalScore ${band("pivot")}
- proceed — survivalScore ${band("proceed")}

성공 확률을 부풀리지 마라. 점수는 당신의 판단이다 — 위 감사에서 무엇을 solid라 불렀고 무엇을 restated·dismissed라 불렀는지가 그 판단의 근거로 남는다.

## 작성 항목
1. **headline** — 판정의 결론을 담은 **한 문장**. 리포트에서 가장 큰 글씨로 노출된다. 조건절을 늘어놓지 말고 단정하라.
2. **rationale** — 왜 그 survivalScore인지 설명하는 종합 결론 단락. 네 단계(시장 맥락·正·反·合)를 각각 인용해 근거를 대라. 어느 비판이 방어됐고 어느 비판이 살아남았는지 밝혀라.
3. **residualRisks** — 合의 피벗 이후에도 남는 리스크. criticism.points를 그대로 옮겨 적지 마라. 방어된 항목은 제외하고, 방어되지 않았거나 피벗이 새로 만든 리스크만 남긴다.
   - **keyword** — 2~10자의 짧은 명사구. 문장을 쓰지 마라.
   - **severity** — fatal / major / minor 중 하나.
   - **note** — 왜 이 리스크가 피벗 이후에도 남는지 한 문장으로 설명한다.
   - **criticismId** — 그 리스크가 특정 비판에서 유래했다면 그 비판의 id를 밝힌다. 피벗이 새로 만든 리스크는 어느 비판에도 속하지 않으므로 비워 둔다.
4. **conditions** — "이 조건이 충족되면 생존한다"는 검증 가능한 조건 목록. 각 항목은 기한·수치를 포함한 실행 가능한 형태여야 한다(예: "출시 6개월 내 리텐션 D30 20% 확보").
   희망 사항("좋은 팀을 꾸린다", "마케팅을 잘한다")을 쓰지 마라. 참·거짓을 판정할 수 없는 문장은 조건이 아니다.`;

export const VERDICT_PROMPT_TEMPLATE = `## 아이디어 원문
{idea}

## 1단계: 시장 맥락 (MarketContext — Context Hunter가 수집한 실제 데이터)
\`\`\`json
{marketContext}
\`\`\`

## 2단계: 낙관적 논제 (正, Thesis)
\`\`\`json
{thesis}
\`\`\`

## 3단계: 냉정한 반론 (反, Criticism)
\`\`\`json
{criticism}
\`\`\`

## 4단계: 종합과 재설계 (合, Solution)
\`\`\`json
{solution}
\`\`\`

{fatalLedger}## 지시사항
1. 판정 대상은 원본 아이디어가 아니라 위 4단계의 solution.revisedConcept다.
2. criticism.points의 비판 각각에 대해 合이 그것을 방어했는지·우회했는지·놓쳤는지 판별하라.
3. 비판이 fatal로 판정한 항목(위 대조표) 각각에 대해 remedyAudits 항목을 하나씩 만들어라 — criticismId에 그 비판의 id를, assessment에 solid·restated·dismissed 중 하나를, note에 그렇게 판정한 이유를 쓴다. 하나라도 빠지면 검증에 실패한다.
4. 놓친 비판과 피벗이 새로 만든 리스크만 residualRisks에 남기고, survivalScore와 recommendation을 밴드에 맞춰 판정하라.
5. rationale에 어느 비판이 해소되고 어느 비판이 살아남았는지 근거와 함께 밝혀라.`;

/**
 * 코드가 두 산출물을 대조해 만든 fatal 원장 표.
 *
 * 프롬프트는 이미 criticism·solution JSON을 통째로 갖고 있는데도 이 표가 중복이 아닌 이유는
 * **부재** 때문이다 — "c5에 해결책이 없다"는 어느 JSON에도 적혀 있지 않고 두 문서 *사이*의
 * 빈틈으로만 존재한다. 그것을 알려면 신뢰할 수 있는 집합 뺄셈이 필요하고, 그 뺄셈이 정확히
 * 판정이 실패해온 지점이다 (ADR-017). 그래서 코드가 대신 해준다.
 *
 * 뺄셈 자체는 buildLedger(types/)가 소유한다 — 판정 에이전트가 자기 몫의 집합 연산을 따로
 * 구현하면 리포트 렌더러와 두 개의 진실이 생긴다.
 *
 * 해결책 칸은 재설계의 **자기보고**이지 사실이 아니므로 "주장"으로만 귀속한다. 코드가 증명할 수
 * 있는 것은 부재 하나뿐이다.
 */
function renderFatalLedger(entries: readonly LedgerEntry[]): string {
  if (entries.length === 0) return ""; // fatal이 없으면 빈 표를 렌더하지 않는다

  // JSON.stringify로 감싼다 — claim·remedy의 줄바꿈이 표의 행을 무너뜨리는 것을 막는다
  const rows = entries.map(({ point, remedy }) => {
    const answer = remedy
      ? `재설계의 해결책 주장(${REMEDY_STRATEGY_LABELS[remedy.strategy]}): ${JSON.stringify(remedy.remedy)}`
      : "**해결책 없음 — 재설계는 이 결함에 대해 아무 말도 하지 않았다**";
    return `| ${point.id} | ${point.riskKeyword} | 비판: ${JSON.stringify(point.claim)} | ${answer} |`;
  });

  return `## 비판이 치명적으로 판정한 항목과 재설계의 해결책 (코드가 두 산출물을 대조해 만든 표다)
${rows.join("\n")}

"재설계의 해결책"은 재설계의 자기보고이지 사실이 아니다. 유효한지 검증하는 것이 당신의 일이다.
코드가 확인한 사실은 "해결책 없음" 하나뿐이다.

`;
}

export interface VerdictDeps {
  gemini: GeminiService;
}

export async function runVerdict(
  deps: VerdictDeps,
  idea: string,
  context: MarketContext,
  thesis: Thesis,
  criticism: Criticism,
  solution: Solution,
): Promise<Verdict> {
  const fatalLedger = buildLedger(criticism, solution).filter(
    (entry) => entry.point.severity === "fatal",
  );

  // minify한다 — 들여쓰기 공백·줄바꿈도 입력 토큰으로 과금된다 (ADR-016)
  const prompt = VERDICT_PROMPT_TEMPLATE.replace("{idea}", idea)
    .replace("{marketContext}", JSON.stringify(toPromptContext(context)))
    .replace("{thesis}", JSON.stringify(thesis))
    .replace("{criticism}", JSON.stringify(criticism))
    .replace("{solution}", JSON.stringify(solution))
    .replace("{fatalLedger}", renderFatalLedger(fatalLedger));

  return deps.gemini.generateStructured({
    systemInstruction: VERDICT_SYSTEM_PROMPT,
    prompt,
    usageLabel: VERDICT_USAGE_LABEL,
    thinkingBudget: VERDICT_THINKING_BUDGET,
    // 정적 스키마가 아니라 criticism을 아는 팩토리다 — fatal 감사 누락은 여기서 검증에 실패하고,
    // 빠진 id를 지목하는 에러가 그대로 자가 교정 재시도의 피드백이 된다 (ADR-017 / ADR-004)
    schema: verdictSchemaFor(criticism),
  });
}
