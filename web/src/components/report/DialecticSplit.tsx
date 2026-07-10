import {
  DIALECTIC_AXES,
  DIALECTIC_AXIS_LABELS,
  type Criticism,
  type CriticismPoint,
  type Thesis,
  type ThesisPoint,
} from "@anvil/types";
import { Badge, Card, Collapsible, EmptyState } from "@/components/ui";
import { renderInline, renderRichText } from "@/lib/richText";
import {
  buildRiskProfile,
  groupPointsByAxis,
  indexById,
  maxSeverity,
} from "@/lib/risk";
import { RiskRadar } from "./RiskRadar";
import { RiskScoreBadge } from "./RiskScoreBadge";

interface DialecticSplitProps {
  thesis?: Thesis;
  criticism?: Criticism;
}

const COLUMN_HEADING = "scroll-mt-6 text-xl font-semibold text-neutral-900";
const AXIS_HEADING = "text-base font-semibold text-neutral-900";
const CARD_HEADING = "text-base font-semibold text-neutral-900";
// 헤더 행·리드 행·축 행이 같은 그리드 규격을 공유해야 컬럼이 세로로 정렬된다
const SPLIT_GRID = "grid grid-cols-1 gap-4 lg:grid-cols-2 lg:gap-10";
const LIST = "list-disc space-y-2 pl-5 text-[15px] leading-[1.8] text-neutral-700 marker:text-neutral-400";

function ThesisCard({ point }: { point: ThesisPoint }) {
  return (
    <Card
      data-thesis-id={point.id}
      data-axis={point.axis}
      className="flex flex-col gap-3"
    >
      <h4 className={CARD_HEADING}>{renderInline(point.claim)}</h4>
      {/* 근거는 기본 접힘 — 주장 먼저 훑고 필요할 때 펼치는 스캔 동선(PRD) */}
      <Collapsible summary="근거 보기">
        {renderRichText(point.rationale)}
      </Collapsible>
    </Card>
  );
}

function CriticismCard({
  point,
  rebuttedClaim,
}: {
  point: CriticismPoint;
  // 유효한 rebuts가 가리키는 正의 claim. 끊어진 참조·thesis 부재 시 undefined.
  rebuttedClaim?: string;
}) {
  return (
    <Card
      data-criticism-id={point.id}
      data-axis={point.axis}
      data-rebuts={point.rebuts}
      className="flex flex-col gap-3"
    >
      <span>
        <RiskScoreBadge
          severity={point.severity}
          score={point.riskScore}
          keyword={point.riskKeyword}
        />
      </span>
      <h4 className={CARD_HEADING}>{renderInline(point.claim)}</h4>
      {rebuttedClaim !== undefined ? (
        <p className="border-l-2 border-neutral-300 pl-3 text-sm text-neutral-500">
          이 낙관을 반박: {renderInline(rebuttedClaim)}
        </p>
      ) : null}
      <Collapsible summary="근거 보기">
        {renderRichText(point.evidence)}
      </Collapsible>
    </Card>
  );
}

// 모바일에서 어느 쪽 주장인지 알리는 칩. 데스크톱은 컬럼 헤더가 그 역할을 하므로 lg:hidden.
function SideChip({ children }: { children: React.ReactNode }) {
  return (
    <Badge tone="neutral" className="w-fit lg:hidden">
      {children}
    </Badge>
  );
}

function ThesisNarrative({ thesis }: { thesis: Thesis }) {
  return (
    <Collapsible summary="正의 서사 보강 — 수익 모델 · 성장 지렛대 · 시장 순풍 · 최상 시나리오">
      <div className="flex flex-col gap-6">
        <div className="flex flex-col gap-2">
          <h3 className={AXIS_HEADING}>수익 모델</h3>
          {renderRichText(thesis.revenueModel)}
        </div>
        <div className="flex flex-col gap-2">
          <h3 className={AXIS_HEADING}>성장 지렛대</h3>
          <ul className={LIST}>
            {thesis.growthLevers.map((lever) => (
              <li key={lever}>{renderInline(lever)}</li>
            ))}
          </ul>
        </div>
        <div className="flex flex-col gap-2">
          <h3 className={AXIS_HEADING}>시장 순풍</h3>
          <ul className={LIST}>
            {thesis.marketTailwinds.map((tailwind) => (
              <li key={tailwind}>{renderInline(tailwind)}</li>
            ))}
          </ul>
        </div>
        <div className="flex flex-col gap-2">
          <h3 className={AXIS_HEADING}>최상 시나리오</h3>
          {renderRichText(thesis.bestCaseScenario)}
        </div>
      </div>
    </Collapsible>
  );
}

// 正(낙관 가설)과 反(냉정한 비판)을 공유 축 위에 좌우로 대립시킨다 (PRD Split View).
// 행 정렬 기준은 axis다 — rebuts는 optional·1:N이라 정렬에 쓰지 않고 칩 하나로만 붙인다.
export function DialecticSplit({ thesis, criticism }: DialecticSplitProps) {
  // 구버전 run은 스키마 검증에 실패해 두 필드가 모두 생략된다 (ADR-011)
  if (thesis === undefined && criticism === undefined) {
    return (
      <section
        id="dialectic"
        aria-label="정반합 (正 / 反)"
        className="max-w-5xl"
      >
        <EmptyState
          title="정반합 데이터가 없습니다"
          description="이 실행에는 낙관 가설·비판 산출물이 포함되어 있지 않습니다."
        />
      </section>
    );
  }

  const thesisGrouped =
    thesis !== undefined ? groupPointsByAxis(thesis.points) : undefined;
  const criticismGrouped =
    criticism !== undefined ? groupPointsByAxis(criticism.points) : undefined;
  const thesisById =
    thesis !== undefined ? indexById(thesis.points) : undefined;

  return (
    <section
      id="dialectic"
      aria-labelledby="thesis antithesis"
      className="flex max-w-5xl flex-col gap-8"
    >
      {/* 컬럼 헤더 */}
      <div className={SPLIT_GRID}>
        <h2 id="thesis" className={COLUMN_HEADING}>
          ② 낙관적 가설 (正)
        </h2>
        <h2 id="antithesis" className={COLUMN_HEADING}>
          ③ 냉정한 비판 (反)
        </h2>
      </div>

      {/* 리드 행: 正의 핵심 논지 vs 反의 소결론 + 리스크 레이더 */}
      <div className={SPLIT_GRID}>
        {thesis !== undefined ? (
          <Card className="flex flex-col gap-2 border-neutral-900">
            <span className="text-sm font-medium text-neutral-500">
              핵심 논지
            </span>
            {renderRichText(thesis.winningThesis)}
          </Card>
        ) : (
          <EmptyState
            title="낙관 가설 데이터가 없습니다"
            description="이 실행에는 낙관 가설 산출물이 포함되어 있지 않습니다."
          />
        )}

        {criticism !== undefined ? (
          <div className="flex flex-col gap-4">
            {/* criticism.verdict는 反 섹션의 소결론이지 최종 판정이 아니다 (ADR-010) */}
            <div className="border-l-2 border-neutral-300 bg-neutral-50 p-4">
              <p className="text-sm font-medium text-neutral-500">
                反의 소결론
              </p>
              <div className="mt-2">{renderRichText(criticism.verdict)}</div>
            </div>
            <RiskRadar
              profile={buildRiskProfile(criticism)}
              maxSeverity={maxSeverity(criticism)}
            />
          </div>
        ) : (
          <EmptyState
            title="비판 데이터가 없습니다"
            description="이 실행에는 비판 산출물이 포함되어 있지 않습니다."
          />
        )}
      </div>

      {/* 축 행 × 3 (DIALECTIC_AXES 순서) — 같은 축의 正/反이 좌우로 나란히 놓인다 */}
      {DIALECTIC_AXES.map((axis) => (
        <div key={axis} data-axis-row={axis} className="flex flex-col gap-4">
          <h3 className={AXIS_HEADING}>{DIALECTIC_AXIS_LABELS[axis]}</h3>
          <div className={SPLIT_GRID}>
            <div className="flex flex-col gap-3">
              {thesisGrouped !== undefined ? (
                <>
                  <SideChip>正 (낙관)</SideChip>
                  {thesisGrouped[axis].map((point) => (
                    <ThesisCard key={point.id} point={point} />
                  ))}
                </>
              ) : null}
            </div>
            <div className="flex flex-col gap-3">
              {criticismGrouped !== undefined ? (
                <>
                  <SideChip>反 (비판)</SideChip>
                  {criticismGrouped[axis].map((point) => (
                    <CriticismCard
                      key={point.id}
                      point={point}
                      rebuttedClaim={
                        point.rebuts !== undefined
                          ? thesisById?.get(point.rebuts)?.claim
                          : undefined
                      }
                    />
                  ))}
                </>
              ) : null}
            </div>
          </div>
        </div>
      ))}

      {/* 正의 서사 보강 — 부가 근거라 아코디언으로 접는다 */}
      {thesis !== undefined ? <ThesisNarrative thesis={thesis} /> : null}
    </section>
  );
}
