import type {
  CommunityVoice,
  ResearchSourceId,
  SourceCoverage,
} from "../types/index.js";

/**
 * 자료조사 소스 하나. services/의 원시 타입을 CommunityVoice로 정규화한 얇은 어댑터다 (ADR-012).
 *
 * 소스는 정확히 셋이고 전부 컴파일 타임에 알려져 있으며 생성 지점이 CLI 한 곳이라,
 * `readonly ResearchSource[]` 배열 자체가 레지스트리다 — 동적 등록·플러그인은 없다.
 */
export interface ResearchSource {
  readonly id: ResearchSourceId;
  /** 프롬프트 섹션 제목. 라벨은 SOURCE_LABELS가 단일 소스다 */
  readonly label: string;
  /** 실패하면 throw한다 — 흡수는 collectAll의 책임이다 */
  collect(query: string): Promise<CommunityVoice[]>;
}

export interface SourceFailure {
  source: ResearchSourceId;
  message: string;
}

export interface CollectedEvidence {
  voices: CommunityVoice[];
  failures: SourceFailure[];
  /**
   * 소스 3종 전체의 조사 결과. 등록되지 않은 소스도 unconfigured로 반드시 나타난다 —
   * failures[]는 "실패"만 담고, 키가 없어 조사되지 않은 소스는 실패가 아니라 부재다 (ADR-013).
   */
  coverage: SourceCoverage[];
}
