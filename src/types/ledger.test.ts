import { describe, expect, it } from "vitest";
import type { Criticism, CriticismPoint } from "./criticism.js";
import {
  buildLedger,
  danglingRefs,
  duplicateRefs,
  fatalIds,
  fatalLedger,
  uncoveredFatalIds,
} from "./ledger.js";
import type { Solution } from "./solution.js";
import type { Verdict } from "./verdict.js";

const minorPoint: CriticismPoint = {
  id: "c1",
  axis: "painPoint",
  claim: "'니스칠 사과' 품질 우려는 소수 사례다",
  evidence: "커뮤니티 언급 빈도가 낮다",
  severity: "minor",
  riskScore: 20,
  riskKeyword: "품질 우려",
};

const fatalBmPoint: CriticismPoint = {
  id: "c2",
  axis: "bm",
  claim: "무료 대안이 지불 의사를 잠식한다",
  evidence: "YouTube 댓글 다수가 '무료 앱으로 충분하다'고 말한다",
  severity: "fatal",
  riskScore: 75,
  riskKeyword: "무료 대체재",
};

const fatalCopycatPoint: CriticismPoint = {
  id: "c3",
  axis: "copycat",
  claim: "대기업이 기능을 복제하면 해자가 사라진다",
  evidence: "경쟁사가 이미 유사 기능을 출시했다",
  severity: "fatal",
  riskScore: 85,
  riskKeyword: "해자 부재",
};

const criticism: Criticism = {
  points: [minorPoint, fatalBmPoint, fatalCopycatPoint],
  verdict: "현재 형태로는 무료 대안과 차별화되지 않는다.",
};

const solution: Solution = {
  minimalInput: "사진 한 장만 올린다.",
  agenticWorkflow: "진단 에이전트가 상태를 분석한다.",
  dataFlywheel: "케어 성공/실패 데이터를 축적한다.",
  monetization: "성과 보장형 구독.",
  revisedConcept: "사진 한 장으로 시작하는 자율 케어 에이전트.",
  synthesis: "무료 대안과 같은 전장을 떠나 성과 자체를 판다.",
  remedies: [
    {
      respondsTo: "c3",
      strategy: "defend",
      remedy: "농가 '품질 지문' 데이터 플라이휠로 복제 불가능한 자산을 만든다.",
    },
    {
      respondsTo: "c2",
      strategy: "bypass",
      remedy: "구독이 아니라 측정된 성과에 과금해 무료 대안과 경쟁하지 않는다.",
    },
  ],
};

const verdict: Verdict = {
  survivalScore: 65,
  recommendation: "pivot",
  headline: "데이터 플라이휠이 성립해야 산다.",
  rationale: "무료 대안 문제는 우회했으나 해자는 아직 가설이다.",
  residualRisks: [
    {
      keyword: "데이터 확보",
      severity: "major",
      note: "초기 농가 확보 없이는 플라이휠이 돌지 않는다",
      criticismId: "c3",
    },
  ],
  conditions: ["6개월 내 농가 50곳 확보"],
  remedyAudits: [
    {
      criticismId: "c3",
      assessment: "solid",
      note: "복제 비용을 실제로 올리는 구조적 해결책이다.",
    },
    {
      criticismId: "c2",
      assessment: "restated",
      note: "'성과 과금'은 지불 의사 부재를 다시 말한 것에 가깝다.",
    },
  ],
};

describe("fatalIds", () => {
  it("severity가 fatal인 point의 id만 원래 순서로 돌려준다", () => {
    expect(fatalIds(criticism.points)).toEqual(["c2", "c3"]);
  });

  it("fatal이 없으면 빈 배열이다", () => {
    expect(fatalIds([minorPoint])).toEqual([]);
  });
});

describe("danglingRefs", () => {
  it("criticism에 없는 id만 골라낸다", () => {
    expect(danglingRefs(["c2", "c99"], criticism.points)).toEqual(["c99"]);
  });

  it("모든 ref가 실재하면 빈 배열이다", () => {
    expect(danglingRefs(["c1", "c2", "c3"], criticism.points)).toEqual([]);
  });

  it("같은 dangling id가 여러 번 참조돼도 한 번만 보고한다", () => {
    expect(danglingRefs(["c99", "c99"], criticism.points)).toEqual(["c99"]);
  });
});

describe("uncoveredFatalIds", () => {
  it("아무도 언급하지 않은 fatal id를 돌려준다 (침묵)", () => {
    expect(uncoveredFatalIds(["c2"], criticism.points)).toEqual(["c3"]);
  });

  it("fatal이 전부 언급되면 빈 배열이다", () => {
    expect(uncoveredFatalIds(["c2", "c3"], criticism.points)).toEqual([]);
  });

  it("minor를 언급하지 않은 것은 침묵이 아니다", () => {
    expect(uncoveredFatalIds(["c2", "c3"], criticism.points)).not.toContain(
      "c1",
    );
  });
});

describe("duplicateRefs", () => {
  it("두 번 이상 등장한 id를 한 번씩 돌려준다", () => {
    expect(duplicateRefs(["c2", "c3", "c2", "c2"])).toEqual(["c2"]);
  });

  it("중복이 없으면 빈 배열이다", () => {
    expect(duplicateRefs(["c2", "c3"])).toEqual([]);
  });
});

describe("buildLedger", () => {
  it("fatal을 앞에 정렬한다", () => {
    const ledger = buildLedger(criticism, solution, verdict);
    expect(ledger.map((entry) => entry.point.id)).toEqual(["c2", "c3"]);
  });

  it("비판 원문·해결책·감사를 한 항목으로 짝짓는다", () => {
    const [first] = buildLedger(criticism, solution, verdict);
    expect(first.point.claim).toBe(fatalBmPoint.claim);
    expect(first.remedy).toEqual({
      strategy: "bypass",
      remedy: "구독이 아니라 측정된 성과에 과금해 무료 대안과 경쟁하지 않는다.",
    });
    expect(first.audit).toEqual({
      assessment: "restated",
      note: "'성과 과금'은 지불 의사 부재를 다시 말한 것에 가깝다.",
    });
  });

  it("해결책이 없는 fatal은 remedy가 undefined인 항목으로 남는다 (침묵의 가시화)", () => {
    const silent: Solution = { ...solution, remedies: [] };
    const ledger = buildLedger(criticism, silent);
    expect(ledger.map((entry) => entry.point.id)).toEqual(["c2", "c3"]);
    expect(ledger.every((entry) => entry.remedy === undefined)).toBe(true);
  });

  it("판정 이전(verdict 없음)이면 audit이 undefined다", () => {
    const ledger = buildLedger(criticism, solution);
    expect(ledger.every((entry) => entry.audit === undefined)).toBe(true);
    expect(ledger.every((entry) => entry.remedy !== undefined)).toBe(true);
  });

  it("solution·verdict가 없어도 fatal 목록을 돌려준다", () => {
    expect(buildLedger(criticism).map((entry) => entry.point.id)).toEqual([
      "c2",
      "c3",
    ]);
  });

  it("강제 대상이 아닌 major·minor도 해결책이 있으면 원장에 오른다", () => {
    const withMinorRemedy: Solution = {
      ...solution,
      remedies: [
        ...solution.remedies,
        {
          respondsTo: "c1",
          strategy: "defend",
          remedy: "산지 직송 품질 보증제를 붙인다.",
        },
      ],
    };
    const ledger = buildLedger(criticism, withMinorRemedy);
    expect(ledger.map((entry) => entry.point.id)).toEqual(["c2", "c3", "c1"]);
  });

  it("아무도 건드리지 않은 minor는 원장에 오르지 않는다", () => {
    const ledger = buildLedger(criticism, solution, verdict);
    expect(ledger.map((entry) => entry.point.id)).not.toContain("c1");
  });

  it("unknown id를 참조하는 해결책·감사는 조용히 드롭한다 (throw 금지)", () => {
    const dangling: Solution = {
      ...solution,
      remedies: [
        {
          respondsTo: "c99",
          strategy: "defend",
          remedy: "존재하지 않는 비판에 대한 해결책",
        },
      ],
    };
    const danglingVerdict: Verdict = {
      ...verdict,
      remedyAudits: [
        { criticismId: "c99", assessment: "solid", note: "유령 감사" },
      ],
    };
    expect(() => buildLedger(criticism, dangling, danglingVerdict)).not.toThrow();
    const ledger = buildLedger(criticism, dangling, danglingVerdict);
    expect(ledger.map((entry) => entry.point.id)).toEqual(["c2", "c3"]);
    expect(ledger.every((entry) => entry.remedy === undefined)).toBe(true);
  });
});

// report.md와 웹 리포트가 공유하는 뷰. 이 규칙이 렌더러마다 갈리면 report.md에서 생략되는
// 구 run이 웹에서는 "해결책 없음" 표로 뜨는 두 개의 진실이 생긴다 (ADR-017).
describe("fatalLedger", () => {
  it("fatal만 싣는다 — 전건 커버리지를 강제받는 것이 fatal뿐이다", () => {
    const entries = fatalLedger(criticism, solution, verdict);
    expect(entries.map((entry) => entry.point.id)).toEqual(["c2", "c3"]);
  });

  it("원장이 통째로 비면 빈 배열을 준다 — 호출부가 블록을 생략하는 근거다", () => {
    expect(fatalLedger(criticism, { ...solution, remedies: [] })).toEqual([]);
    expect(
      fatalLedger(
        criticism,
        { ...solution, remedies: [] },
        { ...verdict, remedyAudits: [] },
      ),
    ).toEqual([]);
    // 구 run은 원장 계약 이전에 저장됐을 뿐이다. fatal마다 "해결책 없음"을 찍으면
    // 있지도 않은 침묵을 지어내는 셈이다
    expect(fatalLedger(criticism)).toEqual([]);
  });

  it("원장이 하나라도 있으면 침묵한 fatal도 행으로 남긴다", () => {
    const entries = fatalLedger(criticism, {
      ...solution,
      remedies: [solution.remedies[0]],
    });

    expect(entries.map((entry) => entry.point.id)).toEqual(["c2", "c3"]);
    // c3만 해결책이 있고 c2는 침묵이다 — 침묵이 행에서 사라지면 관측할 수 없다
    expect(entries.find((entry) => entry.point.id === "c2")?.remedy).toBeUndefined();
    expect(entries.find((entry) => entry.point.id === "c3")?.remedy).toBeDefined();
  });
});
