import type { CommunityVoice, ResearchSourceId } from "../types/index.js";

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
}
