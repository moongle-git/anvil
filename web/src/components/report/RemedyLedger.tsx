import {
  fatalLedger,
  REMEDY_STRATEGY_LABELS,
  REMEDY_VERDICT_LABELS,
  REMEDY_VERDICTS,
  type Criticism,
  type LedgerEntry,
  type RemedyVerdict,
  type Solution,
  type Verdict,
} from "@anvil/types";
import { Badge, type BadgeTone } from "@/components/ui";
import { renderInline, renderRichText } from "@/lib/richText";

// 감사 결과 → 시맨틱 톤. 새 색이 아니라 기존 Badge 톤을 재사용한다 — VerdictSection의
// RECOMMENDATION_TONES와 같은 규율이다 (UI_GUIDE: 색은 데이터의 의미에만 쓴다).
const ASSESSMENT_TONES: Record<RemedyVerdict, BadgeTone> = {
  solid: "success",
  restated: "warning",
  dismissed: "danger",
};

/** 침묵과 해결책을 같은 자리에서 읽히게 하는 머리말. 라벨은 src/types가 단일 소스다 */
function remedyHead(entry: LedgerEntry): string {
  return entry.remedy === undefined
    ? "해결책 없음"
    : REMEDY_STRATEGY_LABELS[entry.remedy.strategy];
}

/**
 * 4절(合)의 해결책 블록. **verdict를 인자로 받지 않는다** — 넘길 수 없는 것은 새어 나갈 수도
 * 없다. "재주장" 칩이 4절에 뜨면 독자가 5절 전에 결론을 알게 되고, 그 순간 正/反 대립은 읽을
 * 이유가 없는 장식이 된다 (ADR-008). report.ts의 remedySection과 같은 구조적 방어다.
 */
export function RemedyClaims({
  criticism,
  solution,
}: {
  criticism: Criticism;
  solution: Solution;
}) {
  const entries = fatalLedger(criticism, solution);
  if (entries.length === 0) return null;

  return (
    <div className="flex flex-col gap-3" data-remedy-claims>
      <h3 className="text-base font-semibold text-neutral-900">
        치명적 결함에 대한 해결책 (재설계의 주장 · 미검증)
      </h3>
      {/* 레일 인용 — 배경 없는 인용 규격(py-1 pl-4). 자기보고임을 밝히되 결과는 누설하지 않는다 */}
      <p className="border-l-2 border-neutral-300 py-1 pl-4 text-[15px] leading-[1.8] text-neutral-700">
        아래는 재설계가 스스로 낸 대응이지 검증된 사실이 아닙니다. 유효한지는 5절
        최종 판정이 항목별로 감사합니다.
      </p>
      <ul className="flex flex-col gap-4">
        {entries.map(({ point, remedy }) => (
          <li
            key={point.id}
            data-criticism-id={point.id}
            className="flex flex-col gap-1"
          >
            {/* 뱃지 + 키워드 한 줄, 그 아래 본문 — VerdictSection의 잔존 리스크와 같은 골격 */}
            <div className="flex items-center gap-2">
              {/* 방어/우회는 severity도 run 상태도 아니다 — 색을 주면 없는 의미를 만든다 */}
              <Badge tone="neutral" data-remedy-strategy={remedy?.strategy}>
                {remedyHead({ point, remedy })}
              </Badge>
              <span className="text-sm font-medium text-neutral-700">
                {point.riskKeyword}
              </span>
            </div>
            <p className="text-[15px] leading-[1.8] text-neutral-700">
              {renderInline(point.claim)}
            </p>
            {remedy === undefined ? (
              // 침묵은 두 문서 간의 집합 뺄셈이라 코드가 증명할 수 있는 사실이다. 그러나 그것을
              // 실패라 부르는 것은 판단이고, 판단은 5절의 몫이다 (ADR-008 / ADR-017)
              <p className="text-[15px] leading-[1.8] text-neutral-500">
                재설계는 이 결함에 대해 아무 말도 하지 않았습니다.
              </p>
            ) : (
              renderRichText(remedy.remedy)
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** 요약 줄의 숫자는 전부 원장에서 파생된다 — 따로 세면 표와 어긋나는 두 번째 진실이 생긴다 */
function ledgerSummary(entries: readonly LedgerEntry[]): string {
  const remedied = entries.filter((entry) => entry.remedy !== undefined).length;
  const audited = REMEDY_VERDICTS.map((assessment) => ({
    assessment,
    count: entries.filter((entry) => entry.audit?.assessment === assessment)
      .length,
  }))
    .filter(({ count }) => count > 0)
    .map(
      ({ assessment, count }) => `${REMEDY_VERDICT_LABELS[assessment]} ${count}`,
    );
  const breakdown = audited.length > 0 ? ` (${audited.join(" · ")})` : "";
  return `비판이 제기한 치명적 결함 ${entries.length}건 → 해결책 ${remedied}건${breakdown}`;
}

/**
 * 5절(판정)의 원장 — 잔존 리스크 앞에 온다. 결함↔해결책 쌍은 부록이 아니라 판정의 근거다 (PRD).
 * 감사 결과가 처음이자 유일하게 등장하는 곳이 여기다.
 */
export function RemedyLedgerTable({
  criticism,
  solution,
  verdict,
}: {
  criticism: Criticism;
  solution?: Solution;
  verdict: Verdict;
}) {
  const entries = fatalLedger(criticism, solution, verdict);
  if (entries.length === 0) return null;

  // 감사가 하나도 없는 run(원장 계약 이전에 저장된 판정)에서는 감사 열을 통째로 뺀다 —
  // 전부 "—"인 열은 정보가 아니라 잡음이다. 한 건이라도 있으면 열을 두고 빈 칸만 "—"로 남긴다.
  const hasAudits = entries.some((entry) => entry.audit !== undefined);

  return (
    <div className="flex flex-col gap-3" data-remedy-ledger>
      <h3 className="text-base font-semibold text-neutral-900">
        결함↔해결책 원장
      </h3>
      <p className="text-[15px] leading-[1.8] text-neutral-700">
        {ledgerSummary(entries)}
      </p>
      {/* 좁은 화면에서 넘치지 않게 — CompetitorTable과 같은 반응형 골격 */}
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-left text-[15px] text-neutral-700">
          <thead>
            <tr className="border-b border-neutral-200 text-xs font-medium text-neutral-500">
              <th className="py-2 pr-4 font-medium">비판</th>
              <th className="py-2 pr-4 font-medium">재설계의 해결책</th>
              {hasAudits ? (
                <th className="py-2 font-medium">판정의 감사</th>
              ) : null}
            </tr>
          </thead>
          <tbody>
            {entries.map(({ point, remedy, audit }) => (
              <tr
                key={point.id}
                data-criticism-id={point.id}
                className="border-b border-neutral-100 align-top"
              >
                <td className="py-3 pr-4">
                  <span className="font-medium text-neutral-900">
                    {point.riskKeyword}
                  </span>
                  <span className="block">{renderInline(point.claim)}</span>
                </td>
                <td className="py-3 pr-4">
                  {remedy === undefined ? (
                    <span className="text-neutral-500">해결책 없음</span>
                  ) : (
                    <>
                      <Badge tone="neutral" data-remedy-strategy={remedy.strategy}>
                        {REMEDY_STRATEGY_LABELS[remedy.strategy]}
                      </Badge>
                      <span className="mt-1 block">
                        {renderInline(remedy.remedy)}
                      </span>
                    </>
                  )}
                </td>
                {hasAudits ? (
                  <td className="py-3">
                    {audit === undefined ? (
                      // 감사 부재는 판정이 이 항목을 봐주고 넘어간 것이 아니라, 판정이 아직
                      // 이 결함을 감사하지 않았다는 뜻이다 — 실패로 낙인찍지 않는다
                      <span className="text-neutral-400">—</span>
                    ) : (
                      <>
                        <Badge
                          tone={ASSESSMENT_TONES[audit.assessment]}
                          data-remedy-assessment={audit.assessment}
                        >
                          {REMEDY_VERDICT_LABELS[audit.assessment]}
                        </Badge>
                        <span className="mt-1 block">
                          {renderInline(audit.note)}
                        </span>
                      </>
                    )}
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
