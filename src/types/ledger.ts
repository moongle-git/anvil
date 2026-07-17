import type { Criticism, CriticismPoint } from "./criticism.js";
import { type CriticismSeverity } from "./dialectic.js";
import type { RemedyStrategy, Solution } from "./solution.js";
import type { RemedyVerdict, Verdict } from "./verdict.js";

/**
 * 合의 원장(remedies)과 판정의 감사(remedyAudits)가 공유하는 어휘 (ADR-017).
 *
 * 코드가 소유하는 것은 셋뿐이다 — 참조 무결성("c99라는 비판은 없다"), 침묵("c5에 대해 아무도
 * 말하지 않았다"), 귀속("c3를 우회했다고 이런 말로 주장했다"). 전부 두 문서 간의 집합 연산이라
 * 증명 가능하다. "이 해결책이 유효한가"는 어떤 API 응답에도 없어 주입할 사실이 존재하지 않으므로,
 * 그 판단은 판정 에이전트에 남는다.
 *
 * severity가 criticism.ts가 아니라 dialectic.ts에 사는 것과 같은 이유로 이 파일이 있다:
 * solution.ts와 verdict.ts가 같은 검사를 쓰는데, 한쪽에 두면 하류끼리 서로를 알게 된다.
 */

/** severity가 fatal인 point의 id — 원래 순서를 유지한다 */
export function fatalIds(points: readonly CriticismPoint[]): string[] {
  return points.filter((point) => point.severity === "fatal").map((p) => p.id);
}

/** criticism에 없는 id를 참조했는가 (참조 무결성). 같은 id는 한 번만 보고한다 */
export function danglingRefs(
  refs: readonly string[],
  points: readonly CriticismPoint[],
): string[] {
  const known = new Set(points.map((point) => point.id));
  return [...new Set(refs)].filter((ref) => !known.has(ref));
}

/** 아무도 언급하지 않은 fatal이 있는가 (침묵) */
export function uncoveredFatalIds(
  refs: readonly string[],
  points: readonly CriticismPoint[],
): string[] {
  const referenced = new Set(refs);
  return fatalIds(points).filter((id) => !referenced.has(id));
}

/** 한 비판을 두 번 이상 참조했는가. 비판 하나에 해결책·감사는 하나다 */
export function duplicateRefs(refs: readonly string[]): string[] {
  const seen = new Set<string>();
  const duplicated = new Set<string>();
  for (const ref of refs) {
    if (seen.has(ref)) duplicated.add(ref);
    seen.add(ref);
  }
  return [...duplicated];
}

/** 비판 하나와 그에 대한 해결책·감사를 짝지은 한 행 */
export interface LedgerEntry {
  /** 비판 원문 */
  point: CriticismPoint;
  /** undefined = 재설계의 침묵 */
  remedy?: { strategy: RemedyStrategy; remedy: string };
  /** undefined = 판정 이전 */
  audit?: { assessment: RemedyVerdict; note: string };
}

const SEVERITY_RANK: Record<CriticismSeverity, number> = {
  fatal: 0,
  major: 1,
  minor: 2,
};

/**
 * 원장을 렌더하는 쪽(report.md · 웹 리포트)이 공유하는 뷰 (ADR-017).
 *
 * fatal만 싣는 이유: 전건 커버리지를 강제받는 것이 fatal뿐이고(major·minor는 허용하되
 * 강제하지 않는다), PRD의 5절 원장 규격도 치명적 결함만을 대상으로 쓴다.
 *
 * 원장이 통째로 비면 빈 배열을 돌려주고 호출부가 블록을 생략한다. 구 run은 원장 계약 이전에
 * 저장됐을 뿐인데 fatal마다 "해결책 없음"을 찍으면 있지도 않은 침묵을 지어내는 셈이다 —
 * researchCoverage가 비면 커버리지 블록을 통째로 생략하는 것과 같은 태도다 (ADR-013).
 *
 * buildLedger 옆에 사는 이유는 이 규칙이 렌더러마다 갈리면 안 되기 때문이다. report.md에서는
 * 생략되는 구 run이 웹에서는 "해결책 없음" 표로 뜨는 것은 두 개의 진실이다.
 */
export function fatalLedger(
  criticism: Criticism,
  solution?: Solution,
  verdict?: Verdict,
): LedgerEntry[] {
  // buildLedger와 같은 방어 — 렌더링은 검증기가 아니다. 스키마를 거친 산출물은 .default([])로
  // 항상 배열이지만, 원장을 그리려다 화면을 터뜨리는 것은 아무에게도 도움이 되지 않는다.
  const remedyCount = (solution?.remedies ?? []).length;
  const auditCount = (verdict?.remedyAudits ?? []).length;
  if (remedyCount === 0 && auditCount === 0) return [];
  return buildLedger(criticism, solution, verdict).filter(
    (entry) => entry.point.severity === "fatal",
  );
}

/**
 * 리포트·웹이 함께 쓰는 순수 파생. 강제 대상인 fatal은 해결책이 없어도(침묵) 행으로 남고,
 * 강제 대상이 아닌 major·minor는 누군가 언급했을 때만 오른다.
 *
 * criticism에 없는 id를 참조하는 해결책·감사는 **조용히 드롭한다** — report.ts가 dangling
 * rebuts를 다루는 태도와 같다. 렌더링은 검증기가 아니다. 그 참조를 막는 것은 스키마 팩토리의 일이고,
 * 원장 없이 저장된 구 run을 화면에서 터뜨리는 것은 아무에게도 도움이 되지 않는다.
 */
export function buildLedger(
  criticism: Criticism,
  solution?: Solution,
  verdict?: Verdict,
): LedgerEntry[] {
  const remedies = new Map(
    (solution?.remedies ?? []).map((r) => [
      r.respondsTo,
      { strategy: r.strategy, remedy: r.remedy },
    ]),
  );
  const audits = new Map(
    (verdict?.remedyAudits ?? []).map((a) => [
      a.criticismId,
      { assessment: a.assessment, note: a.note },
    ]),
  );

  return criticism.points
    .map((point, order) => ({
      order,
      entry: {
        point,
        remedy: remedies.get(point.id),
        audit: audits.get(point.id),
      } satisfies LedgerEntry,
    }))
    .filter(
      ({ entry }) =>
        entry.point.severity === "fatal" ||
        entry.remedy !== undefined ||
        entry.audit !== undefined,
    )
    .sort(
      (a, b) =>
        SEVERITY_RANK[a.entry.point.severity] -
          SEVERITY_RANK[b.entry.point.severity] || a.order - b.order,
    )
    .map(({ entry }) => entry);
}
