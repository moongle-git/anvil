"use client";

import { useState } from "react";
import { Button } from "./Button";

const TOOLTIP = "자료조사부터 다시";

interface RerunButtonProps {
  /** 새 run을 만들고 그 상세로 이동시킨다. 실패 처리(에러 표시)는 호출부가 소유한다 */
  onRerun: () => Promise<void> | void;
}

/**
 * 재실행(rerun) 진입 (UI_GUIDE "재실행 버튼").
 *
 * resume("이어서 실행")과 다른 버튼이다 — resume은 중단 지점부터, rerun은 자료조사부터다.
 * 그래서 Secondary이고(완료된 run의 주인공은 리포트다) 툴팁으로 범위를 밝힌다.
 * 확인 단계는 두지 않는다: 원본을 보존하고 새 run을 만드는 비파괴 액션이다 (ADR-015).
 * in-flight 동안 비활성 — 두 번 눌리면 run이 두 개 생기고 외부 API 쿼터를 두 배 쓴다.
 */
export function RerunButton({ onRerun }: RerunButtonProps) {
  const [rerunning, setRerunning] = useState(false);

  async function handleRerun(): Promise<void> {
    setRerunning(true);
    try {
      await onRerun();
    } finally {
      // 성공하면 새 run 상세로 이동해 이 컴포넌트는 사라진다. 실패하면 다시 누를 수 있어야 한다.
      setRerunning(false);
    }
  }

  return (
    <Button
      variant="secondary"
      disabled={rerunning}
      title={TOOLTIP}
      onClick={() => void handleRerun()}
    >
      {rerunning ? "재실행 중…" : "재실행"}
    </Button>
  );
}
