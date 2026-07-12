"use client";

import { useState } from "react";
import { Button } from "./Button";

interface DeleteRunButtonProps {
  /** 확인 후 실제 삭제. 성공·실패 처리(목록 갱신·홈 이동·에러 표시)는 호출부가 소유한다 */
  onConfirm: () => Promise<void> | void;
  /** 값이 있으면 삭제 불가. 버튼을 숨기지 않고 비활성으로 두고 사유를 노출한다 (UI_GUIDE) */
  disabledReason?: string;
}

// 비활성 상태의 색은 disabled: 변형으로 준다 — 평문 text-neutral-400을 얹으면 text 변형의
// text-neutral-500과 명시도가 같아 생성 CSS 순서에 따라 조용히 지므로.
const DISABLED_CLASS =
  "disabled:cursor-not-allowed disabled:text-neutral-400 disabled:hover:text-neutral-400 disabled:hover:no-underline";

/**
 * run 삭제 진입 + 인라인 확인 (UI_GUIDE "삭제 버튼").
 *
 * 되돌릴 수 없는 액션이라 확인 단계가 필수다. 확인은 모달이 아니라 그 자리에서 액션 줄로 바뀐다.
 * 진입 버튼은 무채색이고 빨강(Danger)은 파괴가 임박한 확인 단계에서만 등장한다 — red-600은
 * 이미 "severity: fatal / run 실패"라는 데이터의 의미를 갖기 때문이다.
 */
export function DeleteRunButton({
  onConfirm,
  disabledReason,
}: DeleteRunButtonProps) {
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // 실행 중(running) run: 사라지는 버튼은 기능이 없는 것처럼 보인다 — 비활성으로 남긴다
  if (disabledReason !== undefined) {
    return (
      <Button
        variant="text"
        disabled
        title={disabledReason}
        aria-label={`삭제 (${disabledReason})`}
        className={DISABLED_CLASS}
      >
        삭제
      </Button>
    );
  }

  if (!confirming) {
    return (
      <Button variant="text" onClick={() => setConfirming(true)}>
        삭제
      </Button>
    );
  }

  async function handleDelete(): Promise<void> {
    setDeleting(true);
    try {
      await onConfirm();
    } finally {
      // 성공하면 이 컴포넌트는 사라진다(행 제거·홈 이동). 실패하면 확인 줄을 닫고,
      // 이유는 호출부의 에러 표시가 맡는다.
      setDeleting(false);
      setConfirming(false);
    }
  }

  return (
    // 확인 줄은 콜아웃이 아니라 액션 줄이다 — Card로 감싸지 않는다
    <div
      data-delete-confirm=""
      className="flex flex-wrap items-center justify-end gap-3"
      onKeyDown={(event) => {
        if (event.key === "Escape" && !deleting) {
          setConfirming(false);
        }
      }}
    >
      <span className="text-sm text-neutral-700">
        되돌릴 수 없습니다. 리포트와 수집 증거가 모두 삭제됩니다.
      </span>
      <Button
        variant="danger"
        disabled={deleting}
        onClick={() => void handleDelete()}
      >
        {deleting ? "삭제 중…" : "삭제"}
      </Button>
      {/* 기본 포커스는 취소에 둔다 (UI_GUIDE) — 파괴가 기본 선택이 되어선 안 된다 */}
      <Button
        variant="secondary"
        autoFocus
        disabled={deleting}
        onClick={() => setConfirming(false)}
      >
        취소
      </Button>
    </div>
  );
}
